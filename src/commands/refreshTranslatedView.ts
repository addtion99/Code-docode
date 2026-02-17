import * as vscode from 'vscode';
import { TranslationService } from '../translation/translationService';
import { TranslatedContentProvider } from '../view/translatedContentProvider';

async function refreshForSourceDocument(
  service: TranslationService,
  contentProvider: TranslatedContentProvider,
  sourceDocument: vscode.TextDocument,
): Promise<void> {
  if (sourceDocument.uri.scheme !== 'file') {
    return;
  }
  const translatedUri = contentProvider.buildTranslatedUri(sourceDocument.uri);
  const translatedText = await service.getTranslatedDocumentText(sourceDocument);
  contentProvider.updateContent(translatedUri, translatedText);
}

export function registerRefreshTranslatedViewCommand(
  service: TranslationService,
  contentProvider: TranslatedContentProvider,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'codeTranslator.refreshTranslatedView',
    async () => {
      const active = vscode.window.activeTextEditor?.document;
      if (!active) {
        void vscode.window.showWarningMessage('No active editor to refresh.');
        return;
      }

      try {
        let sourceDocument = active;
        if (contentProvider.isTranslatedUri(active.uri)) {
          const sourceUri = contentProvider.getSourceUriFromTranslatedUri(
            active.uri,
          );
          if (!sourceUri) {
            void vscode.window.showWarningMessage(
              'Cannot resolve source document from translated view.',
            );
            return;
          }
          sourceDocument = await vscode.workspace.openTextDocument(sourceUri);
        }

        service.invalidateDocument(sourceDocument.uri);
        await refreshForSourceDocument(service, contentProvider, sourceDocument);
        void vscode.window.showInformationMessage(
          'Translated view refreshed for current file.',
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown refresh error.';
        void vscode.window.showErrorMessage(`Refresh failed: ${message}`);
      }
    },
  );
}

export async function refreshVisibleTranslatedForSource(
  service: TranslationService,
  contentProvider: TranslatedContentProvider,
  sourceDocument: vscode.TextDocument,
): Promise<void> {
  if (sourceDocument.uri.scheme !== 'file') {
    return;
  }
  const translatedUri = contentProvider.buildTranslatedUri(sourceDocument.uri);
  const isVisible = vscode.window.visibleTextEditors.some(
    (editor) => editor.document.uri.toString() === translatedUri.toString(),
  );
  if (!isVisible) {
    return;
  }
  await refreshForSourceDocument(service, contentProvider, sourceDocument);
}
