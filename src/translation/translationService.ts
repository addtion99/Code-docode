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
import { collectFromSemanticTokens } from '../collector/semanticCollector';
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
import { DoubaoProvider } from './doubaoProvider';
import { GlmProvider } from './glmProvider';
import { OpenAICompatibleProvider } from './openaiCompatibleProvider';
import { TranslationProvider } from './provider';
import { buildProjectContextSummary } from './projectContextSummary';
import {
  MissingTermScanOptions,
  MissingTermsScanResult,
  buildCommentLineMap,
  buildGlossaryMap,
  buildProtectedTermSet,
  buildSkipRegexes,
  collectMissingTermsFromLine,
  extractNormalizedTerms,
  findGlossaryTranslation,
  isBlacklistedIdentifier,
  isKeyword,
  isProtectedIdentifier,
  toSafeIdentifierTranslation,
} from './translationUtils';

interface DocumentTranslationState {
  occurrences: IdentifierOccurrence[];
  translationByOriginal: Map<string, string>;
  comments: CommentOccurrence[];
  commentTranslations: Map<string, string>;
  stringLiterals: StringLiteralOccurrence[];
  stringLiteralTranslations: Map<string, string>;
}

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
    // Use includeGlobs (source-only by default); fallback to all files when empty or explicitly **/*
    const includePatterns =
      settings.includeGlobs.length > 0 &&
      !settings.includeGlobs.every((g) => g === '**/*')
        ? settings.includeGlobs
        : ['**/*'];
    const uriArrays = await Promise.all(
      includePatterns.map((include) =>
        vscode.workspace.findFiles(include, exclude),
      ),
    );
    const uriSet = new Set<string>();
    const uris: vscode.Uri[] = [];
    for (const arr of uriArrays) {
      for (const uri of arr) {
        const key = uri.toString();
        if (!uriSet.has(key)) {
          uriSet.add(key);
          uris.push(uri);
        }
      }
    }

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
        const terms = extractNormalizedTerms(
          occurrences,
          this.buildTranslationFilters(),
        );
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
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': 'a59154',
      },
      body: JSON.stringify({
        sessionId: 'a59154',
        location: 'translationService.ts:translateCurrentFile:start',
        message: 'translateCurrentFile 开始',
        data: {
          step: 'T1',
          uri: document.uri.toString(),
          languageId: document.languageId,
        },
        timestamp: Date.now(),
        hypothesisId: 'flow',
      }),
    }).catch(() => {});
    await this.cacheStore.init();
    await this.workspaceIndexStore.init();
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': 'a59154',
      },
      body: JSON.stringify({
        sessionId: 'a59154',
        location: 'translationService.ts:translateCurrentFile:afterInit',
        message: 'cacheStore/workspaceIndexStore init 完成',
        data: { step: 'T2' },
        timestamp: Date.now(),
        hypothesisId: 'flow',
      }),
    }).catch(() => {});

    const settings = getTranslatorSettings();
    const occurrences = await this.collectOccurrences(document);
    // #region agent log
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': 'a59154',
      },
      body: JSON.stringify({
        sessionId: 'a59154',
        location: 'translationService.ts:translateCurrentFile:afterCollect',
        message: 'collectOccurrences 完成',
        data: { step: 'T3', occurrencesCount: occurrences.length },
        timestamp: Date.now(),
        hypothesisId: 'flow',
      }),
    }).catch(() => {});
    // #endregion
    const terms = extractNormalizedTerms(
      occurrences,
      this.buildTranslationFilters(),
    );
    // #region agent log
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': 'a59154',
      },
      body: JSON.stringify({
        sessionId: 'a59154',
        location: 'translationService.ts:translateCurrentFile:afterExtract',
        message: 'extractNormalizedTerms 完成',
        data: { step: 'T4', termsCount: terms.length },
        timestamp: Date.now(),
        hypothesisId: 'flow',
      }),
    }).catch(() => {});
    // #endregion
    const sentTerms = this.countMissingTerms(terms, settings);
    await this.ensureTermTranslations(terms);
    // #region agent log
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': 'a59154',
      },
      body: JSON.stringify({
        sessionId: 'a59154',
        location: 'translationService.ts:translateCurrentFile:afterEnsureTerms',
        message: 'ensureTermTranslations 完成',
        data: { step: 'T5', sentTerms },
        timestamp: Date.now(),
        hypothesisId: 'flow',
      }),
    }).catch(() => {});
    // #endregion

    const translateComments = this.shouldTranslateComments();
    if (translateComments) {
      const comments = collectComments(document);
      const commentTexts = Array.from(new Set(comments.map((c) => c.text)));
      await this.ensureCommentTranslations(commentTexts);
      // #region agent log
      fetch(
        'http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': 'a59154',
          },
          body: JSON.stringify({
            sessionId: 'a59154',
            location:
              'translationService.ts:translateCurrentFile:afterComments',
            message: 'ensureCommentTranslations 完成',
            data: { step: 'T6', commentCount: commentTexts.length },
            timestamp: Date.now(),
            hypothesisId: 'flow',
          }),
        },
      ).catch(() => {});
      // #endregion
    }

    const langId = document.languageId;
    if (
      this.shouldTranslateStringLiterals(langId) &&
      (langId === 'c' || langId === 'cpp')
    ) {
      const stringLiterals = collectCStringLiterals(document);
      const stringLiteralTexts = Array.from(
        new Set(stringLiterals.map((s) => s.text)),
      );
      await this.ensureStringLiteralTranslations(stringLiteralTexts);
      // #region agent log
      fetch(
        'http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Debug-Session-Id': 'a59154',
          },
          body: JSON.stringify({
            sessionId: 'a59154',
            location:
              'translationService.ts:translateCurrentFile:afterStringLiterals',
            message: 'ensureStringLiteralTranslations 完成',
            data: { step: 'T7', count: stringLiteralTexts.length },
            timestamp: Date.now(),
            hypothesisId: 'flow',
          }),
        },
      ).catch(() => {});
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
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': 'a59154',
      },
      body: JSON.stringify({
        sessionId: 'a59154',
        location: 'translationService.ts:translateCurrentFile:return',
        message: 'translateCurrentFile 即将返回',
        data: { step: 'T8', terms: terms.length, sentTerms },
        timestamp: Date.now(),
        hypothesisId: 'flow',
      }),
    }).catch(() => {});
    // #endregion
    return {
      terms: terms.length,
      sentTerms,
    };
  }

  public async translateTerms(terms: string[]): Promise<number> {
    await this.cacheStore.init();
    const settings = getTranslatorSettings();
    const unique = Array.from(
      new Set(terms.map((term) => term.trim()).filter(Boolean)),
    );
    const missing = unique.filter(
      (term) => !this.hasUsableCache(term, settings),
    );
    if (missing.length === 0) {
      return 0;
    }
    await this.ensureTermTranslations(missing);
    await this.cacheStore.flush();
    this.updateEmitter.fire();
    return missing.length;
  }

  /**
   * 这个函数的'是否有新单词'的主要判断逻辑，
   * 主要体现在调用 collectMissingTermsFromLine 时的过滤（即pending和cacheStore.get的结合）。
   * 在内部，addFromLine -> collectMissingTermsFromLine，只有当 pending 没有包含该 term 且缓存中没有翻译，
   * 才认定这个term是新词，才会加到 result。
   */
  public async collectMissingTermsAroundLine(
    document: vscode.TextDocument,
    anchorLine: number,
    beforeCount: number,
    afterCount: number,
    options: MissingTermScanOptions = {},
  ): Promise<MissingTermsScanResult> {
    await this.cacheStore.init();
    const settings = getTranslatorSettings();
    const pending = options.pendingTerms ?? new Set<string>();
    const maxScanLines = Math.max(0, options.maxScanLines ?? 400);
    const lineCount = document.lineCount;
    if (lineCount === 0) {
      return { terms: [], hitTop: true, hitBottom: true };
    }

    const clampedAnchor = Math.min(Math.max(anchorLine, 0), lineCount - 1);
    const filters = this.buildTranslationFilters();
    const commentLineMap = buildCommentLineMap(document);

    const result: string[] = [];
    const collected = new Set<string>();

    const addFromLine = (lineNumber: number, remaining: number): number => {
      if (remaining <= 0) {
        return remaining;
      }
      const line = document.lineAt(lineNumber).text;
      const terms = collectMissingTermsFromLine(
        line,
        lineNumber,
        commentLineMap,
        filters,
        collected,
        pending,
        (term) => this.hasUsableCache(term, settings),
      );
      for (const term of terms) {
        if (remaining <= 0) {
          break;
        }
        collected.add(term);
        result.push(term);
        remaining -= 1;
      }
      return remaining;
    };

    let beforeRemaining = Math.max(0, beforeCount);
    let afterRemaining = Math.max(0, afterCount);

    let scannedUp = 0;
    let scannedDown = 0;
    let hitTop = false;
    let hitBottom = false;

    let nextUpLine = clampedAnchor;
    let nextDownLine = clampedAnchor + 1;

    const scanUp = (): void => {
      for (
        let line = nextUpLine;
        line >= 0 && beforeRemaining > 0 && scannedUp <= maxScanLines;
        line -= 1, scannedUp += 1
      ) {
        beforeRemaining = addFromLine(line, beforeRemaining);
        nextUpLine = line - 1;
      }
      if (nextUpLine < 0) {
        hitTop = true;
      }
    };

    const scanDown = (): void => {
      for (
        let line = nextDownLine;
        line < lineCount && afterRemaining > 0 && scannedDown <= maxScanLines;
        line += 1, scannedDown += 1
      ) {
        afterRemaining = addFromLine(line, afterRemaining);
        nextDownLine = line + 1;
      }
      if (nextDownLine >= lineCount) {
        hitBottom = true;
      }
    };

    scanUp();
    if (beforeRemaining > 0) {
      afterRemaining += beforeRemaining;
      beforeRemaining = 0;
    }

    scanDown();
    if (afterRemaining > 0) {
      beforeRemaining = afterRemaining;
      afterRemaining = 0;
      scanUp();
    }

    return { terms: result, hitTop, hitBottom };
  }

  public async getTranslatedDocumentText(
    document: vscode.TextDocument,
  ): Promise<string> {
    const settings = getTranslatorSettings();
    const state = await this.getOrBuildDocumentState(
      document,
      !settings.autoTranslate,
    );
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
        toSafeIdentifierTranslation(translated, occurrence.name),
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

    const state = await this.getOrBuildDocumentState(
      document,
      !settings.autoTranslate,
    );
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

      const safeTranslation = toSafeIdentifierTranslation(
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
        safeTranslation,
        occurrence.kind === 'function'
          ? vscode.InlayHintKind.Parameter
          : vscode.InlayHintKind.Type,
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
        vscode.InlayHintKind.Type,
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
    autoTranslateMissing = true,
  ): Promise<DocumentTranslationState> {
    const key = document.uri.toString();
    const existing = this.documentState.get(key);
    if (existing) {
      return existing;
    }

    const occurrences = await this.collectOccurrences(document);
    const translationByOriginal = await this.buildOriginalToTranslationMap(
      occurrences,
      autoTranslateMissing,
    );
    const translateComments = this.shouldTranslateComments();
    const comments = translateComments ? collectComments(document) : [];
    const commentTranslations = translateComments
      ? await this.buildCommentTranslationMap(comments)
      : new Map<string, string>();
    const langId = document.languageId;
    let stringLiterals: StringLiteralOccurrence[] = [];
    let stringLiteralTranslations = new Map<string, string>();
    if (
      this.shouldTranslateStringLiterals(langId) &&
      (langId === 'c' || langId === 'cpp')
    ) {
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
        semanticOccurrences.length === 0
          ? collectFromGenericRegex(document)
          : [];
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
        semanticOccurrences.length === 0
          ? collectFromGenericRegex(document)
          : [];
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
    return extractNormalizedTerms(occurrences, this.buildTranslationFilters());
  }

  private async buildOriginalToTranslationMap(
    occurrences: IdentifierOccurrence[],
    autoTranslateMissing = true,
  ): Promise<Map<string, string>> {
    const settings = getTranslatorSettings();
    const filters = this.buildTranslationFilters();
    const normalizedByOriginal = new Map<string, string>();
    const directByOriginal = new Map<string, string>();
    const terms = new Set<string>();

    for (const occurrence of occurrences) {
      if (
        shouldSkipIdentifier(occurrence.name, filters.skipRegexes) ||
        isKeyword(occurrence.name) ||
        isBlacklistedIdentifier(occurrence.name)
      ) {
        continue;
      }
      const normalized = normalizeIdentifier(occurrence.name).normalized;
      if (!normalized) {
        continue;
      }

      if (
        isProtectedIdentifier(
          occurrence.name,
          normalized,
          filters.protectedTerms,
        )
      ) {
        directByOriginal.set(occurrence.name, occurrence.name);
        continue;
      }

      const glossaryTranslation = findGlossaryTranslation(
        occurrence.name,
        normalized,
        filters.glossary,
      );
      if (glossaryTranslation) {
        directByOriginal.set(occurrence.name, glossaryTranslation);
        continue;
      }

      normalizedByOriginal.set(occurrence.name, normalized);
      terms.add(normalized);
    }

    if (autoTranslateMissing) {
      await this.ensureTermTranslations(Array.from(terms));
    }

    const output = new Map<string, string>();
    for (const [original, translated] of directByOriginal.entries()) {
      output.set(original, translated);
    }
    for (const [original, normalized] of normalizedByOriginal.entries()) {
      const translated = this.cacheStore.get(normalized, settings);
      if (translated && translated !== normalized) {
        output.set(original, translated);
      }
    }
    return output;
  }

  private async ensureTermTranslations(terms: string[]): Promise<void> {
    const settings = getTranslatorSettings();
    const missing = terms.filter(
      (term) => !this.hasUsableCache(term, settings),
    );
    if (missing.length === 0) {
      return;
    }

    const provider = await this.buildProvider(settings);
    const batchSize = Math.max(1, settings.maxBatchTerms);
    const projectContextSummary = await this.getProjectContextSummary();

    const batches: string[][] = [];
    for (let i = 0; i < missing.length; i += batchSize) {
      batches.push(missing.slice(i, i + batchSize));
    }

    await this.runWithConcurrency(
      batches,
      settings.requestConcurrency,
      async (batch) => {
        const translated = await provider.translateBatch({
          terms: batch,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          projectContextSummary,
        });
        this.cacheStore.setMany(translated, settings);
      },
    );
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
    const batches: string[][] = [];
    for (let i = 0; i < missing.length; i += batchSize) {
      batches.push(missing.slice(i, i + batchSize));
    }

    await this.runWithConcurrency(
      batches,
      settings.requestConcurrency,
      async (batch) => {
        const translated = await provider.translateComments({
          comments: batch,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
        });
        this.cacheStore.setManyStringLiterals(translated, settings);
      },
    );
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

    const batches: string[][] = [];
    for (let i = 0; i < missing.length; i += batchSize) {
      batches.push(missing.slice(i, i + batchSize));
    }

    await this.runWithConcurrency(
      batches,
      settings.requestConcurrency,
      async (batch) => {
        const translated = await provider.translateComments({
          comments: batch,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
        });
        this.cacheStore.setManyComments(translated, settings);
      },
    );
  }

  private async runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const resolvedLimit = Math.max(1, Math.floor(limit));
    const maxWorkers = Math.min(resolvedLimit, items.length);
    let nextIndex = 0;
    const runners = Array.from({ length: maxWorkers }, async () => {
      while (true) {
        const current = nextIndex;
        nextIndex += 1;
        if (current >= items.length) {
          break;
        }
        await worker(items[current]);
      }
    });
    await Promise.all(runners);
  }

  private countMissingTerms(
    terms: string[],
    settings: TranslatorSettings,
  ): number {
    return terms.filter((term) => !this.hasUsableCache(term, settings)).length;
  }

  private hasUsableCache(
    term: string,
    settings: TranslatorSettings,
  ): boolean {
    const cached = this.cacheStore.get(term, settings);
    return Boolean(cached && cached !== term);
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
      case 'glm': {
        const apiKey = await this.context.secrets.get(API_KEY_SECRET_KEY);
        if (!apiKey) {
          throw new Error(
            'Missing API key. Run "Code Translator: Set API Key" first.',
          );
        }
        return new GlmProvider(settings, apiKey);
      }
      case 'doubao': {
        const apiKey = await this.context.secrets.get(API_KEY_SECRET_KEY);
        if (!apiKey) {
          throw new Error(
            'Missing API key. Run "Code Translator: Set API Key" first.',
          );
        }
        return new DoubaoProvider(settings, apiKey);
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

  private buildTranslationFilters(): {
    skipRegexes: RegExp[];
    protectedTerms: Set<string>;
    glossary: Map<string, string>;
  } {
    const settings = getTranslatorSettings();
    return {
      skipRegexes: buildSkipRegexes(settings.skipPatterns),
      protectedTerms: buildProtectedTermSet(settings.protectedTerms),
      glossary: buildGlossaryMap(settings.glossary),
    };
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
    const summary = await buildProjectContextSummary(workspaceFolder);
    this.projectContextSummaryCache = summary;
    return summary || undefined;
  }
}
