import * as vscode from 'vscode';
import { TranslationService } from '../translation/translationService';

export class CodeTranslatorInlayHintsProvider
  implements vscode.InlayHintsProvider
{
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeInlayHints = this.changeEmitter.event;

  public constructor(private readonly service: TranslationService) {
    this.service.onDidUpdate(() => this.changeEmitter.fire());
  }

  public async provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.InlayHint[]> {
    return this.service.getInlayHints(document, range);
  }
}
