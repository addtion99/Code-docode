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
      // #region agent log
      fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'translateFile.ts:command',message:'Translate This File 命令触发',data:{step:1},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
      // #endregion
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

        // #region agent log
        fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'translateFile.ts:afterTranslate',message:'translateCurrentFile 完成，准备展示结果',data:{step:2,terms:result.terms,sentTerms:result.sentTerms},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
        // #endregion
        await showTranslatedResultForActiveEditor(service, contentProvider);
        // #region agent log
        fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'translateFile.ts:afterShowResult',message:'showTranslatedResultForActiveEditor 完成',data:{step:3},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
        // #endregion
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
