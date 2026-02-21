import * as vscode from 'vscode';
import { CommentOccurrence } from './types';

const HASH_COMMENT_LANGUAGES = new Set([
  'python', 'ruby', 'shellscript', 'bash', 'zsh', 'sh', 'perl',
  'r', 'yaml', 'toml', 'coffeescript', 'makefile', 'dockerfile',
  'powershell', 'elixir', 'julia',
]);

const HTML_COMMENT_LANGUAGES = new Set([
  'html', 'xml', 'svg', 'vue', 'svelte', 'markdown',
]);

const DASH_COMMENT_LANGUAGES = new Set([
  'sql', 'lua', 'haskell',
]);

const MIN_COMMENT_LENGTH = 2;

function trimCommentText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

function buildOccurrence(
  document: vscode.TextDocument,
  fullStart: vscode.Position,
  fullEnd: vscode.Position,
  contentStart: vscode.Position,
  contentEnd: vscode.Position,
): CommentOccurrence | undefined {
  const text = trimCommentText(document.getText(new vscode.Range(contentStart, contentEnd)));
  if (text.length < MIN_COMMENT_LENGTH) {
    return undefined;
  }
  return {
    text,
    range: new vscode.Range(fullStart, fullEnd),
    contentRange: new vscode.Range(contentStart, contentEnd),
  };
}

function collectSingleLineComments(
  document: vscode.TextDocument,
  marker: string,
): CommentOccurrence[] {
  const results: CommentOccurrence[] = [];
  const markerLen = marker.length;

  for (let i = 0; i < document.lineCount; i++) {
    const line = document.lineAt(i);
    const lineText = line.text;
    const idx = lineText.indexOf(marker);
    if (idx < 0) {
      continue;
    }

    const fullStart = new vscode.Position(i, idx);
    const fullEnd = line.range.end;
    const contentStart = new vscode.Position(i, idx + markerLen);
    const occ = buildOccurrence(document, fullStart, fullEnd, contentStart, fullEnd);
    if (occ) {
      results.push(occ);
    }
  }

  return results;
}

function collectCStyleBlockComments(
  document: vscode.TextDocument,
): CommentOccurrence[] {
  const results: CommentOccurrence[] = [];
  const text = document.getText();
  const regex = /\/\*([\s\S]*?)\*\//g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const fullStartOffset = match.index;
    const fullEndOffset = match.index + match[0].length;
    const contentStartOffset = fullStartOffset + 2;
    const contentEndOffset = fullEndOffset - 2;

    const fullStart = document.positionAt(fullStartOffset);
    const fullEnd = document.positionAt(fullEndOffset);
    const contentStart = document.positionAt(contentStartOffset);
    const contentEnd = document.positionAt(contentEndOffset);

    const occ = buildOccurrence(document, fullStart, fullEnd, contentStart, contentEnd);
    if (occ) {
      results.push(occ);
    }
  }

  return results;
}

function collectHtmlComments(
  document: vscode.TextDocument,
): CommentOccurrence[] {
  const results: CommentOccurrence[] = [];
  const text = document.getText();
  const regex = /<!--([\s\S]*?)-->/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const fullStartOffset = match.index;
    const fullEndOffset = match.index + match[0].length;
    const contentStartOffset = fullStartOffset + 4;
    const contentEndOffset = fullEndOffset - 3;

    const fullStart = document.positionAt(fullStartOffset);
    const fullEnd = document.positionAt(fullEndOffset);
    const contentStart = document.positionAt(contentStartOffset);
    const contentEnd = document.positionAt(contentEndOffset);

    const occ = buildOccurrence(document, fullStart, fullEnd, contentStart, contentEnd);
    if (occ) {
      results.push(occ);
    }
  }

  return results;
}

export function collectComments(
  document: vscode.TextDocument,
): CommentOccurrence[] {
  const langId = document.languageId;
  const results: CommentOccurrence[] = [];

  const useSlashSlash =
    !HASH_COMMENT_LANGUAGES.has(langId) &&
    !HTML_COMMENT_LANGUAGES.has(langId) &&
    !DASH_COMMENT_LANGUAGES.has(langId);

  if (useSlashSlash) {
    results.push(...collectSingleLineComments(document, '//'));
    results.push(...collectCStyleBlockComments(document));
  }

  if (HASH_COMMENT_LANGUAGES.has(langId)) {
    results.push(...collectSingleLineComments(document, '#'));
  }

  if (HTML_COMMENT_LANGUAGES.has(langId)) {
    results.push(...collectHtmlComments(document));
  }

  if (DASH_COMMENT_LANGUAGES.has(langId)) {
    results.push(...collectSingleLineComments(document, '--'));
  }

  if (['css', 'scss', 'less'].includes(langId)) {
    results.push(...collectCStyleBlockComments(document));
  }

  if (['vue', 'svelte'].includes(langId)) {
    results.push(...collectSingleLineComments(document, '//'));
    results.push(...collectCStyleBlockComments(document));
  }

  results.sort((a, b) =>
    a.range.start.isBefore(b.range.start) ? -1 : 1,
  );

  return results;
}
