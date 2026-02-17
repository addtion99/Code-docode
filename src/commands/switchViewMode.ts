import * as vscode from 'vscode';
import { openTranslatedSplitView } from './openSplitView';
import { TranslationService } from '../translation/translationService';
import { TranslatedContentProvider } from '../view/translatedContentProvider';

function isTranslatedTab(tab: vscode.Tab): boolean {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) {
    return input.uri.scheme === 'code-translator';
  }
  if (input instanceof vscode.TabInputTextDiff) {
    return (
      input.original.scheme === 'code-translator' ||
      input.modified.scheme === 'code-translator'
    );
  }
  return false;
}

async function closeAllTranslatedTabs(): Promise<void> {
  const tabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => isTranslatedTab(tab));
  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs, true);
  }
}

async function setViewMode(mode: 'inlay' | 'split'): Promise<void> {
  const config = vscode.workspace.getConfiguration('codeTranslator');
  await config.update('viewMode', mode, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(
    `已切换为 ${mode === 'inlay' ? 'Inlay 虚影模式' : 'Split 左右分屏模式'}`,
  );
}

export function registerUseInlayModeCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(
    'codeTranslator.useInlayMode',
    async () => {
      await setViewMode('inlay');
      await closeAllTranslatedTabs();
    },
  );
}

export function registerUseSplitModeCommand(
  service: TranslationService,
  contentProvider: TranslatedContentProvider,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'codeTranslator.useSplitMode',
    async () => {
      await setViewMode('split');
      await openTranslatedSplitView(service, contentProvider);
    },
  );
}
