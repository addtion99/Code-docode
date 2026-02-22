import { TranslatorSettings } from '../config/settings';
import { OpenAICompatibleProvider } from './openaiCompatibleProvider';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat';

/**
 * DeepSeek API 提供器，使用 OpenAI 兼容接口，默认 baseUrl 与 model。
 */
export class DeepSeekProvider extends OpenAICompatibleProvider {
  public override readonly name = 'deepseek';

  public constructor(
    settings: TranslatorSettings,
    apiKey: string,
  ) {
    const mergedSettings: TranslatorSettings = {
      ...settings,
      apiBaseUrl:
        (settings.apiBaseUrl?.trim() && settings.apiBaseUrl !== '')
          ? settings.apiBaseUrl
          : DEEPSEEK_BASE_URL,
      model:
        (settings.model?.trim() && settings.model !== '')
          ? settings.model
          : DEEPSEEK_DEFAULT_MODEL,
    };
    super(mergedSettings, apiKey);
  }
}
