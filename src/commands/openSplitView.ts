import * as vscode from 'vscode';
import * as path from 'path';
import { TranslationService } from '../translation/translationService';
import { TranslatedContentProvider } from '../view/translatedContentProvider';

async function applyDiffEditorPreferences(resource: vscode.Uri): Promise<void> {
  const diffConfig = vscode.workspace.getConfiguration('diffEditor', resource);

  const updateWithFallback = async (
    key: string,
    value: boolean,
  ): Promise<void> => {
    const targets = [
      vscode.ConfigurationTarget.WorkspaceFolder,
      vscode.ConfigurationTarget.Workspace,
      vscode.ConfigurationTarget.Global,
    ];

    let lastError: unknown;
    for (const target of targets) {
      try {
        await diffConfig.update(key, value, target);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    const message =
      lastError instanceof Error ? lastError.message : String(lastError ?? '');
    if (
      message.includes('没有注册配置') ||
      message.includes('is not registered')
    ) {
      return;
    }

    if (lastError) {
      throw lastError;
    }
  };

  await updateWithFallback('renderSideBySide', true);
  await updateWithFallback('useInlineViewWhenSpaceIsLimited', false);
  await updateWithFallback('renderOverviewRuler', false);
  await updateWithFallback('renderIndicators', false);
  await updateWithFallback('renderMarginRevertIcon', false);
}

export function registerOpenSplitViewCommand(
  service: TranslationService,
  contentProvider: TranslatedContentProvider,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'codeTranslator.openTranslatedSplitView',
    async () => openTranslatedSplitView(service, contentProvider),
  );
}

export async function openTranslatedSplitView(
  service: TranslationService,
  contentProvider: TranslatedContentProvider,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage(
      'No active editor found for translated split view.',
    );
    return;
  }

  const sourceDocument = editor.document;
  const originalTop = editor.visibleRanges[0]?.start;
  const originalSelection = editor.selection;
  if (sourceDocument.uri.scheme !== 'file') {
    void vscode.window.showWarningMessage(
      'Translated split view currently supports file documents only.',
    );
    return;
  }

  try {
    // #region agent log
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'openSplitView.ts:getTranslatedText',message:'openTranslatedSplitView 调用 getTranslatedDocumentText',data:{step:'split1'},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
    // #endregion
    const translatedText =
      await service.getTranslatedDocumentText(sourceDocument);
    const translatedUri = contentProvider.buildTranslatedUri(
      sourceDocument.uri,
    );
    contentProvider.updateContent(translatedUri, translatedText);
    // #region agent log
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'openSplitView.ts:diff',message:'contentProvider 已更新，即将执行 vscode.diff',data:{step:'split2'},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
    // #endregion
    await applyDiffEditorPreferences(sourceDocument.uri);
    const title = `Translated: ${path.basename(sourceDocument.fileName)}`;
    await vscode.commands.executeCommand(
      'vscode.diff',
      sourceDocument.uri,
      translatedUri,
      title,
      {
        preview: false,
        viewColumn: vscode.ViewColumn.Active,
        preserveFocus: false,
        selection: originalSelection,
      },
    );

    if (originalTop) {
      const sourceEditor = vscode.window.visibleTextEditors.find(
        (item) =>
          item.document.uri.toString() === sourceDocument.uri.toString(),
      );
      if (sourceEditor) {
        sourceEditor.revealRange(
          new vscode.Range(originalTop, originalTop),
          vscode.TextEditorRevealType.AtTop,
        );
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown split view error.';
    void vscode.window.showErrorMessage(`Open split view failed: ${message}`);
  }
}
