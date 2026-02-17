import * as vscode from 'vscode';
import { TranslationService } from '../translation/translationService';
import { TranslatedContentProvider } from '../view/translatedContentProvider';
import { showTranslatedResultForActiveEditor } from './showTranslatedResult';

export function registerTranslateFileCommand(
  service: TranslationService,
  contentProvider: TranslatedContentProvider,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'codeTranslator.translateThisFile',
    async () => {
      const editor = vscode.window.activeTextEditor;
      const document = editor?.document;
      if (!document || document.uri.scheme !== 'file') {
        void vscode.window.showWarningMessage(
          'Please open a file editor first.',
        );
        return;
      }

      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Code Decode: Translating current file identifiers...',
            cancellable: false,
          },
          async () => service.translateCurrentFile(document),
        );

        await showTranslatedResultForActiveEditor(service, contentProvider);
        void vscode.window.showInformationMessage(
          `Current file translation completed. Extracted ${result.terms} identifier terms, sent ${result.sentTerms} new terms to API.`,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown translation error.';
        void vscode.window.showErrorMessage(`Translate current file failed: ${message}`);
      }
    },
  );
}
