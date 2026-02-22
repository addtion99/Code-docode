import * as vscode from 'vscode';
import { getTranslatorSettings } from '../config/settings';
import { TranslationService } from '../translation/translationService';
import { TranslatedContentProvider } from '../view/translatedContentProvider';
import { openTranslatedSplitView } from './openSplitView';

export async function showTranslatedResultForActiveEditor(
  service: TranslationService,
  contentProvider: TranslatedContentProvider,
): Promise<void> {
  // #region agent log
  fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'showTranslatedResult.ts:entry',message:'showTranslatedResultForActiveEditor 进入',data:{step:'S1'},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
  // #endregion
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    return;
  }

  const settings = getTranslatorSettings();
  service.invalidateDocument(editor.document.uri);

  if (settings.viewMode === 'split') {
    // #region agent log
    fetch('http://127.0.0.1:7703/ingest/230e8f82-105f-4b4e-9cf0-57c1da17e9bd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a59154'},body:JSON.stringify({sessionId:'a59154',location:'showTranslatedResult.ts:split',message:'viewMode=split，打开 split 视图',data:{step:'S2',viewMode:settings.viewMode},timestamp:Date.now(),hypothesisId:'flow'})}).catch(()=>{});
    // #endregion
    await openTranslatedSplitView(service, contentProvider);
  }
}
