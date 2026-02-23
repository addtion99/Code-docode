import { TranslatorSettings } from '../config/settings';
import { OpenAICompatibleProvider } from './openaiCompatibleProvider';

const DOUBAO_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DOUBAO_DEFAULT_MODEL = 'doubao-seed-1.6-lite';

/**
 * 火山方舟 Doubao API 提供器，使用 OpenAI 兼容接口，默认 baseUrl 与 model。
 */
export class DoubaoProvider extends OpenAICompatibleProvider {
  public override readonly name = 'doubao';

  public constructor(
    settings: TranslatorSettings,
    apiKey: string,
  ) {
    const mergedSettings: TranslatorSettings = {
      ...settings,
      apiBaseUrl:
        (settings.apiBaseUrl?.trim() && settings.apiBaseUrl !== '')
          ? settings.apiBaseUrl
          : DOUBAO_BASE_URL,
      model:
        (settings.model?.trim() && settings.model !== '')
          ? settings.model
          : DOUBAO_DEFAULT_MODEL,
    };
    super(mergedSettings, apiKey);
  }
}
