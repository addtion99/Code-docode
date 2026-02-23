import * as vscode from 'vscode';

export type RenderMode = 'translatedOnly' | 'bilingual' | 'inlay';
export type ProviderType =
  | 'gemini'
  | 'openaiCompatible'
  | 'openrouter'
  | 'deepseek'
  | 'glm'
  | 'siliconflow'
  | 'moonshot'
  | 'groq'
  | 'together'
  | 'zhipu'
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
  includeGlobs: string[];
  excludeGlobs: string[];
  protectedTerms: string[];
  glossary: Record<string, string>;
  hideDiffIndicators: boolean;
  autoTranslate: boolean;
  autoTranslateDebounceMs: number;
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
    viewMode: config.get<ViewMode>('viewMode', 'split'),
    renderMode: config.get<RenderMode>('renderMode', 'inlay'),
    skipPatterns: config.get<string[]>('skipPatterns', [
      '^[ijk]$',
      '^tmp$',
      '^ctx$',
      '^res$',
    ]),
    maxBatchTerms: config.get<number>('maxBatchTerms', 80),
    requestTimeoutMs: config.get<number>('requestTimeoutMs', 20000),
    includeGlobs: config.get<string[]>('includeGlobs', [
      '**/*.js',
      '**/*.ts',
      '**/*.jsx',
      '**/*.tsx',
      '**/*.c',
      '**/*.cpp',
      '**/*.h',
      '**/*.hpp',
      '**/*.java',
      '**/*.py',
      '**/*.go',
      '**/*.rs',
      '**/*.rb',
      '**/*.php',
      '**/*.swift',
      '**/*.kt',
      '**/*.kts',
      '**/*.scala',
      '**/*.vue',
      '**/*.svelte',
      '**/*.m',
      '**/*.mm',
      '**/*.cs',
      '**/*.fs',
      '**/*.fsx',
      '**/*.r',
      '**/*.R',
      '**/*.lua',
      '**/*.zig',
      '**/*.v',
      '**/*.dart',
    ]),
    excludeGlobs: config.get<string[]>('excludeGlobs', [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/venv/**',
      '**/__pycache__/**',
      '**/.vscode/**',
      '**/target/**',
      '**/.next/**',
      '**/coverage/**',
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
    autoTranslate: config.get<boolean>('autoTranslate', false),
    autoTranslateDebounceMs: config.get<number>('autoTranslateDebounceMs', 2000),
  };
}
