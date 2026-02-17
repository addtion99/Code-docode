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
    onTextChanged,
    onSaved,
    onClosed,
    onConfigChanged,
    cleanupTimers,
  );
}

export function deactivate() {}
