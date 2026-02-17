import * as vscode from 'vscode';
import { TranslationService } from '../translation/translationService';
import { ProviderType } from '../config/settings';

const GEMINI_FREE_TIER_CANDIDATE_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

function hasUserConfiguredValue<T>(
  config: vscode.WorkspaceConfiguration,
  key: string,
): boolean {
  const inspected = config.inspect<T>(key);
  if (!inspected) {
    return false;
  }
  return (
    inspected.globalValue !== undefined ||
    inspected.workspaceValue !== undefined ||
    inspected.workspaceFolderValue !== undefined ||
    inspected.globalLanguageValue !== undefined ||
    inspected.workspaceLanguageValue !== undefined ||
    inspected.workspaceFolderLanguageValue !== undefined
  );
}

async function applyGeminiDefaults(options?: { force?: boolean }): Promise<void> {
  const config = vscode.workspace.getConfiguration('codeTranslator');
  const updates: Array<Thenable<void>> = [];
  const target = vscode.ConfigurationTarget.Global;
  const force = options?.force === true;

  const setValue = <T>(key: string, value: T): void => {
    if (force || !hasUserConfiguredValue<T>(config, key)) {
      updates.push(config.update(key, value, target));
    }
  };

  setValue('provider', 'gemini');
  setValue(
    'apiBaseUrl',
    'https://generativelanguage.googleapis.com/v1beta/openai',
  );
  setValue('model', 'gemini-2.5-flash-lite');
  setValue('sourceLanguage', 'en');
  setValue('targetLanguage', 'zh-CN');

  if (updates.length > 0) {
    await Promise.all(updates);
  }
}

export function registerSetApiKeyCommand(
  service: TranslationService,
): vscode.Disposable {
  return vscode.commands.registerCommand('codeTranslator.setApiKey', async () => {
    const apiKey = await vscode.window.showInputBox({
      prompt: 'Enter translation API key',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.trim().length === 0 ? 'API key cannot be empty.' : undefined,
    });

    if (!apiKey) {
      return;
    }

    await service.setApiKey(apiKey);
    await applyGeminiDefaults();
    const config = vscode.workspace.getConfiguration('codeTranslator');

    try {
      const selectedModel = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Code Translator: Validating API key and available Gemini model...',
          cancellable: false,
        },
        async () => {
          const provider = config.get<ProviderType>('provider', 'gemini');
          if (provider !== 'gemini') {
            await service.validateCurrentProviderConnection();
            return config.get<string>('model', 'custom-model');
          }

          let lastError: unknown;
          for (const model of GEMINI_FREE_TIER_CANDIDATE_MODELS) {
            try {
              await config.update(
                'model',
                model,
                vscode.ConfigurationTarget.Global,
              );
              await service.validateCurrentProviderConnection();
              return model;
            } catch (error) {
              lastError = error;
            }
          }
          throw lastError ?? new Error('No available Gemini model found.');
        },
      );
      void vscode.window.showInformationMessage(
        `Success: API key saved and validated with model "${selectedModel}".`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown validation error.';
      const protocolError = /Invalid URL protocol/i.test(message);

      if (protocolError) {
        try {
          await applyGeminiDefaults({ force: true });
          let selectedModel = '';
          let lastRetryError: unknown;
          for (const model of GEMINI_FREE_TIER_CANDIDATE_MODELS) {
            try {
              await config.update(
                'model',
                model,
                vscode.ConfigurationTarget.Global,
              );
              await service.validateCurrentProviderConnection();
              selectedModel = model;
              break;
            } catch (error) {
              lastRetryError = error;
            }
          }
          if (!selectedModel) {
            throw lastRetryError ?? new Error('No available Gemini model after auto-fix.');
          }
          void vscode.window.showInformationMessage(
            `Success: API key saved. Invalid URL config was auto-fixed and model "${selectedModel}" is available.`,
          );
          return;
        } catch (retryError) {
          const retryMessage =
            retryError instanceof Error
              ? retryError.message
              : 'Unknown validation error after auto-fix.';
          void vscode.window.showErrorMessage(
            `API key saved, auto-fix attempted, but validation still failed: ${retryMessage}`,
          );
          return;
        }
      }

      if (/RESOURCE_EXHAUSTED|quota|429/i.test(message)) {
        void vscode.window.showErrorMessage(
          `API key saved, but free-tier quota/model is unavailable: ${message}`,
          'Open AI Studio Usage',
        ).then((choice) => {
          if (choice === 'Open AI Studio Usage') {
            void vscode.env.openExternal(
              vscode.Uri.parse('https://aistudio.google.com/usage'),
            );
          }
        });
        return;
      }

      void vscode.window.showErrorMessage(
        `API key saved, but validation failed: ${message}`,
      );
    }
  });
}

export function registerClearCacheCommand(
  service: TranslationService,
): vscode.Disposable {
  return vscode.commands.registerCommand('codeTranslator.clearCache', async () => {
    await service.clearCache();
    void vscode.window.showInformationMessage(
      'Code Translator cache has been cleared.',
    );
  });
}
