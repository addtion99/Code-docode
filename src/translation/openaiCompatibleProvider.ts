import * as http from 'http';
import * as https from 'https';
import { TranslatorSettings } from '../config/settings';
import { CommentTranslationRequest, TranslationProvider, TranslationRequest } from './provider';

function normalizeApiBaseUrl(input: string): string {
  let value = input.trim();
  value = value.replace(/^['"`\s]+|['"`\s]+$/g, '');

  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) {
    value = `https://${value}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `Invalid API base URL: "${input}". Please set a valid URL like https://generativelanguage.googleapis.com/v1beta/openai`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Invalid URL protocol "${parsed.protocol}". API base URL must start with http:// or https://`,
    );
  }

  const cleanedPath = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${cleanedPath}`;
}

function extractJsonPayload(content: string): Record<string, string> {
  const fenced = content.match(/```json\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : content;
  const parsed = JSON.parse(jsonText) as Record<string, string>;
  return parsed;
}

function extractTsvPayload(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const tabIdx = line.indexOf('\t');
    if (tabIdx <= 0) {
      continue;
    }
    const key = line.slice(0, tabIdx).trim();
    const value = line.slice(tabIdx + 1).trim();
    if (!key || !value) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function parseTermMap(content: string): Record<string, string> {
  try {
    return extractJsonPayload(content);
  } catch {
    return extractTsvPayload(content);
  }
}

async function postJson(
  urlString: string,
  payload: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ statusCode: number; body: string }> {
  const payloadText = JSON.stringify(payload);
  const url = new URL(urlString);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': String(Buffer.byteLength(payloadText)),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
        );
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Translation request timed out.'));
    });
    req.on('error', reject);
    req.write(payloadText);
    req.end();
  });
}

export class OpenAICompatibleProvider implements TranslationProvider {
  public readonly name: string = 'openaiCompatible';

  public constructor(
    private readonly settings: TranslatorSettings,
    private readonly apiKey: string,
  ) {}

  public async translateBatch(
    request: TranslationRequest,
  ): Promise<Map<string, string>> {
    if (request.terms.length === 0) {
      return new Map<string, string>();
    }

    const normalizedBaseUrl = normalizeApiBaseUrl(this.settings.apiBaseUrl);

    const payload = {
      model: this.settings.model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Translate programming identifier terms into natural target-language phrases. Do not keep underscores or case boundaries in the translation; output a human-readable phrase (no code formatting). Keep abbreviations and meaningless tokens unchanged only when they do not affect the meaning. Example: "max buffer size" → "最大缓冲区大小". Output strictly as TSV lines: source<TAB>target.',
        },
        {
          role: 'user',
          content: [
            `src_lang=${request.sourceLanguage}`,
            `tgt_lang=${request.targetLanguage}`,
            request.projectContextSummary
              ? `project_context=${request.projectContextSummary}`
              : 'project_context=',
            'rules=translate_word_segments_only;identifier_only;no_explanation',
            'terms:',
            ...request.terms,
          ].join('\n'),
        },
      ],
    };

    const response = await postJson(
      `${normalizedBaseUrl}/chat/completions`,
      payload,
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      this.settings.requestTimeoutMs,
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        `Translation API request failed (${response.statusCode}): ${response.body}`,
      );
    }

    const result = JSON.parse(response.body) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Translation API returned empty content.');
    }

    const rawMap = parseTermMap(content);
    const translatedMap = new Map<string, string>();
    for (const term of request.terms) {
      const value = rawMap[term];
      translatedMap.set(term, value ? value.trim() : term);
    }
    return translatedMap;
  }

  public async translateComments(
    request: CommentTranslationRequest,
  ): Promise<Map<string, string>> {
    if (request.comments.length === 0) {
      return new Map<string, string>();
    }

    const normalizedBaseUrl = normalizeApiBaseUrl(this.settings.apiBaseUrl);
    const indexed = request.comments.map((c, i) => `[${i}] ${c}`).join('\n');

    const payload = {
      model: this.settings.model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            `Translate code comments from ${request.sourceLanguage} to ${request.targetLanguage}. ` +
            'Each line starts with [index]. Return every line in the same [index] format with the translated text. ' +
            'Preserve technical terms, code references, and formatting. Do not add explanation.',
        },
        {
          role: 'user',
          content: indexed,
        },
      ],
    };

    const response = await postJson(
      `${normalizedBaseUrl}/chat/completions`,
      payload,
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      this.settings.requestTimeoutMs,
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        `Comment translation API request failed (${response.statusCode}): ${response.body}`,
      );
    }

    const result = JSON.parse(response.body) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Comment translation API returned empty content.');
    }

    const translatedMap = new Map<string, string>();
    const lineRegex = /\[(\d+)]\s*(.*)/g;
    let match: RegExpExecArray | null;
    while ((match = lineRegex.exec(content)) !== null) {
      const idx = parseInt(match[1], 10);
      const translatedText = match[2].trim();
      if (idx >= 0 && idx < request.comments.length && translatedText) {
        translatedMap.set(request.comments[idx], translatedText);
      }
    }

    for (const comment of request.comments) {
      if (!translatedMap.has(comment)) {
        translatedMap.set(comment, comment);
      }
    }

    return translatedMap;
  }
}
