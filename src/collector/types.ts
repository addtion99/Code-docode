import * as vscode from 'vscode';

export type IdentifierKind = 'variable' | 'function';

export interface IdentifierOccurrence {
  name: string;
  kind: IdentifierKind;
  range: vscode.Range;
}

export interface CommentOccurrence {
  text: string;
  range: vscode.Range;
  contentRange: vscode.Range;
}
