import * as vscode from 'vscode';
import { collectComments } from '../collector/commentCollector';
import { IdentifierOccurrence } from '../collector/types';
import { normalizeIdentifier, shouldSkipIdentifier } from '../naming/normalize';
import {
  COMMON_KEYWORDS,
  DEFAULT_IDENTIFIER_BLACKLIST,
  IDENTIFIER_REGEX,
  FALLBACK_WORD_MAP,
} from './translationConstants';

export interface MissingTermScanOptions {
  pendingTerms?: Set<string>;
  maxScanLines?: number;
}

export interface MissingTermsScanResult {
  terms: string[];
  hitTop: boolean;
  hitBottom: boolean;
}

export interface TranslationFilters {
  skipRegexes: RegExp[];
  protectedTerms: Set<string>;
  glossary: Map<string, string>;
}

export function isKeyword(identifier: string): boolean {
  return COMMON_KEYWORDS.has(identifier.toLowerCase());
}

export function isBlacklistedIdentifier(identifier: string): boolean {
  const normalized = normalizeIdentifier(identifier).normalized;
  const compact = normalized.replace(/\s+/g, '').toLowerCase();
  return DEFAULT_IDENTIFIER_BLACKLIST.has(compact);
}

export function isProtectedIdentifier(
  identifier: string,
  normalized: string,
  protectedTerms: Set<string>,
): boolean {
  if (protectedTerms.size === 0) {
    return false;
  }
  const lowerOriginal = identifier.toLowerCase();
  const lowerNormalized = normalized.toLowerCase();
  return (
    protectedTerms.has(lowerOriginal) || protectedTerms.has(lowerNormalized)
  );
}

export function findGlossaryTranslation(
  identifier: string,
  normalized: string,
  glossary: Map<string, string>,
): string | undefined {
  if (glossary.size === 0) {
    return undefined;
  }

  const lowerOriginal = identifier.toLowerCase();
  const lowerNormalized = normalized.toLowerCase();
  return glossary.get(lowerOriginal) ?? glossary.get(lowerNormalized) ?? undefined;
}

export function toSafeIdentifierTranslation(
  translated: string,
  fallbackOriginal: string,
): string {
  const trimmed = translated.trim();
  if (!trimmed) {
    return fallbackOriginal;
  }

  const { prefix } = normalizeIdentifier(fallbackOriginal);
  if (!containsCjk(trimmed)) {
    const fallback = buildFallbackIdentifierTranslation(fallbackOriginal);
    if (fallback) {
      return fallback;
    }
  }
  const rawParts = trimmed.match(/[\p{L}\p{N}_$]+/gu) ?? [];
  const parts = rawParts
    .flatMap((part) => part.split(/_+/))
    .map((part) => part.trim())
    .filter(Boolean);
  let merged = joinTranslatedParts(parts);
  if (!merged) {
    return fallbackOriginal;
  }

  if (prefix) {
    if (merged.toLowerCase().startsWith(prefix.toLowerCase())) {
      return merged;
    }
    return `${prefix}${merged}`;
  }

  const firstChar = merged[0];
  if (!/[\p{L}_$]/u.test(firstChar)) {
    merged = `_${merged}`;
  }

  return merged;
}

export function extractNormalizedTerms(
  occurrences: IdentifierOccurrence[],
  filters: TranslationFilters,
): string[] {
  const terms = new Set<string>();
  for (const occurrence of occurrences) {
    if (
      shouldSkipIdentifier(occurrence.name, filters.skipRegexes) ||
      isKeyword(occurrence.name) ||
      isBlacklistedIdentifier(occurrence.name)
    ) {
      continue;
    }
    const normalized = normalizeIdentifier(occurrence.name).normalized;
    if (!normalized) {
      continue;
    }
    if (isProtectedIdentifier(occurrence.name, normalized, filters.protectedTerms)) {
      continue;
    }
    if (findGlossaryTranslation(occurrence.name, normalized, filters.glossary)) {
      continue;
    }
    terms.add(normalized);
  }
  return Array.from(terms);
}

export function stripStringLiterals(line: string): string {
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

export function buildCommentLineMap(
  document: vscode.TextDocument,
): Map<number, vscode.Range[]> {
  const comments = collectComments(document);
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

export function isRangeInAny(range: vscode.Range, ranges: vscode.Range[]): boolean {
  for (const candidate of ranges) {
    if (candidate.contains(range.start) && candidate.contains(range.end)) {
      return true;
    }
  }
  return false;
}

export function collectMissingTermsFromLine(
  lineText: string,
  lineNumber: number,
  commentLineMap: Map<number, vscode.Range[]>,
  filters: TranslationFilters,
  collected: Set<string>,
  pending: Set<string>,
  cacheLookup: (term: string) => boolean,
): string[] {
  const results: string[] = [];
  const commentRanges = commentLineMap.get(lineNumber) ?? [];
  const lineWithoutStrings = stripStringLiterals(lineText);

  IDENTIFIER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IDENTIFIER_REGEX.exec(lineWithoutStrings)) !== null) {
    const name = match[0];
    const start = new vscode.Position(lineNumber, match.index);
    const end = new vscode.Position(lineNumber, match.index + name.length);
    const range = new vscode.Range(start, end);
    if (commentRanges.length > 0 && isRangeInAny(range, commentRanges)) {
      continue;
    }

    if (
      shouldSkipIdentifier(name, filters.skipRegexes) ||
      isKeyword(name) ||
      isBlacklistedIdentifier(name)
    ) {
      continue;
    }

    const normalized = normalizeIdentifier(name).normalized;
    if (!normalized) {
      continue;
    }
    if (isProtectedIdentifier(name, normalized, filters.protectedTerms)) {
      continue;
    }
    if (findGlossaryTranslation(name, normalized, filters.glossary)) {
      continue;
    }
    if (collected.has(normalized) || pending.has(normalized)) {
      continue;
    }
    if (!cacheLookup(normalized)) {
      results.push(normalized);
    }
  }

  return results;
}

export function buildSkipRegexes(patterns: string[]): RegExp[] {
  const result: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      result.push(new RegExp(pattern));
    } catch {
      // Ignore invalid user regex pattern.
    }
  }
  return result;
}

export function buildProtectedTermSet(terms: string[]): Set<string> {
  const set = new Set<string>();
  for (const term of terms) {
    const cleaned = term.trim().toLowerCase();
    if (!cleaned) {
      continue;
    }
    set.add(cleaned);
  }
  return set;
}

export function buildGlossaryMap(
  glossary: Record<string, string>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [rawKey, rawValue] of Object.entries(glossary)) {
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim();
    if (!key || !value) {
      continue;
    }
    map.set(key, value);
  }
  return map;
}

export function containsCjk(text: string): boolean {
  return /[\p{Script=Han}]/u.test(text);
}

export function buildFallbackIdentifierTranslation(
  identifier: string,
): string | undefined {
  const normalized = normalizeIdentifier(identifier);
  if (normalized.parts.length === 0) {
    return undefined;
  }
  const translatedParts = normalized.parts.map(
    (part) => FALLBACK_WORD_MAP.get(part) ?? part,
  );
  const changed = translatedParts.some(
    (part, idx) => part !== normalized.parts[idx],
  );
  if (!changed) {
    return undefined;
  }
  const merged = joinTranslatedParts(translatedParts);
  return normalized.prefix ? `${normalized.prefix}${merged}` : merged;
}

export function joinTranslatedParts(parts: string[]): string {
  return parts.join('_');
}

