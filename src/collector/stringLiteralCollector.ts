import * as vscode from 'vscode';
import { StringLiteralOccurrence } from './types';

function isPreprocessorLine(lineText: string): boolean {
  return /^\s*#/.test(lineText);
}

/**
 * 收集 C/C++ 双引号字符串字面量（用于翻译如 YY_FATAL_ERROR("...") 中的提示文本）。
 * 跳过预处理器行上的字符串。
 */
export function collectCStringLiterals(
  document: vscode.TextDocument,
): StringLiteralOccurrence[] {
  const results: StringLiteralOccurrence[] = [];
  const text = document.getText();
  let i = 0;

  while (i < text.length) {
    if (text[i] === '"') {
      const quoteStart = i;
      i += 1;
      const contentStart = i;
      let content = '';
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') {
          i += 1;
          if (i < text.length) {
            content += text[i];
            i += 1;
          }
          continue;
        }
        content += text[i];
        i += 1;
      }
      const contentEnd = i;
      if (i < text.length) {
        i += 1; // closing "
      }
      const quoteEnd = i;

      const startPos = document.positionAt(quoteStart);
      const lineText = document.lineAt(startPos.line).text;
      if (isPreprocessorLine(lineText)) {
        continue;
      }
      if (content.length === 0) {
        continue;
      }
      results.push({
        text: content,
        range: new vscode.Range(
          document.positionAt(quoteStart),
          document.positionAt(quoteEnd),
        ),
        contentRange: new vscode.Range(
          document.positionAt(contentStart),
          document.positionAt(contentEnd),
        ),
      });
      continue;
    }
    if (text[i] === "'") {
      i += 1;
      while (i < text.length && text[i] !== "'") {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
      if (i < text.length) i += 1;
      continue;
    }
    i += 1;
  }

  return results;
}
