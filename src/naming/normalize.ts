export interface NormalizedIdentifier {
  original: string;
  normalized: string;
  parts: string[];
  prefix: string;
}

function stripHungarianPrefix(value: string): string {
  if (/^m_[A-Za-z]/.test(value)) {
    return value.slice(2);
  }
  if (/^m[A-Z]/.test(value)) {
    return value.slice(1);
  }
  return value;
}

function extractPreservedPrefix(identifier: string): {
  prefix: string;
  remainder: string;
} {
  const withoutHungarian = stripHungarianPrefix(identifier).replace(/^_+/, '');
  const match = withoutHungarian.match(/^([A-Z0-9]{2,})(_+)/);
  if (!match) {
    return { prefix: '', remainder: withoutHungarian };
  }
  const prefix = match[1] + match[2];
  return {
    prefix,
    remainder: withoutHungarian.slice(prefix.length),
  };
}

export function splitIdentifier(identifier: string): string[] {
  const { remainder } = extractPreservedPrefix(identifier);
  const trimmed = remainder.replace(/[_-]+/g, ' ');

  const withWordBoundaries = trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  return withWordBoundaries
    .split(/\s+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeIdentifier(identifier: string): NormalizedIdentifier {
  const { prefix } = extractPreservedPrefix(identifier);
  const parts = splitIdentifier(identifier);
  return {
    original: identifier,
    normalized: parts.join(' ').trim(),
    parts,
    prefix,
  };
}

export function shouldSkipIdentifier(
  identifier: string,
  skipRegexes: RegExp[],
): boolean {
  if (!identifier) {
    return true;
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    return true;
  }

  if (/^\d+$/.test(identifier)) {
    return true;
  }

  if (/^[A-Z0-9_]{1,2}$/.test(identifier)) {
    return true;
  }

  if (/^__/.test(identifier)) {
    return true;
  }

  for (const regex of skipRegexes) {
    if (regex.test(identifier)) {
      return true;
    }
  }

  return false;
}

export function buildRenderedIdentifier(
  original: string,
  translated: string,
  mode: 'translatedOnly' | 'bilingual',
): string {
  if (mode === 'translatedOnly') {
    return translated;
  }
  return `${original}(${translated})`;
}
