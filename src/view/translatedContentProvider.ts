import * as vscode from 'vscode';

const TRANSLATED_SCHEME = 'code-translator';

export class TranslatedContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contentMap = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();

  public readonly onDidChange = this.emitter.event;

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentMap.get(uri.toString()) ?? '// No translated content available.';
  }

  public updateContent(uri: vscode.Uri, content: string): void {
    this.contentMap.set(uri.toString(), content);
    this.emitter.fire(uri);
  }

  public clearContent(): void {
    this.contentMap.clear();
  }

  public buildTranslatedUri(originalUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.from({
      scheme: TRANSLATED_SCHEME,
      path: originalUri.path,
      query: `source=${encodeURIComponent(originalUri.toString())}`,
    });
  }

  public isTranslatedUri(uri: vscode.Uri): boolean {
    return uri.scheme === TRANSLATED_SCHEME;
  }

  public getSourceUriFromTranslatedUri(uri: vscode.Uri): vscode.Uri | undefined {
    if (!this.isTranslatedUri(uri)) {
      return undefined;
    }
    const params = new URLSearchParams(uri.query);
    const encoded = params.get('source');
    if (!encoded) {
      return undefined;
    }
    try {
      return vscode.Uri.parse(decodeURIComponent(encoded));
    } catch {
      return undefined;
    }
  }
}

export function getTranslatedScheme(): string {
  return TRANSLATED_SCHEME;
}
