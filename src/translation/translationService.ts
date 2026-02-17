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
import { collectFromSemanticTokens } from '../collector/semanticCollector';
import { collectFromDocumentSymbolsFallback } from '../collector/symbolFallback';
import { IdentifierOccurrence } from '../collector/types';
import {
  buildRenderedIdentifier,
  normalizeIdentifier,
  shouldSkipIdentifier,
} from '../naming/normalize';
import { DemoProvider } from './demoProvider';
import { OpenAICompatibleProvider } from './openaiCompatibleProvider';
import { TranslationProvider } from './provider';

interface DocumentTranslationState {
  occurrences: IdentifierOccurrence[];
  translationByOriginal: Map<string, string>;
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
    const exclude = settings.excludeGlobs.length > 0
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
      } catch {
        // Skip binary/unsupported files and keep an empty marker to avoid re-reading.
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
    const uniqueTerms = Array.from(this.workspaceIndexStore.getWorkspaceTermSet(workspaceKey));
    const sentTerms = this.countMissingTerms(uniqueTerms, settings);
    await this.ensureTermTranslations(uniqueTerms);

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
    await this.cacheStore.init();
    await this.workspaceIndexStore.init();

    const settings = getTranslatorSettings();
    const occurrences = await this.collectOccurrences(document);
    const terms = this.extractNormalizedTerms(occurrences);
    const sentTerms = this.countMissingTerms(terms, settings);
    await this.ensureTermTranslations(terms);

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
    const textMode = settings.renderMode === 'bilingual'
      ? 'bilingual'
      : 'translatedOnly';

    const source = document.getText();
    const replacementCandidates = state.occurrences
      .map((occurrence) => {
        const translated = state.translationByOriginal.get(occurrence.name);
        if (!translated) {
          return undefined;
        }

        const replacement = buildRenderedIdentifier(
          occurrence.name,
          this.toSafeIdentifierTranslation(translated, occurrence.name),
          textMode,
        );

        if (replacement === occurrence.name) {
          return undefined;
        }

        return {
          start: document.offsetAt(occurrence.range.start),
          end: document.offsetAt(occurrence.range.end),
          replacement,
        };
      })
      .filter((item): item is { start: number; end: number; replacement: string } =>
        Boolean(item),
      )
      .sort((a, b) => b.start - a.start);

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

      const key = `${occurrence.range.start.line}:${occurrence.range.start.character}:${occurrence.name}`;
      if (dedupe.has(key)) {
        continue;
      }
      dedupe.add(key);

      const hint = new vscode.InlayHint(
        occurrence.range.end,
        `: ${translated}`,
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
  ): Promise<DocumentTranslationState> {
    const key = document.uri.toString();
    const existing = this.documentState.get(key);
    if (existing) {
      return existing;
    }

    const occurrences = await this.collectOccurrences(document);
    const translationByOriginal = await this.buildOriginalToTranslationMap(
      occurrences,
    );
    const state: DocumentTranslationState = {
      occurrences,
      translationByOriginal,
    };
    this.documentState.set(key, state);
    await this.cacheStore.flush();
    this.updateEmitter.fire();
    return state;
  }

  private async collectOccurrences(
    document: vscode.TextDocument,
  ): Promise<IdentifierOccurrence[]> {
    let occurrences = await collectFromSemanticTokens(document);
    if (occurrences.length === 0) {
      occurrences = await collectFromDocumentSymbolsFallback(document);
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

  private extractNormalizedTerms(occurrences: IdentifierOccurrence[]): string[] {
    const settings = getTranslatorSettings();
    const skipRegexes = this.buildSkipRegexes(settings.skipPatterns);
    const protectedTerms = this.buildProtectedTermSet(settings.protectedTerms);
    const glossary = this.buildGlossaryMap(settings.glossary);
    const terms = new Set<string>();
    for (const occurrence of occurrences) {
      if (shouldSkipIdentifier(occurrence.name, skipRegexes)) {
        continue;
      }
      const normalized = normalizeIdentifier(occurrence.name).normalized;
      if (!normalized) {
        continue;
      }
      if (this.isProtectedIdentifier(occurrence.name, normalized, protectedTerms)) {
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
      if (shouldSkipIdentifier(occurrence.name, skipRegexes)) {
        continue;
      }
      const normalized = normalizeIdentifier(occurrence.name).normalized;
      if (!normalized) {
        continue;
      }

      if (this.isProtectedIdentifier(occurrence.name, normalized, protectedTerms)) {
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
    const missing = terms.filter((term) => !this.cacheStore.get(term, settings));
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

  private async buildProvider(settings: ReturnType<typeof getTranslatorSettings>): Promise<TranslationProvider> {
    switch (settings.provider) {
      case 'demo':
        return new DemoProvider();
      case 'gemini':
      case 'openrouter':
      case 'deepseek':
      case 'siliconflow':
      case 'moonshot':
      case 'groq':
      case 'together':
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

  private buildGlossaryMap(glossary: TranslatorSettings['glossary']): Map<string, string> {
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
      protectedTerms.has(lowerOriginal) ||
      protectedTerms.has(lowerNormalized)
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
      glossary.get(lowerOriginal) ??
      glossary.get(lowerNormalized) ??
      undefined
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

    const parts = trimmed.match(/[\p{L}\p{N}_$]+/gu) ?? [];
    let merged = parts.join('');
    if (!merged) {
      return fallbackOriginal;
    }

    const firstChar = merged[0];
    if (!/[\p{L}_$]/u.test(firstChar)) {
      merged = `_${merged}`;
    }

    return merged;
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

    const readRootFile = async (fileName: string): Promise<string | undefined> => {
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
