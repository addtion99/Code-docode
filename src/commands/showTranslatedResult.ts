import * as vscode from 'vscode';
import { getTranslatorSettings } from '../config/settings';
import { TranslationService } from '../translation/translationService';
import { TranslatedContentProvider } from '../view/translatedContentProvider';
import { openTranslatedSplitView } from './openSplitView';

export async function showTranslatedResultForActiveEditor(
  service: TranslationService,
  contentProvider: TranslatedContentProvider,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    return;
  }

  const settings = getTranslatorSettings();
  service.invalidateDocument(editor.document.uri);

  if (settings.viewMode === 'split') {
    await openTranslatedSplitView(service, contentProvider);
  }
}
