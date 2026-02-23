import * as vscode from 'vscode';
import { ProviderType } from '../config/settings';
import { TranslationService } from '../translation/translationService';

interface ProviderPreset {
  id: ProviderType;
  label: string;
  description: string;
  apiBaseUrl?: string;
  model?: string;
}

const PRESETS: ProviderPreset[] = [
  {
    id: 'gemini',
    label: 'Google Gemini (默认)',
    description: 'AI Studio OpenAI兼容接口',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash-lite',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: '聚合多模型 OpenAI兼容接口',
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek OpenAI兼容接口',
    apiBaseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    id: 'glm',
    label: '智谱 GLM-4-FlashX-250414',
    description: '智谱AI开放平台（OpenAI兼容接口，FlashX超低价）',
    apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'GLM-4-FlashX-250414',
  },
  {
    id: 'doubao',
    label: '火山方舟 Doubao',
    description: '火山方舟 OpenAI兼容接口',
    apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1-6-lite-251015',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    description: '硅基流动 OpenAI兼容接口',
    apiBaseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-72B-Instruct',
  },
  {
    id: 'moonshot',
    label: 'Moonshot',
    description: 'Kimi OpenAI兼容接口',
    apiBaseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },
  {
    id: 'groq',
    label: 'Groq',
    description: 'Groq OpenAI兼容接口',
    apiBaseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
  },
  {
    id: 'together',
    label: 'Together AI',
    description: 'Together OpenAI兼容接口',
    apiBaseUrl: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM-4',
    description: '智谱AI开放平台 GLM-4 系列',
    apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
  {
    id: 'openaiCompatible',
    label: 'OpenAI Compatible (通用)',
    description: '自行填写 baseUrl/model',
  },
  {
    id: 'custom',
    label: 'Custom',
    description: '完全自定义兼容服务',
  },
  {
    id: 'demo',
    label: 'Demo (离线)',
    description: '本地词典演示，不走API',
  },
];

export function registerSelectProviderCommand(
  translationService: TranslationService,
): vscode.Disposable {
  const handler = async (): Promise<void> => {
    const picked = await vscode.window.showQuickPick(
      PRESETS.map((item) => ({
        label: item.label,
        description: item.description,
        item,
      })),
      {
        title: '选择翻译服务商',
        placeHolder: '选择后自动写入 provider，部分预设会填充 baseUrl/model',
        ignoreFocusOut: true,
      },
    );

    if (!picked) {
      return;
    }

    const config = vscode.workspace.getConfiguration('codeTranslator');
    await config.update(
      'provider',
      picked.item.id,
      vscode.ConfigurationTarget.Global,
    );
    if (picked.item.apiBaseUrl) {
      await config.update(
        'apiBaseUrl',
        picked.item.apiBaseUrl,
        vscode.ConfigurationTarget.Global,
      );
    }
    if (picked.item.model) {
      await config.update(
        'model',
        picked.item.model,
        vscode.ConfigurationTarget.Global,
      );
    }

    void vscode.window.showInformationMessage(
      `已切换服务商：${picked.item.label}`,
    );

    const apiKey = await vscode.window.showInputBox({
      prompt: `请输入 ${picked.item.label} 的 API Key（将安全保存到 VSCode Secret）`,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.trim().length === 0 ? 'API key 不能为空。' : undefined,
    });

    if (!apiKey) {
      return;
    }

    await translationService.setApiKey(apiKey);
    try {
      await translationService.validateCurrentProviderConnection();
      void vscode.window.showInformationMessage(
        `API Key 已保存并验证通过：${picked.item.label}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `API Key 已保存，但连通性验证失败：${message}`,
      );
    }
  };

  const selectProviderCommand = vscode.commands.registerCommand(
    'codeTranslator.selectProvider',
    handler,
  );
  const setApiProviderCommand = vscode.commands.registerCommand(
    'codeTranslator.setApiProvider',
    handler,
  );

  return vscode.Disposable.from(selectProviderCommand, setApiProviderCommand);
}
