import * as vscode from 'vscode';
import { TranslationService } from '../translation/translationService';
import { TranslatedContentProvider } from '../view/translatedContentProvider';
import { showTranslatedResultForActiveEditor } from './showTranslatedResult';

export function registerTranslateProjectCommand(
  service: TranslationService,
  contentProvider: TranslatedContentProvider,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'codeTranslator.translateThisProject',
    async () => {
      if (!vscode.workspace.workspaceFolders?.length) {
        void vscode.window.showWarningMessage(
          'Please open a workspace folder first.',
        );
        return;
      }

      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Code Decode: Translating project identifiers...',
            cancellable: false,
          },
          async () => service.translateWorkspace(),
        );

        const activeDocument = vscode.window.activeTextEditor?.document;
        if (activeDocument && activeDocument.uri.scheme === 'file') {
          await service.translateCurrentFile(activeDocument);
        }
        await showTranslatedResultForActiveEditor(service, contentProvider);

        void vscode.window.showInformationMessage(
          `Project translation completed. Total ${result.files} files, scanned ${result.scannedFiles}, reused ${result.reusedFiles}, cached ${result.terms} terms, sent ${result.sentTerms} new terms to API.`,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown translation error.';
        void vscode.window.showErrorMessage(`Translation failed: ${message}`);
      }
    },
  );
}
