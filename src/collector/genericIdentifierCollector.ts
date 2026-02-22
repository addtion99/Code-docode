import * as vscode from 'vscode';
import { IdentifierOccurrence } from './types';
import { collectComments } from './commentCollector';

const IDENTIFIER_REGEX = /[A-Za-z_][A-Za-z0-9_]*/g;

function stripStringLiterals(line: string): string {
  let out = '';
  let i = 0;
  let quote: '"' | "'" | '`' | null = null;

  while (i < line.length) {
    const ch = line[i];
    if (!quote) {
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        out += ' ';
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '\\') {
      out += ' ';
      if (i + 1 < line.length) {
        out += ' ';
      }
      i += 2;
      continue;
    }

    if (ch === quote) {
      out += ' ';
      quote = null;
      i += 1;
      continue;
    }

    out += ' ';
    i += 1;
  }

  return out;
}

function buildCommentLineMap(
  comments: ReturnType<typeof collectComments>,
): Map<number, vscode.Range[]> {
  const map = new Map<number, vscode.Range[]>();
  for (const comment of comments) {
    const startLine = comment.range.start.line;
    const endLine = comment.range.end.line;
    for (let line = startLine; line <= endLine; line += 1) {
      const ranges = map.get(line) ?? [];
      ranges.push(comment.range);
      map.set(line, ranges);
    }
  }
  return map;
}

function isRangeInAny(range: vscode.Range, ranges: vscode.Range[]): boolean {
  for (const candidate of ranges) {
    if (candidate.contains(range.start) && candidate.contains(range.end)) {
      return true;
    }
  }
  return false;
}

export function collectFromGenericRegex(
  document: vscode.TextDocument,
): IdentifierOccurrence[] {
  const comments = collectComments(document);
  const commentLineMap = buildCommentLineMap(comments);
  const results: IdentifierOccurrence[] = [];

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const line = document.lineAt(lineIndex);
    const commentRanges = commentLineMap.get(lineIndex) ?? [];
    const lineWithoutStrings = stripStringLiterals(line.text);

    IDENTIFIER_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IDENTIFIER_REGEX.exec(lineWithoutStrings)) !== null) {
      const name = match[0];
      const start = new vscode.Position(lineIndex, match.index);
      const end = new vscode.Position(lineIndex, match.index + name.length);
      const range = new vscode.Range(start, end);
      if (commentRanges.length > 0 && isRangeInAny(range, commentRanges)) {
        continue;
      }

      // Heuristic: check if followed by optional whitespace then '('
      const afterIndex = match.index + name.length;
      const restOfLine = lineWithoutStrings.substring(afterIndex);
      const isFunction = /^\s*\(/.test(restOfLine);

      results.push({
        name,
        kind: isFunction ? 'function' : 'variable',
        range,
      });
    }
  }

  return results;
}
