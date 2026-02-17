import * as vscode from 'vscode';
import { IdentifierKind, IdentifierOccurrence } from './types';

function mapSymbolKind(kind: vscode.SymbolKind): IdentifierKind | undefined {
  switch (kind) {
    case vscode.SymbolKind.Function:
    case vscode.SymbolKind.Method:
      return 'function';
    case vscode.SymbolKind.Variable:
    case vscode.SymbolKind.Constant:
    case vscode.SymbolKind.Field:
    case vscode.SymbolKind.Property:
      return 'variable';
    default:
      return undefined;
  }
}

function flattenSymbols(
  symbols: vscode.DocumentSymbol[],
  map: Map<string, IdentifierKind>,
): void {
  for (const symbol of symbols) {
    const mappedKind = mapSymbolKind(symbol.kind);
    if (mappedKind && /^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol.name)) {
      map.set(symbol.name, mappedKind);
    }
    if (symbol.children.length > 0) {
      flattenSymbols(symbol.children, map);
    }
  }
}

function isWordBoundary(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) {
    return true;
  }
  return !/[A-Za-z0-9_]/.test(text[index]);
}

function findIdentifierOccurrencesInLine(
  lineText: string,
  identifier: string,
): number[] {
  const positions: number[] = [];
  let startAt = 0;
  while (startAt < lineText.length) {
    const idx = lineText.indexOf(identifier, startAt);
    if (idx < 0) {
      break;
    }
    const before = idx - 1;
    const after = idx + identifier.length;
    if (isWordBoundary(lineText, before) && isWordBoundary(lineText, after)) {
      positions.push(idx);
    }
    startAt = idx + identifier.length;
  }
  return positions;
}

export async function collectFromDocumentSymbolsFallback(
  document: vscode.TextDocument,
  cancellationToken?: vscode.CancellationToken,
): Promise<IdentifierOccurrence[]> {
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    'vscode.executeDocumentSymbolProvider',
    document.uri,
  );

  if (!symbols || symbols.length === 0) {
    return [];
  }

  const namedKinds = new Map<string, IdentifierKind>();
  flattenSymbols(symbols, namedKinds);
  if (namedKinds.size === 0) {
    return [];
  }

  const results: IdentifierOccurrence[] = [];
  for (let line = 0; line < document.lineCount; line += 1) {
    if (cancellationToken?.isCancellationRequested) {
      return [];
    }
    const lineText = document.lineAt(line).text;
    for (const [name, kind] of namedKinds.entries()) {
      const positions = findIdentifierOccurrencesInLine(lineText, name);
      for (const startChar of positions) {
        const range = new vscode.Range(
          new vscode.Position(line, startChar),
          new vscode.Position(line, startChar + name.length),
        );
        results.push({ name, kind, range });
      }
    }
  }

  return results;
}
