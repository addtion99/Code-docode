import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { TranslatorSettings } from '../config/settings';

interface PersistedCacheShape {
  version: number;
  data: Record<string, string>;
}

const CACHE_FILE_NAME = 'identifier-translations.json';
const CACHE_STATE_VERSION = 1;

export class CacheStore {
  private readonly cache = new Map<string, string>();
  private initialized = false;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const cachePath = this.getCacheFilePath();
    await fs.mkdir(path.dirname(cachePath), { recursive: true });

    try {
      const raw = await fs.readFile(cachePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedCacheShape;
      if (parsed.version !== CACHE_STATE_VERSION || !parsed.data) {
        this.initialized = true;
        return;
      }
      for (const [key, value] of Object.entries(parsed.data)) {
        this.cache.set(key, value);
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT') {
        throw error;
      }
    }

    this.initialized = true;
  }

  public get(normalizedTerm: string, settings: TranslatorSettings): string | undefined {
    return this.cache.get(this.buildCacheKey(normalizedTerm, settings));
  }

  public set(
    normalizedTerm: string,
    translated: string,
    settings: TranslatorSettings,
  ): void {
    this.cache.set(this.buildCacheKey(normalizedTerm, settings), translated);
  }

  public setMany(
    entries: Map<string, string>,
    settings: TranslatorSettings,
  ): void {
    for (const [normalizedTerm, translated] of entries.entries()) {
      this.set(normalizedTerm, translated, settings);
    }
  }

  public async flush(): Promise<void> {
    await this.init();
    const payload: PersistedCacheShape = {
      version: CACHE_STATE_VERSION,
      data: Object.fromEntries(this.cache.entries()),
    };
    await fs.writeFile(this.getCacheFilePath(), JSON.stringify(payload, null, 2), 'utf8');
  }

  public async clear(): Promise<void> {
    this.cache.clear();
    await this.flush();
  }

  private getCacheFilePath(): string {
    return path.join(this.context.globalStorageUri.fsPath, CACHE_FILE_NAME);
  }

  private buildCacheKey(normalizedTerm: string, settings: TranslatorSettings): string {
    return [
      settings.provider,
      settings.model,
      settings.sourceLanguage,
      settings.targetLanguage,
      normalizedTerm,
    ].join('|');
  }
}
