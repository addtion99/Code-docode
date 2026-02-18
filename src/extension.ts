import * as vscode from 'vscode';
import {
  registerClearCacheCommand,
  registerSetApiKeyCommand,
} from './commands/manageCredentials';
import {
  refreshVisibleTranslatedForSource,
  registerRefreshTranslatedViewCommand,
} from './commands/refreshTranslatedView';
import { registerSelectProviderCommand } from './commands/selectProvider';
import {
  registerUseInlayModeCommand,
  registerUseSplitModeCommand,
} from './commands/switchViewMode';
import { registerTranslateFileCommand } from './commands/translateFile';
import { registerTranslateProjectCommand } from './commands/translateProject';
import { getTranslatorSettings } from './config/settings';
import { TranslationService } from './translation/translationService';
import { CodeTranslatorInlayHintsProvider } from './view/inlayHintsProvider';
import {
  getTranslatedScheme,
  TranslatedContentProvider,
} from './view/translatedContentProvider';

export function activate(context: vscode.ExtensionContext) {
  const translationService = new TranslationService(context);
  void translationService.init().catch((error) => {
    const message =
      error instanceof Error ? error.message : 'Unknown initialization error.';
    void vscode.window.showErrorMessage(
      `Code Translator initialization failed: ${message}`,
    );
  });

  const translatedContentProvider = new TranslatedContentProvider();
  const translatedContentProviderDisposable =
    vscode.workspace.registerTextDocumentContentProvider(
      getTranslatedScheme(),
      translatedContentProvider,
    );

  const inlayHintsProvider = new CodeTranslatorInlayHintsProvider(
    translationService,
  );
  const inlayDisposable = vscode.languages.registerInlayHintsProvider(
    [{ scheme: 'file' }, { scheme: 'untitled' }],
    inlayHintsProvider,
  );

  const translateProjectCommand = registerTranslateProjectCommand(
    translationService,
    translatedContentProvider,
  );
  const translateFileCommand = registerTranslateFileCommand(
    translationService,
    translatedContentProvider,
  );
  const setApiKeyCommand = registerSetApiKeyCommand(translationService);
  const clearCacheCommand = registerClearCacheCommand(translationService);
  const selectProviderCommand = registerSelectProviderCommand();
  const useInlayModeCommand = registerUseInlayModeCommand();
  const useSplitModeCommand = registerUseSplitModeCommand(
    translationService,
    translatedContentProvider,
  );
  const refreshTranslatedViewCommand = registerRefreshTranslatedViewCommand(
    translationService,
    translatedContentProvider,
  );

  const toggleAutoTranslateCommand = vscode.commands.registerCommand(
    'codeTranslator.toggleAutoTranslate',
    async () => {
      const config = vscode.workspace.getConfiguration('codeTranslator');
      const current = config.get<boolean>('autoTranslate', false);
      await config.update('autoTranslate', !current, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        `Code Decode: Auto Translate ${current ? 'disabled' : 'enabled'}.`,
      );
    },
  );

  let autoTranslateTimer: NodeJS.Timeout | undefined;
  const scheduleAutoTranslate = (
    editor: vscode.TextEditor | undefined,
  ): void => {
    if (autoTranslateTimer) {
      clearTimeout(autoTranslateTimer);
      autoTranslateTimer = undefined;
    }
    const settings = getTranslatorSettings();
    if (!settings.autoTranslate || !editor || editor.document.uri.scheme !== 'file') {
      return;
    }
    const document = editor.document;
    autoTranslateTimer = setTimeout(() => {
      autoTranslateTimer = undefined;
      void (async () => {
        try {
          await translationService.translateCurrentFile(document);
          await refreshVisibleTranslatedForSource(
            translationService,
            translatedContentProvider,
            document,
          );
        } catch {
          // Silent failure — no API key, network error, etc.
        }
      })();
    }, 2000);
  };
  const onEditorChanged = vscode.window.onDidChangeActiveTextEditor(scheduleAutoTranslate);

  const pendingRefreshTimers = new Map<string, NodeJS.Timeout>();
  const scheduleVisibleTranslatedRefresh = (
    document: vscode.TextDocument,
    debounceMs = 120,
  ): void => {
    const key = document.uri.toString();
    const existing = pendingRefreshTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      pendingRefreshTimers.delete(key);
      void refreshVisibleTranslatedForSource(
        translationService,
        translatedContentProvider,
        document,
      ).catch(() => {
        // Ignore transient refresh failure while typing.
      });
    }, debounceMs);
    pendingRefreshTimers.set(key, timer);
  };

  const onTextChanged = vscode.workspace.onDidChangeTextDocument((event) => {
    translationService.invalidateDocument(event.document.uri);
    scheduleVisibleTranslatedRefresh(event.document, 120);
    scheduleAutoTranslate(vscode.window.activeTextEditor);
  });
  const onSaved = vscode.workspace.onDidSaveTextDocument((document) => {
    translationService.invalidateDocument(document.uri);
    scheduleVisibleTranslatedRefresh(document, 0);
  });
  const onClosed = vscode.workspace.onDidCloseTextDocument((document) => {
    translationService.invalidateDocument(document.uri);
    const timer = pendingRefreshTimers.get(document.uri.toString());
    if (timer) {
      clearTimeout(timer);
      pendingRefreshTimers.delete(document.uri.toString());
    }
  });
  const onConfigChanged = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('codeTranslator')) {
      translationService.invalidateAllDocuments();
      for (const editor of vscode.window.visibleTextEditors) {
        const sourceUri = translatedContentProvider.getSourceUriFromTranslatedUri(
          editor.document.uri,
        );
        if (!sourceUri) {
          continue;
        }
        void (async () => {
          try {
            const document = await vscode.workspace.openTextDocument(sourceUri);
            await refreshVisibleTranslatedForSource(
              translationService,
              translatedContentProvider,
              document,
            );
          } catch {
            // Ignore missing source documents.
          }
        })();
      }
    }
  });

  const cleanupTimers = new vscode.Disposable(() => {
    if (autoTranslateTimer) {
      clearTimeout(autoTranslateTimer);
      autoTranslateTimer = undefined;
    }
    for (const timer of pendingRefreshTimers.values()) {
      clearTimeout(timer);
    }
    pendingRefreshTimers.clear();
  });

  context.subscriptions.push(
    translatedContentProviderDisposable,
    inlayDisposable,
    translateProjectCommand,
    translateFileCommand,
    setApiKeyCommand,
    clearCacheCommand,
    selectProviderCommand,
    useInlayModeCommand,
    useSplitModeCommand,
    refreshTranslatedViewCommand,
    toggleAutoTranslateCommand,
    onEditorChanged,
    onTextChanged,
    onSaved,
    onClosed,
    onConfigChanged,
    cleanupTimers,
  );
}

export function deactivate() {}
