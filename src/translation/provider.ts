import { TranslatorSettings } from '../config/settings';

export interface TranslationRequest {
  terms: string[];
  sourceLanguage: string;
  targetLanguage: string;
  projectContextSummary?: string;
}

export interface TranslationProvider {
  readonly name: string;
  translateBatch(request: TranslationRequest): Promise<Map<string, string>>;
}

export interface TranslationProviderFactoryOptions {
  settings: TranslatorSettings;
  apiKey: string;
}
