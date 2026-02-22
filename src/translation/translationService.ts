import * as vscode from 'vscode';
import { CacheStore } from '../cache/cacheStore';
import {
  WorkspaceFileSnapshot,
  WorkspaceIndexStore,
} from '../cache/workspaceIndexStore';
import {
  API_KEY_SECRET_KEY,
  getTranslatorSettings,
  TranslatorSettings,
} from '../config/settings';
import { collectFromCMacroLines } from '../collector/cIdentifierCollector';
import { collectComments } from '../collector/commentCollector';
import {
  collectFromSemanticTokens,
} from '../collector/semanticCollector';
import { collectFromDocumentSymbolsFallback } from '../collector/symbolFallback';
import { collectFromGenericRegex } from '../collector/genericIdentifierCollector';
import {
  CommentOccurrence,
  IdentifierOccurrence,
  StringLiteralOccurrence,
} from '../collector/types';
import { collectCStringLiterals } from '../collector/stringLiteralCollector';
import {
  buildRenderedIdentifier,
  normalizeIdentifier,
  shouldSkipIdentifier,
} from '../naming/normalize';
import { DemoProvider } from './demoProvider';
import { DeepSeekProvider } from './deepseekProvider';
import { OpenAICompatibleProvider } from './openaiCompatibleProvider';
import { TranslationProvider } from './provider';

interface DocumentTranslationState {
  occurrences: IdentifierOccurrence[];
  translationByOriginal: Map<string, string>;
  comments: CommentOccurrence[];
  commentTranslations: Map<string, string>;
  stringLiterals: StringLiteralOccurrence[];
  stringLiteralTranslations: Map<string, string>;
}

const COMMON_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'return', 'goto',
  'class', 'struct', 'enum', 'interface', 'namespace', 'function', 'def', 'lambda',
  'var', 'let', 'const', 'static', 'public', 'private', 'protected',
  'export', 'import', 'from', 'as',
  'try', 'catch', 'finally', 'throw', 'throws', 'new', 'delete', 'this', 'super',
  'true', 'false', 'null', 'undefined', 'void',
  'int', 'float', 'double', 'char', 'bool', 'boolean', 'long', 'short', 'signed', 'unsigned',
  'package', 'include', 'define', 'endif', 'ifdef', 'ifndef', 'elif',
  'using', 'typedef', 'template', 'typename', 'operator', 'extends', 'implements',
  'yield', 'await', 'async', 'sizeof',
]);

const DEFAULT_IDENTIFIER_BLACKLIST = new Set([
  'main',
  'tostring',
  'args',
  'init',
  'constructor',
  'valueof',
  'hashcode',
]);

const FALLBACK_WORD_MAP = new Map<string, string>([
  ['max', '最大'],
  ['no', '不'],
  ['scan', '扫描'],
  ['string', '字符串'],
  ['use', '使用'],
  ['protos', '原型'],
  ['proto', '原型'],
  ['str', '字符串'],
  ['bytes', '字节'],
  ['byte', '字节'],
  ['buffer', '缓冲区'],
  ['state', '状态'],
  ['comment', '注释'],
  ['size', '大小'],
  ['check', '检查'],
  ['valid', '有效'],
  ['user', '用户'],
  ['profile', '资料'],
  ['data', '数据'],
  ['process', '处理'],
  ['current', '当前'],
  ['index', '索引'],
  ['success', '成功'],
  ['flag', '标记'],
  ['retry', '重试'],
  ['count', '次数'],
  ['temp', '临时'],
  ['value', '值'],
  ['active', '激活'],
  ['name', '名称'],
  ['id', 'ID'],
  ['input', '输入'],
  ['putchar', '输出字符'],
  ['unput', '退回'],
]);

export interface WorkspaceTranslationResult {
  files: number;
  scannedFiles: number;
  reusedFiles: number;
  terms: number;
  sentTerms: number;
}

export interface FileTranslationResult {
  terms: number;
  sentTerms: number;
}

export class TranslationService {
  private readonly cacheStore: CacheStore;
  private readonly workspaceIndexStore: WorkspaceIndexStore;
  private readonly documentState = new Map<string, DocumentTranslationState>();
  private readonly updateEmitter = new vscode.EventEmitter<void>();
  private projectContextSummaryCache: string | undefined;

  public readonly onDidUpdate = this.updateEmitter.event;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.cacheStore = new CacheStore(context);
    this.workspaceIndexStore = new WorkspaceIndexStore(context);
  }

  public async init(): Promise<void> {
    await this.cacheStore.init();
    await this.workspaceIndexStore.init();
  }

  public async setApiKey(apiKey: string): Promise<void> {
    await this.context.secrets.store(API_KEY_SECRET_KEY, apiKey.trim());
  }

  public async validateCurrentProviderConnection(): Promise<void> {
    const settings = getTranslatorSettings();
    const provider = await this.buildProvider(settings);
    if (settings.provider === 'demo') {
      return;
    }

    await provider.translateBatch({
      terms: ['user'],
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      projectContextSummary: 'health_check',
    });
  }

  public async clearCache(): Promise<void> {
    this.documentState.clear();
    this.projectContextSummaryCache = undefined;
    await this.cacheStore.clear();
    await this.workspaceIndexStore.clear();
    this.updateEmitter.fire();
  }

  public async translateWorkspace(): Promise<WorkspaceTranslationResult> {
    await this.cacheStore.init();
    await this.workspaceIndexStore.init();

    const settings = getTranslatorSettings();
    const workspaceKey = this.getWorkspaceKey();
    const exclude =
      settings.excludeGlobs.length > 0
        ? `{${settings.excludeGlobs.join(',')}}`
        : undefined;
    const uris = await vscode.workspace.findFiles('**/*', exclude);

    const snapshots: WorkspaceFileSnapshot[] = [];
    const existingFileUris = new Set<string>();
    for (const uri of uris) {
      if (uri.scheme !== 'file') {
        continue;
      }

      try {
        const stat = await vscode.workspace.fs.stat(uri);
        snapshots.push({
          uri,
          mtimeMs: stat.mtime,
          size: stat.size,
        });
        existingFileUris.add(uri.toString());
      } catch {
        // Skip inaccessible entries.
      }
    }

    const changedSnapshots = this.workspaceIndexStore.getChangedSnapshots(
      workspaceKey,
      snapshots,
    );
    const reusedFiles = Math.max(0, snapshots.length - changedSnapshots.length);
    let scannedFiles = 0;

    const translateComments = this.shouldTranslateComments();
    const allCommentTexts = new Set<string>();

    for (const snapshot of changedSnapshots) {
      const fileUri = snapshot.uri.toString();
      try {
        const document = await vscode.workspace.openTextDocument(snapshot.uri);
        if (document.isUntitled || document.lineCount === 0) {
          this.workspaceIndexStore.upsertFile(
            workspaceKey,
            fileUri,
            snapshot.mtimeMs,
            snapshot.size,
            [],
          );
          continue;
        }
        scannedFiles += 1;
        const occurrences = await this.collectOccurrences(document);
        const terms = this.extractNormalizedTerms(occurrences);
        this.workspaceIndexStore.upsertFile(
          workspaceKey,
          fileUri,
          snapshot.mtimeMs,
          snapshot.size,
          terms,
        );

        if (translateComments) {
          const comments = collectComments(document);
          for (const comment of comments) {
            allCommentTexts.add(comment.text);
          }
        }
      } catch {
        this.workspaceIndexStore.upsertFile(
          workspaceKey,
          fileUri,
          snapshot.mtimeMs,
          snapshot.size,
          [],
        );
      }
    }

    this.workspaceIndexStore.removeMissingFiles(workspaceKey, existingFileUris);
    const uniqueTerms = Array.from(
      this.workspaceIndexStore.getWorkspaceTermSet(workspaceKey),
    );
    const sentTerms = this.countMissingTerms(uniqueTerms, settings);
    await this.ensureTermTranslations(uniqueTerms);
    if (translateComments) {
      await this.ensureCommentTranslations(Array.from(allCommentTexts));
    }

    this.documentState.clear();
    await this.cacheStore.flush();
    await this.workspaceIndexStore.flush();
    this.updateEmitter.fire();
    return {
      files: snapshots.length,
      scannedFiles,
      reusedFiles,
      terms: uniqueTerms.length,
      sentTerms,
    };
  }

  public async translateCurrentFile(
    document: vscode.TextDocument,
  ): Promise<FileTranslationResult> {
    // #region agent log
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'translationService.ts:translateCurrentFile:start',message:'translateCurrentFile 开始',data:{step:'T1',uri:document.uri.toString(),languageId:document.languageId},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
    // #endregion
    await this.cacheStore.init();
    await this.workspaceIndexStore.init();
    // #region agent log
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'translationService.ts:translateCurrentFile:afterInit',message:'cacheStore/workspaceIndexStore init 完成',data:{step:'T2'},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
    // #endregion

    const settings = getTranslatorSettings();
    const occurrences = await this.collectOccurrences(document);
    // #region agent log
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'translationService.ts:translateCurrentFile:afterCollect',message:'collectOccurrences 完成',data:{step:'T3',occurrencesCount:occurrences.length},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
    // #endregion
    const terms = this.extractNormalizedTerms(occurrences);
    // #region agent log
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'translationService.ts:translateCurrentFile:afterExtract',message:'extractNormalizedTerms 完成',data:{step:'T4',termsCount:terms.length},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
    // #endregion
    const sentTerms = this.countMissingTerms(terms, settings);
    await this.ensureTermTranslations(terms);
    // #region agent log
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'translationService.ts:translateCurrentFile:afterEnsureTerms',message:'ensureTermTranslations 完成',data:{step:'T5',sentTerms},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
    // #endregion

    const translateComments = this.shouldTranslateComments();
    if (translateComments) {
      const comments = collectComments(document);
      const commentTexts = Array.from(new Set(comments.map((c) => c.text)));
      await this.ensureCommentTranslations(commentTexts);
      // #region agent log
      fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'translationService.ts:translateCurrentFile:afterComments',message:'ensureCommentTranslations 完成',data:{step:'T6',commentCount:commentTexts.length},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
      // #endregion
    }

    const langId = document.languageId;
    if (this.shouldTranslateStringLiterals(langId) && (langId === 'c' || langId === 'cpp')) {
      const stringLiterals = collectCStringLiterals(document);
      const stringLiteralTexts = Array.from(
        new Set(stringLiterals.map((s) => s.text)),
      );
      await this.ensureStringLiteralTranslations(stringLiteralTexts);
      // #region agent log
      fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'translationService.ts:translateCurrentFile:afterStringLiterals',message:'ensureStringLiteralTranslations 完成',data:{step:'T7',count:stringLiteralTexts.length},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
      // #endregion
    }

    if (document.uri.scheme === 'file') {
      try {
        const stat = await vscode.workspace.fs.stat(document.uri);
        this.workspaceIndexStore.upsertFile(
          this.getWorkspaceKey(),
          document.uri.toString(),
          stat.mtime,
          stat.size,
          terms,
        );
      } catch {
        // Ignore file stat failures for non-workspace files.
      }
    }

    this.documentState.delete(document.uri.toString());
    await this.cacheStore.flush();
    await this.workspaceIndexStore.flush();
    this.updateEmitter.fire();
    // #region agent log
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'translationService.ts:translateCurrentFile:return',message:'translateCurrentFile 即将返回',data:{step:'T8',terms:terms.length,sentTerms},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
    // #endregion
    return {
      terms: terms.length,
      sentTerms,
    };
  }

  public async getTranslatedDocumentText(
    document: vscode.TextDocument,
  ): Promise<string> {
    const state = await this.getOrBuildDocumentState(document);
    const settings = getTranslatorSettings();
    const textMode =
      settings.renderMode === 'bilingual' ? 'bilingual' : 'translatedOnly';

    const source = document.getText();

    const replacementCandidates: {
      start: number;
      end: number;
      replacement: string;
    }[] = [];

    for (const occurrence of state.occurrences) {
      const translated = state.translationByOriginal.get(occurrence.name);
      if (!translated) {
        continue;
      }

      const replacement = buildRenderedIdentifier(
        occurrence.name,
        this.toSafeIdentifierTranslation(translated, occurrence.name),
        textMode,
      );

      if (replacement === occurrence.name) {
        continue;
      }

      replacementCandidates.push({
        start: document.offsetAt(occurrence.range.start),
        end: document.offsetAt(occurrence.range.end),
        replacement,
      });
    }

    for (const comment of state.comments) {
      const translated = state.commentTranslations.get(comment.text);
      if (!translated || translated === comment.text) {
        continue;
      }

      const contentStart = document.offsetAt(comment.contentRange.start);
      const contentEnd = document.offsetAt(comment.contentRange.end);
      const originalContent = source.slice(contentStart, contentEnd);

      let replacement: string;
      if (textMode === 'bilingual') {
        replacement = `${originalContent}\n${translated}`;
      } else {
        replacement = ` ${translated} `;
      }

      replacementCandidates.push({
        start: contentStart,
        end: contentEnd,
        replacement,
      });
    }

    for (const sl of state.stringLiterals) {
      const translated = state.stringLiteralTranslations.get(sl.text);
      if (!translated || translated === sl.text) {
        continue;
      }
      const contentStart = document.offsetAt(sl.contentRange.start);
      const contentEnd = document.offsetAt(sl.contentRange.end);
      replacementCandidates.push({
        start: contentStart,
        end: contentEnd,
        replacement: translated,
      });
    }

    replacementCandidates.sort((a, b) => b.start - a.start);

    let output = source;
    let lastStart = Number.POSITIVE_INFINITY;
    for (const candidate of replacementCandidates) {
      if (candidate.end > lastStart) {
        continue;
      }
      output =
        output.slice(0, candidate.start) +
        candidate.replacement +
        output.slice(candidate.end);
      lastStart = candidate.start;
    }

    return output;
  }

  public async getInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.InlayHint[]> {
    const settings = getTranslatorSettings();
    if (settings.viewMode !== 'inlay') {
      return [];
    }

    const state = await this.getOrBuildDocumentState(document);
    const hints: vscode.InlayHint[] = [];
    const dedupe = new Set<string>();

    for (const occurrence of state.occurrences) {
      if (!range.intersection(occurrence.range)) {
        continue;
      }

      const translated = state.translationByOriginal.get(occurrence.name);
      if (!translated || translated === occurrence.name) {
        continue;
      }

      const safeTranslation = this.toSafeIdentifierTranslation(
        translated,
        occurrence.name,
      );
      if (safeTranslation === occurrence.name) {
        continue;
      }

      const key = `${occurrence.range.start.line}:${occurrence.range.start.character}:${occurrence.name}`;
      if (dedupe.has(key)) {
        continue;
      }
      dedupe.add(key);

      const hint = new vscode.InlayHint(
        occurrence.range.end,
        `: ${safeTranslation}`,
        vscode.InlayHintKind.Type,
      );
      hint.paddingLeft = true;
      hints.push(hint);
    }

    for (const comment of state.comments) {
      if (!range.intersection(comment.range)) {
        continue;
      }

      const translated = state.commentTranslations.get(comment.text);
      if (!translated || translated === comment.text) {
        continue;
      }

      const key = `comment:${comment.range.start.line}:${comment.range.start.character}`;
      if (dedupe.has(key)) {
        continue;
      }
      dedupe.add(key);

      const hint = new vscode.InlayHint(
        comment.range.end,
        `  « ${translated} »`,
        vscode.InlayHintKind.Parameter,
      );
      hint.paddingLeft = true;
      hints.push(hint);
    }

    return hints;
  }

  public invalidateDocument(uri: vscode.Uri): void {
    this.documentState.delete(uri.toString());
    this.updateEmitter.fire();
  }

  public invalidateAllDocuments(): void {
    this.documentState.clear();
    this.projectContextSummaryCache = undefined;
    this.updateEmitter.fire();
  }

  private async getOrBuildDocumentState(
    document: vscode.TextDocument,
  ): Promise<DocumentTranslationState> {
    const key = document.uri.toString();
    const existing = this.documentState.get(key);
    if (existing) {
      return existing;
    }

    const occurrences = await this.collectOccurrences(document);
    const translationByOriginal =
      await this.buildOriginalToTranslationMap(occurrences);
    const translateComments = this.shouldTranslateComments();
    const comments = translateComments ? collectComments(document) : [];
    const commentTranslations = translateComments
      ? await this.buildCommentTranslationMap(comments)
      : new Map<string, string>();
    const langId = document.languageId;
    let stringLiterals: StringLiteralOccurrence[] = [];
    let stringLiteralTranslations = new Map<string, string>();
    if (this.shouldTranslateStringLiterals(langId) && (langId === 'c' || langId === 'cpp')) {
      stringLiterals = collectCStringLiterals(document);
      stringLiteralTranslations =
        await this.buildStringLiteralTranslationMap(stringLiterals);
    }
    const state: DocumentTranslationState = {
      occurrences,
      translationByOriginal,
      comments,
      commentTranslations,
      stringLiterals,
      stringLiteralTranslations,
    };
    this.documentState.set(key, state);
    await this.cacheStore.flush();
    this.updateEmitter.fire();
    return state;
  }

  private async collectOccurrences(
    document: vscode.TextDocument,
  ): Promise<IdentifierOccurrence[]> {
    const langId = document.languageId;
    let occurrences: IdentifierOccurrence[];

    if (langId === 'c' || langId === 'cpp') {
      const symbolOccurrences =
        await collectFromDocumentSymbolsFallback(document);
      const semanticOccurrences = await collectFromSemanticTokens(document);
      const fallbackOccurrences =
        semanticOccurrences.length === 0 ? collectFromGenericRegex(document) : [];
      const macroOccurrences = collectFromCMacroLines(document);
      occurrences = [
        ...symbolOccurrences,
        ...semanticOccurrences,
        ...fallbackOccurrences,
        ...macroOccurrences,
      ];
    } else {
      const symbolOccurrences =
        await collectFromDocumentSymbolsFallback(document);
      const semanticOccurrences = await collectFromSemanticTokens(document);
      const fallbackOccurrences =
        semanticOccurrences.length === 0 ? collectFromGenericRegex(document) : [];
      occurrences = [
        ...symbolOccurrences,
        ...semanticOccurrences,
        ...fallbackOccurrences,
      ];
    }

    const dedupe = new Map<string, IdentifierOccurrence>();
    for (const occurrence of occurrences) {
      const key = `${occurrence.name}|${occurrence.range.start.line}:${occurrence.range.start.character}|${occurrence.range.end.line}:${occurrence.range.end.character}`;
      dedupe.set(key, occurrence);
    }
    return Array.from(dedupe.values()).sort((a, b) =>
      a.range.start.isBefore(b.range.start) ? -1 : 1,
    );
  }

  private extractNormalizedTerms(
    occurrences: IdentifierOccurrence[],
  ): string[] {
    const settings = getTranslatorSettings();
    const skipRegexes = this.buildSkipRegexes(settings.skipPatterns);
    const protectedTerms = this.buildProtectedTermSet(settings.protectedTerms);
    const glossary = this.buildGlossaryMap(settings.glossary);
    const terms = new Set<string>();
    for (const occurrence of occurrences) {
      if (
        shouldSkipIdentifier(occurrence.name, skipRegexes) ||
        this.isKeyword(occurrence.name) ||
        this.isBlacklistedIdentifier(occurrence.name)
      ) {
        continue;
      }
      const normalized = normalizeIdentifier(occurrence.name).normalized;
      if (!normalized) {
        continue;
      }
      if (
        this.isProtectedIdentifier(occurrence.name, normalized, protectedTerms)
      ) {
        continue;
      }
      if (this.findGlossaryTranslation(occurrence.name, normalized, glossary)) {
        continue;
      }
      terms.add(normalized);
    }
    return Array.from(terms);
  }

  private async buildOriginalToTranslationMap(
    occurrences: IdentifierOccurrence[],
  ): Promise<Map<string, string>> {
    const settings = getTranslatorSettings();
    const skipRegexes = this.buildSkipRegexes(settings.skipPatterns);
    const protectedTerms = this.buildProtectedTermSet(settings.protectedTerms);
    const glossary = this.buildGlossaryMap(settings.glossary);
    const normalizedByOriginal = new Map<string, string>();
    const directByOriginal = new Map<string, string>();
    const terms = new Set<string>();

    for (const occurrence of occurrences) {
      if (
        shouldSkipIdentifier(occurrence.name, skipRegexes) ||
        this.isKeyword(occurrence.name) ||
        this.isBlacklistedIdentifier(occurrence.name)
      ) {
        continue;
      }
      const normalized = normalizeIdentifier(occurrence.name).normalized;
      if (!normalized) {
        continue;
      }

      if (
        this.isProtectedIdentifier(occurrence.name, normalized, protectedTerms)
      ) {
        directByOriginal.set(occurrence.name, occurrence.name);
        continue;
      }

      const glossaryTranslation = this.findGlossaryTranslation(
        occurrence.name,
        normalized,
        glossary,
      );
      if (glossaryTranslation) {
        directByOriginal.set(occurrence.name, glossaryTranslation);
        continue;
      }

      normalizedByOriginal.set(occurrence.name, normalized);
      terms.add(normalized);
    }

    await this.ensureTermTranslations(Array.from(terms));

    const output = new Map<string, string>();
    for (const [original, translated] of directByOriginal.entries()) {
      output.set(original, translated);
    }
    for (const [original, normalized] of normalizedByOriginal.entries()) {
      const translated = this.cacheStore.get(normalized, settings);
      if (translated) {
        output.set(original, translated);
      }
    }
    return output;
  }

  private async ensureTermTranslations(terms: string[]): Promise<void> {
    const settings = getTranslatorSettings();
    const missing = terms.filter(
      (term) => !this.cacheStore.get(term, settings),
    );
    if (missing.length === 0) {
      return;
    }

    const provider = await this.buildProvider(settings);
    const batchSize = Math.max(1, settings.maxBatchTerms);
    const projectContextSummary = await this.getProjectContextSummary();

    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const translated = await provider.translateBatch({
        terms: batch,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        projectContextSummary,
      });
      this.cacheStore.setMany(translated, settings);
    }
  }

  private async buildCommentTranslationMap(
    comments: CommentOccurrence[],
  ): Promise<Map<string, string>> {
    const settings = getTranslatorSettings();
    const uniqueTexts = new Set<string>();
    for (const comment of comments) {
      uniqueTexts.add(comment.text);
    }

    await this.ensureCommentTranslations(Array.from(uniqueTexts));

    const output = new Map<string, string>();
    for (const text of uniqueTexts) {
      const translated = this.cacheStore.getComment(text, settings);
      if (translated) {
        output.set(text, translated);
      }
    }
    return output;
  }

  private async buildStringLiteralTranslationMap(
    stringLiterals: StringLiteralOccurrence[],
  ): Promise<Map<string, string>> {
    const settings = getTranslatorSettings();
    const uniqueTexts = new Set<string>();
    for (const sl of stringLiterals) {
      uniqueTexts.add(sl.text);
    }
    await this.ensureStringLiteralTranslations(Array.from(uniqueTexts));
    const output = new Map<string, string>();
    for (const text of uniqueTexts) {
      const translated = this.cacheStore.getStringLiteral(text, settings);
      if (translated) {
        output.set(text, translated);
      }
    }
    return output;
  }

  private async ensureStringLiteralTranslations(
    literalTexts: string[],
  ): Promise<void> {
    const settings = getTranslatorSettings();
    const missing = literalTexts.filter(
      (text) =>
        !this.cacheStore.getStringLiteral(text, settings) &&
        !this.isCommentAlreadyInTargetLanguage(text, settings.targetLanguage),
    );
    if (missing.length === 0) {
      return;
    }
    const provider = await this.buildProvider(settings);
    const batchSize = Math.max(1, Math.floor(settings.maxBatchTerms / 4));
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const translated = await provider.translateComments({
        comments: batch,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
      });
      this.cacheStore.setManyStringLiterals(translated, settings);
    }
  }

  private isCommentAlreadyInTargetLanguage(
    text: string,
    targetLanguage: string,
  ): boolean {
    const lang = targetLanguage.toLowerCase();
    if (lang.startsWith('zh')) {
      return /[\u4e00-\u9fff]/.test(text);
    }
    if (lang === 'ja') {
      return /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(text);
    }
    if (lang === 'ko') {
      return /[\uac00-\ud7af]/.test(text);
    }
    return false;
  }

  private async ensureCommentTranslations(
    commentTexts: string[],
  ): Promise<void> {
    const settings = getTranslatorSettings();
    const missing = commentTexts.filter(
      (text) =>
        !this.cacheStore.getComment(text, settings) &&
        !this.isCommentAlreadyInTargetLanguage(text, settings.targetLanguage),
    );
    if (missing.length === 0) {
      return;
    }

    const provider = await this.buildProvider(settings);
    const batchSize = Math.max(1, Math.floor(settings.maxBatchTerms / 4));

    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const translated = await provider.translateComments({
        comments: batch,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
      });
      this.cacheStore.setManyComments(translated, settings);
    }
  }

  private countMissingTerms(
    terms: string[],
    settings: TranslatorSettings,
  ): number {
    return terms.filter((term) => !this.cacheStore.get(term, settings)).length;
  }

  private getWorkspaceKey(): string {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      return 'no-workspace';
    }
    return folders
      .map((folder) => folder.uri.toString())
      .sort((a, b) => a.localeCompare(b))
      .join('||');
  }

  private async buildProvider(
    settings: ReturnType<typeof getTranslatorSettings>,
  ): Promise<TranslationProvider> {
    switch (settings.provider) {
      case 'demo':
        return new DemoProvider();
      case 'deepseek': {
        const apiKey = await this.context.secrets.get(API_KEY_SECRET_KEY);
        if (!apiKey) {
          throw new Error(
            'Missing API key. Run "Code Translator: Set API Key" first.',
          );
        }
        return new DeepSeekProvider(settings, apiKey);
      }
      case 'gemini':
      case 'openrouter':
      case 'siliconflow':
      case 'moonshot':
      case 'groq':
      case 'together':
      case 'zhipu':
      case 'openaiCompatible':
      case 'custom': {
        const apiKey = await this.context.secrets.get(API_KEY_SECRET_KEY);
        if (!apiKey) {
          throw new Error(
            'Missing API key. Run "Code Translator: Set API Key" first.',
          );
        }
        return new OpenAICompatibleProvider(settings, apiKey);
      }
      case 'deepl':
        throw new Error(
          'Deepl provider is not implemented yet. Please use openaiCompatible or custom.',
        );
      default:
        return new DemoProvider();
    }
  }

  private buildSkipRegexes(patterns: string[]): RegExp[] {
    const result: RegExp[] = [];
    for (const pattern of patterns) {
      try {
        result.push(new RegExp(pattern));
      } catch {
        // Ignore invalid user regex pattern.
      }
    }
    return result;
  }

  private buildProtectedTermSet(terms: string[]): Set<string> {
    const set = new Set<string>();
    for (const term of terms) {
      const cleaned = term.trim().toLowerCase();
      if (!cleaned) {
        continue;
      }
      set.add(cleaned);
    }
    return set;
  }

  private buildGlossaryMap(
    glossary: TranslatorSettings['glossary'],
  ): Map<string, string> {
    const map = new Map<string, string>();
    for (const [rawKey, rawValue] of Object.entries(glossary)) {
      const key = rawKey.trim().toLowerCase();
      const value = rawValue.trim();
      if (!key || !value) {
        continue;
      }
      map.set(key, value);
    }
    return map;
  }

  private isProtectedIdentifier(
    identifier: string,
    normalized: string,
    protectedTerms: Set<string>,
  ): boolean {
    if (protectedTerms.size === 0) {
      return false;
    }
    const lowerOriginal = identifier.toLowerCase();
    const lowerNormalized = normalized.toLowerCase();
    return (
      protectedTerms.has(lowerOriginal) || protectedTerms.has(lowerNormalized)
    );
  }

  private findGlossaryTranslation(
    identifier: string,
    normalized: string,
    glossary: Map<string, string>,
  ): string | undefined {
    if (glossary.size === 0) {
      return undefined;
    }

    const lowerOriginal = identifier.toLowerCase();
    const lowerNormalized = normalized.toLowerCase();
    return (
      glossary.get(lowerOriginal) ?? glossary.get(lowerNormalized) ?? undefined
    );
  }

  private toSafeIdentifierTranslation(
    translated: string,
    fallbackOriginal: string,
  ): string {
    const trimmed = translated.trim();
    if (!trimmed) {
      return fallbackOriginal;
    }

    const { prefix } = normalizeIdentifier(fallbackOriginal);
    if (!this.containsCjk(trimmed)) {
      const fallback = this.buildFallbackIdentifierTranslation(fallbackOriginal);
      if (fallback) {
        return fallback;
      }
    }
    const rawParts = trimmed.match(/[\p{L}\p{N}_$]+/gu) ?? [];
    const parts = rawParts
      .flatMap((part) => part.split(/_+/))
      .map((part) => part.trim())
      .filter(Boolean);
    let merged = this.joinTranslatedParts(parts);
    if (!merged) {
      return fallbackOriginal;
    }

    if (prefix) {
      if (merged.toLowerCase().startsWith(prefix.toLowerCase())) {
        return merged;
      }
      return `${prefix}${merged}`;
    }

    const firstChar = merged[0];
    if (!/[\p{L}_$]/u.test(firstChar)) {
      merged = `_${merged}`;
    }

    return merged;
  }

  private containsCjk(text: string): boolean {
    return /[\p{Script=Han}]/u.test(text);
  }

  private buildFallbackIdentifierTranslation(
    identifier: string,
  ): string | undefined {
    const normalized = normalizeIdentifier(identifier);
    if (normalized.parts.length === 0) {
      return undefined;
    }
    const translatedParts = normalized.parts.map(
      (part) => FALLBACK_WORD_MAP.get(part) ?? part,
    );
    const changed = translatedParts.some(
      (part, idx) => part !== normalized.parts[idx],
    );
    if (!changed) {
      return undefined;
    }
    const merged = this.joinTranslatedParts(translatedParts);
    return normalized.prefix ? `${normalized.prefix}${merged}` : merged;
  }

  private joinTranslatedParts(parts: string[]): string {
    if (parts.length === 0) {
      return '';
    }
    const hasAscii = parts.some((part) => /[A-Za-z0-9]/.test(part));
    return hasAscii ? parts.join('_') : parts.join('');
  }

  private isKeyword(identifier: string): boolean {
    return COMMON_KEYWORDS.has(identifier.toLowerCase());
  }

  private isBlacklistedIdentifier(identifier: string): boolean {
    const normalized = normalizeIdentifier(identifier).normalized;
    const compact = normalized.replace(/\s+/g, '').toLowerCase();
    return DEFAULT_IDENTIFIER_BLACKLIST.has(compact);
  }

  private shouldTranslateComments(): boolean {
    return false;
  }

  private shouldTranslateStringLiterals(_langId: string): boolean {
    return false;
  }

  private async getProjectContextSummary(): Promise<string | undefined> {
    if (this.projectContextSummaryCache !== undefined) {
      return this.projectContextSummaryCache || undefined;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      this.projectContextSummaryCache = '';
      return undefined;
    }

    const decoder = new TextDecoder('utf-8');
    const summaries: string[] = [];

    const readRootFile = async (
      fileName: string,
    ): Promise<string | undefined> => {
      try {
        const uri = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
        const data = await vscode.workspace.fs.readFile(uri);
        return decoder.decode(data);
      } catch {
        return undefined;
      }
    };

    const readmeText = await readRootFile('README.md');
    if (readmeText) {
      const headingMatches = [...readmeText.matchAll(/^#{1,3}\s+(.+)$/gm)]
        .slice(0, 6)
        .map((item) => item[1].trim());
      const codeSpans = [...readmeText.matchAll(/`([^`]{2,40})`/g)]
        .slice(0, 20)
        .map((item) => item[1].trim().toLowerCase())
        .filter(Boolean);
      const compactCodeSpans = Array.from(new Set(codeSpans)).slice(0, 12);
      if (headingMatches.length > 0) {
        summaries.push(`readme_headings:${headingMatches.join('|')}`);
      }
      if (compactCodeSpans.length > 0) {
        summaries.push(`readme_terms:${compactCodeSpans.join(',')}`);
      }
    }

    const packageText = await readRootFile('package.json');
    if (packageText) {
      try {
        const parsed = JSON.parse(packageText) as {
          name?: string;
          displayName?: string;
          description?: string;
        };
        const pkgBits = [
          parsed.name?.trim(),
          parsed.displayName?.trim(),
          parsed.description?.trim(),
        ].filter(Boolean);
        if (pkgBits.length > 0) {
          summaries.push(`package:${pkgBits.join(' | ')}`);
        }
      } catch {
        // Ignore invalid package json parsing.
      }
    }

    const joined = summaries.join(' ; ').replace(/\s+/g, ' ').trim();
    const limited = joined.slice(0, 700);
    this.projectContextSummaryCache = limited;
    return limited || undefined;
  }
}
