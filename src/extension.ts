import * as vscode from 'vscode';
import {
  registerClearCacheCommand,
  registerSetApiKeyCommand,
  registerSetRequestConcurrencyCommand,
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
import {
  applyGhostTheme,
  registerThemeCommands,
} from './commands/configureTheme';
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
  const setRequestConcurrencyCommand = registerSetRequestConcurrencyCommand();
  const clearCacheCommand = registerClearCacheCommand(translationService);
  const selectProviderCommand = registerSelectProviderCommand(translationService);
  const useInlayModeCommand = registerUseInlayModeCommand();
  const useSplitModeCommand = registerUseSplitModeCommand(
    translationService,
    translatedContentProvider,
  );
  const themeCommands = registerThemeCommands();
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

  const pendingAutoTermsByDoc = new Map<string, Set<string>>();
  const lastAutoVisibleHash = new Map<string, string>();
  const lastAutoAnchorByDoc = new Map<string, number>();
  const minAutoScrollLines = 5;
  const autoTranslateMaxPendingBatches = 4;
  const autoTranslateMaxPendingTerms = autoTranslateMaxPendingBatches *
    Math.max(1, getTranslatorSettings().maxBatchTerms);

  let autoTranslateTimer: NodeJS.Timeout | undefined;
  const scheduleAutoTranslate = (
    editor: vscode.TextEditor | undefined,
    options: { force?: boolean; immediate?: boolean } = {},
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
    const visible = editor.visibleRanges?.[0];
    if (!visible) {
      return;
    }
    const anchorLine = Math.floor(
      (visible.start.line + visible.end.line) / 2,
    );
    const docKey = document.uri.toString();
    const lastAnchor = lastAutoAnchorByDoc.get(docKey);
    if (!options.force && lastAnchor !== undefined) {
      const minDelta = Math.max(
        minAutoScrollLines,
        Math.floor((visible.end.line - visible.start.line + 1) * 0.25),
      );
      if (Math.abs(anchorLine - lastAnchor) < minDelta) {
        return;
      }
    }
    lastAutoAnchorByDoc.set(docKey, anchorLine);
    const visibleHash = `${visible.start.line}:${visible.end.line}`;
    const lastHash = lastAutoVisibleHash.get(document.uri.toString());
    if (!options.force && lastHash === visibleHash) {
      return;
    }
    lastAutoVisibleHash.set(document.uri.toString(), visibleHash);
    const debounceMs = options.immediate
      ? 0
      : Math.max(100, settings.autoTranslateDebounceMs);
    autoTranslateTimer = setTimeout(() => {
      autoTranslateTimer = undefined;
      void (async () => {
        try {
          const docKey = document.uri.toString();
          const pending =
            pendingAutoTermsByDoc.get(docKey) ?? new Set<string>();
          const scanResult = await translationService.collectMissingTermsAroundLine(
            document,
            anchorLine,
            20,
            60,
            { pendingTerms: pending, maxScanLines: 400 },
          );
          for (const term of scanResult.terms) {
            pending.add(term);
          }
          if (pending.size > 0) {
            pendingAutoTermsByDoc.set(docKey, pending);
          }
          const shouldFlushBySize = pending.size >= settings.maxBatchTerms;
          const shouldFlushByCap = pending.size >= autoTranslateMaxPendingTerms;
          const shouldFlushByBoundary = scanResult.hitTop && scanResult.hitBottom;
          if (shouldFlushBySize || shouldFlushByCap || shouldFlushByBoundary) {
            const maxSend = shouldFlushByBoundary
              ? pending.size
              : Math.max(1, settings.maxBatchTerms);
            const termsToSend = Array.from(pending).slice(0, maxSend);
            for (const term of termsToSend) {
              pending.delete(term);
            }
            if (pending.size === 0) {
              pendingAutoTermsByDoc.delete(docKey);
            } else {
              pendingAutoTermsByDoc.set(docKey, pending);
            }
            if (termsToSend.length > 0) {
              await translationService.translateTerms(termsToSend);
            }
          }
          await refreshVisibleTranslatedForSource(
            translationService,
            translatedContentProvider,
            document,
          );
        } catch {
          // Silent failure — no API key, network error, etc.
        }
      })();
    }, debounceMs);
  };
  const onEditorChanged = vscode.window.onDidChangeActiveTextEditor(scheduleAutoTranslate);
  const onVisibleRangesChanged = vscode.window.onDidChangeTextEditorVisibleRanges(
    (event) => {
      scheduleAutoTranslate(event.textEditor);
    },
  );
  const onSelectionChanged = vscode.window.onDidChangeTextEditorSelection(
    (event) => {
      const editor = event.textEditor;
      if (editor.document.uri.scheme !== 'file') {
        return;
      }
      const activeLine = editor.selection.active.line;
      const docKey = editor.document.uri.toString();
      const lastAnchor = lastAutoAnchorByDoc.get(docKey);
      const bigJump =
        lastAnchor !== undefined &&
        Math.abs(activeLine - lastAnchor) >= minAutoScrollLines * 2;
      const commandJump = event.kind === vscode.TextEditorSelectionChangeKind.Command;
      if (bigJump || commandJump) {
        scheduleAutoTranslate(editor, { force: true, immediate: true });
      }
    },
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
    pendingAutoTermsByDoc.clear();
    lastAutoVisibleHash.clear();
    lastAutoAnchorByDoc.clear();
  });

  // Automatically apply ghost theme on first activation
  void (async () => {
    const hasApplied = context.globalState.get<boolean>('codeTranslator.themeApplied', false);
    if (!hasApplied) {
      await applyGhostTheme();
      await context.globalState.update('codeTranslator.themeApplied', true);
    }
  })();

  context.subscriptions.push(
    translatedContentProviderDisposable,
    inlayDisposable,
    translateProjectCommand,
    translateFileCommand,
    setApiKeyCommand,
    setRequestConcurrencyCommand,
    clearCacheCommand,
    selectProviderCommand,
    useInlayModeCommand,
    useSplitModeCommand,
    ...themeCommands,
    refreshTranslatedViewCommand,
    toggleAutoTranslateCommand,
    onEditorChanged,
    onTextChanged,
    onSaved,
    onClosed,
    onConfigChanged,
    onVisibleRangesChanged,
    onSelectionChanged,
    cleanupTimers,
  );
}

export function deactivate() {}
