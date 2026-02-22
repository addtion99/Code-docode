import * as vscode from 'vscode';
import { IdentifierKind, IdentifierOccurrence } from './types';

const IGNORED_TOKEN_TYPES = new Set([
  'comment', 'string', 'number', 'regexp', 'operator', 'keyword',
]);

function mapSemanticTypeToKind(tokenType: string): IdentifierKind | undefined {
  switch (tokenType) {
    case 'variable':
    case 'parameter':
    case 'property':
    case 'enumMember':
      return 'variable';
    case 'function':
    case 'method':
    case 'member':
      return 'function';
    case 'class':
    case 'type':
    case 'enum':
    case 'interface':
    case 'namespace':
    case 'struct':
    case 'typeParameter':
      return 'type';
    case 'macro':
    case 'decorator':
      return 'macro';
    default:
      if (IGNORED_TOKEN_TYPES.has(tokenType)) {
        return undefined;
      }
      return 'variable';
  }
}

export async function collectFromSemanticTokens(
  document: vscode.TextDocument,
  cancellationToken?: vscode.CancellationToken,
): Promise<IdentifierOccurrence[]> {
  const [legend, tokens] = await Promise.all([
    vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
      'vscode.provideDocumentSemanticTokensLegend',
      document.uri,
    ),
    vscode.commands.executeCommand<vscode.SemanticTokens>(
      'vscode.provideDocumentSemanticTokens',
      document.uri,
    ),
  ]);

  if (!legend || !tokens) {
    return [];
  }

  const result: IdentifierOccurrence[] = [];
  const data = tokens.data;
  let line = 0;
  let character = 0;

  for (let i = 0; i < data.length; i += 5) {
    if (cancellationToken?.isCancellationRequested) {
      return [];
    }

    const deltaLine = data[i];
    const deltaStart = data[i + 1];
    const length = data[i + 2];
    const tokenTypeIdx = data[i + 3];

    line += deltaLine;
    character = deltaLine === 0 ? character + deltaStart : deltaStart;

    const tokenType = legend.tokenTypes[tokenTypeIdx];
    const kind = tokenType ? mapSemanticTypeToKind(tokenType) : undefined;
    if (!kind) {
      continue;
    }

    const start = new vscode.Position(line, character);
    const end = new vscode.Position(line, character + length);
    const range = new vscode.Range(start, end);
    const name = document.getText(range);

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      continue;
    }

    result.push({ name, kind, range });
  }

  return result;
}
