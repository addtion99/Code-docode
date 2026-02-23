import * as vscode from 'vscode';
import { IdentifierKind, IdentifierOccurrence } from './types';

/**
 * C/C++ 关键字（不翻译）：ANSI C90 + C99 + C11
 * 预处理指令名称不翻译，指令行上的其他标识符由收集器处理。
 */
const C_CPP_KEYWORDS = new Set([
  'auto',
  'break',
  'case',
  'char',
  'const',
  'continue',
  'default',
  'do',
  'double',
  'else',
  'enum',
  'extern',
  'float',
  'for',
  'goto',
  'if',
  'int',
  'long',
  'register',
  'return',
  'short',
  'signed',
  'sizeof',
  'static',
  'struct',
  'switch',
  'typedef',
  'union',
  'unsigned',
  'void',
  'volatile',
  'while',
  'inline',
  'restrict',
  '_Bool',
  '_Complex',
  '_Imaginary',
  '_Alignas',
  '_Alignof',
  '_Atomic',
  '_Generic',
  '_Noreturn',
  '_Static_assert',
  '_Thread_local',
  // C++ 常见关键字
  'class',
  'namespace',
  'template',
  'typename',
  'operator',
  'new',
  'delete',
  'this',
  'virtual',
  'override',
  'final',
  'public',
  'private',
  'protected',
  'true',
  'false',
  'nullptr',
  'bool',
  'catch',
  'throw',
  'try',
  'using',
  'mutable',
  'explicit',
  'friend',
  'typeid',
  'const_cast',
  'dynamic_cast',
  'reinterpret_cast',
  'static_cast',
  'and',
  'and_eq',
  'bitand',
  'bitor',
  'compl',
  'not',
  'not_eq',
  'or',
  'or_eq',
  'xor',
  'xor_eq',
]);

const IDENTIFIER_REGEX = /[A-Za-z_][A-Za-z0-9_]*/g;
const PREPROCESSOR_SKIP_LINE_DIRECTIVES = new Set(['include']);
const MACRO_REGEX = /\b[A-Z][A-Z0-9_]{2,}\b/g;

/**
 * 去掉一行中双引号字符串内容，避免在字符串字面量内误识别标识符。
 * 简单实现：不处理转义，仅匹配 "..."
 */
function stripDoubleQuotedStrings(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      out += ' '; // 占位，保持长度大致一致便于算 offset
      i += 1;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\') {
          i += 2;
          continue;
        }
        out += ' ';
        i += 1;
      }
      if (i < line.length) {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (line[i] === "'") {
      out += ' ';
      i += 1;
      while (i < line.length && line[i] !== "'") {
        if (line[i] === '\\') i += 1;
        out += ' ';
        i += 1;
      }
      if (i < line.length) {
        out += ' ';
        i += 1;
      }
      continue;
    }
    out += line[i];
    i += 1;
  }
  return out;
}

/**
 * 是否为预处理器行（行首可选空白后是 #）
 */
function isPreprocessorLine(lineText: string): boolean {
  return /^\s*#/.test(lineText);
}

/**
 * 去掉行内注释，避免在注释文本中误收集标识符。
 * 简单实现：去掉 // 及之后、以及块注释到其结束符的内容。
 */
function stripLineComments(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line.slice(i, i + 2) === '//') {
      return out + ' '.repeat(line.length - i);
    }
    if (line.slice(i, i + 2) === '/*') {
      out += '  ';
      i += 2;
      while (i < line.length - 1 && line.slice(i, i + 2) !== '*/') {
        out += ' ';
        i += 1;
      }
      if (i < line.length - 1) {
        i += 2;
        out += '  ';
      }
      continue;
    }
    out += line[i];
    i += 1;
  }
  return out;
}

/** 判断 range 是否被任一 forbidden 区间包含（含相等） */
function isRangeContainedIn(
  inner: vscode.Range,
  forbiddenRanges: vscode.Range[],
): boolean {
  for (const outer of forbiddenRanges) {
    if (outer.contains(inner.start) && outer.contains(inner.end)) {
      return true;
    }
  }
  return false;
}

export interface CollectFromCRawOptions {
  /**
   * 由 VS Code 语义 token 得到的“关键字/操作符”区间（与编辑器着色同源）。
   * 若提供，则用这些区间过滤，不再使用内置 C_CPP_KEYWORDS 表。
   */
  semanticKeywordRanges?: vscode.Range[];
}

/**
 * 仅从 C/C++ 预处理行中收集全大写宏标识符（补充 LSP 未覆盖的宏定义）。
 */
export function collectFromCMacroLines(
  document: vscode.TextDocument,
): IdentifierOccurrence[] {
  const results: IdentifierOccurrence[] = [];

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const line = document.lineAt(lineIndex);
    const lineText = line.text;
    if (!isPreprocessorLine(lineText)) {
      continue;
    }

    if (/^\s*#\s*include\b/.test(lineText)) {
      continue;
    }

    const lineNoComments = stripLineComments(lineText);
    const lineWithoutStrings = stripDoubleQuotedStrings(lineNoComments);

    const directiveMatch = lineWithoutStrings.match(IDENTIFIER_REGEX);
    const scanStart =
      directiveMatch && directiveMatch.index !== undefined
        ? directiveMatch.index + directiveMatch[0].length
        : 0;
    const scanText = lineWithoutStrings.slice(scanStart);

    MACRO_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MACRO_REGEX.exec(scanText)) !== null) {
      const name = match[0];
      const startChar = scanStart + match.index;
      const range = new vscode.Range(
        new vscode.Position(lineIndex, startChar),
        new vscode.Position(lineIndex, startChar + name.length),
      );
      results.push({
        name,
        kind: 'macro',
        range,
      });
    }
  }

  return results;
}

/**
 * 对 C/C++ 文件用正则收集所有标识符（不含关键字、预处理指令名）。
 * 优先用 VS Code 的 Semantic Tokens 判定关键字（与着色一致）；无语义信息时回退到内置关键字表。
 */
export function collectFromCRaw(
  document: vscode.TextDocument,
  options: CollectFromCRawOptions = {},
): IdentifierOccurrence[] {
  const { semanticKeywordRanges } = options;
  const useSemanticFilter =
    Array.isArray(semanticKeywordRanges) && semanticKeywordRanges.length > 0;
  const results: IdentifierOccurrence[] = [];

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const line = document.lineAt(lineIndex);
    const lineText = line.text;

    const isPreprocessor = isPreprocessorLine(lineText);
    let skippedDirective = false;
    let directive: string | undefined;
    if (isPreprocessor) {
      const match = lineText.match(IDENTIFIER_REGEX);
      directive = match ? match[0] : undefined;
      if (directive && PREPROCESSOR_SKIP_LINE_DIRECTIVES.has(directive)) {
        continue;
      }
    }

    const lineNoComments = stripLineComments(lineText);
    const lineWithoutStrings = stripDoubleQuotedStrings(lineNoComments);
    IDENTIFIER_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IDENTIFIER_REGEX.exec(lineWithoutStrings)) !== null) {
      const name = match[0];
      const start = new vscode.Position(lineIndex, match.index);
      const end = new vscode.Position(lineIndex, match.index + name.length);
      const range = new vscode.Range(start, end);

      if (isPreprocessor && !skippedDirective) {
        skippedDirective = true;
        continue;
      }

      if (useSemanticFilter) {
        if (isRangeContainedIn(range, semanticKeywordRanges!)) {
          continue;
        }
      } else {
        if (C_CPP_KEYWORDS.has(name)) {
          continue;
        }
      }

      results.push({
        name,
        kind: 'variable' as IdentifierKind,
        range,
      });
    }
  }

  return results;
}
