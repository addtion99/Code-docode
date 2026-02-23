import { TranslatorSettings } from '../config/settings';
import { OpenAICompatibleProvider } from './openaiCompatibleProvider';

const GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const GLM_DEFAULT_MODEL = 'GLM-4-FlashX-250414';

/**
 * GLM API 提供器，使用 OpenAI 兼容接口，默认 baseUrl 与 model。
 */
export class GlmProvider extends OpenAICompatibleProvider {
  public override readonly name = 'glm';

  public constructor(settings: TranslatorSettings, apiKey: string) {
    const mergedSettings: TranslatorSettings = {
      ...settings,
      apiBaseUrl:
        settings.apiBaseUrl?.trim() && settings.apiBaseUrl !== ''
          ? settings.apiBaseUrl
          : GLM_BASE_URL,
      model:
        settings.model?.trim() && settings.model !== ''
          ? settings.model
          : GLM_DEFAULT_MODEL,
    };
    super(mergedSettings, apiKey);
  }
}
