import * as vscode from 'vscode';

export type RenderMode = 'translatedOnly' | 'bilingual' | 'inlay';
export type ProviderType =
  | 'gemini'
  | 'openaiCompatible'
  | 'openrouter'
  | 'deepseek'
  | 'siliconflow'
  | 'moonshot'
  | 'groq'
  | 'together'
  | 'custom'
  | 'demo'
  | 'deepl';
export type ViewMode = 'inlay' | 'split';

export interface TranslatorSettings {
  provider: ProviderType;
  apiBaseUrl: string;
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  viewMode: ViewMode;
  renderMode: RenderMode;
  skipPatterns: string[];
  maxBatchTerms: number;
  requestTimeoutMs: number;
  excludeGlobs: string[];
  protectedTerms: string[];
  glossary: Record<string, string>;
  hideDiffIndicators: boolean;
}

export const API_KEY_SECRET_KEY = 'codeTranslator.apiKey';

export function getTranslatorSettings(): TranslatorSettings {
  const config = vscode.workspace.getConfiguration('codeTranslator');
  return {
    provider: config.get<ProviderType>('provider', 'gemini'),
    apiBaseUrl: config.get<string>(
      'apiBaseUrl',
      'https://generativelanguage.googleapis.com/v1beta/openai',
    ),
    model: config.get<string>('model', 'gemini-2.5-flash-lite'),
    sourceLanguage: config.get<string>('sourceLanguage', 'en'),
    targetLanguage: config.get<string>('targetLanguage', 'zh-CN'),
    viewMode: config.get<ViewMode>('viewMode', 'inlay'),
    renderMode: config.get<RenderMode>('renderMode', 'inlay'),
    skipPatterns: config.get<string[]>('skipPatterns', [
      '^[ijk]$',
      '^tmp$',
      '^ctx$',
      '^res$',
    ]),
    maxBatchTerms: config.get<number>('maxBatchTerms', 80),
    requestTimeoutMs: config.get<number>('requestTimeoutMs', 20000),
    excludeGlobs: config.get<string[]>('excludeGlobs', [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
    ]),
    protectedTerms: config.get<string[]>('protectedTerms', [
      'ctx',
      'dto',
      'http',
      'https',
      'json',
      'url',
      'id',
      'ids',
    ]),
    glossary: config.get<Record<string, string>>('glossary', {}),
    hideDiffIndicators: config.get<boolean>('hideDiffIndicators', true),
  };
}
