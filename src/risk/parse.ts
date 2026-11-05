// Parses stored content into a plain JSON value (JSON/JSONC via jsonc-parser, TOML via smol-toml).
import { parse as parseToml } from 'smol-toml';
import type { Json } from '../core/keyfilter';
import { parseJsonc } from '../core/scan';
import type { Format } from '../core/types';

export interface ParsedDoc {
  /** Parsed value for structured formats; undefined for text or when missing/unparseable. */
  value?: Json;
  /** Raw text (all formats). */
  text?: string;
  error?: string;
}

export function isStructured(format: Format | undefined): boolean {
  return format === 'json' || format === 'jsonc' || format === 'toml';
}

export function parseContent(content: string | undefined, format: Format | undefined): ParsedDoc {
  if (content === undefined) return {};
  if (!isStructured(format)) return { text: content };
  if (content.trim() === '') return { text: content, value: {} };
  if (format === 'toml') {
    try {
      // Round-trip through JSON turns TOML dates into strings.
      return { text: content, value: JSON.parse(JSON.stringify(parseToml(content))) as Json };
    } catch (err) {
      return { text: content, error: firstLine((err as Error).message) };
    }
  }
  const { value, errors } = parseJsonc(content);
  if (errors.length) return { text: content, error: errors[0] };
  return { text: content, value };
}

function firstLine(s: string): string {
  return s.split('\n')[0].slice(0, 120);
}
