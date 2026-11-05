// Reads a watched path into a snapshot: hash + content for files, a hashed listing for directories.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { projectionText, type Json } from './keyfilter';
import type { DirEntry, DirSnapshot, FileSnapshot, Snapshot, Target } from './types';

/** Files larger than this are hashed but not stored, so they cannot be reverted. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Files inside directory targets: content is stored only up to this size. */
export const MAX_DIR_FILE_CONTENT = 1024 * 1024;
export const MAX_DIR_ENTRIES = 2000;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function parseJsonc(text: string): { value: Json | undefined; errors: string[] } {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false }) as Json | undefined;
  return { value, errors: errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`) };
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export async function scanFile(target: Pick<Target, 'path' | 'keyFilter'>): Promise<FileSnapshot> {
  let buf: Buffer;
  try {
    const st = await fs.stat(target.path);
    if (!st.isFile()) return { kind: 'file', exists: false };
    buf = await fs.readFile(target.path);
  } catch (err) {
    if (isMissing(err)) return { kind: 'file', exists: false };
    throw err;
  }
  if (buf.length > MAX_FILE_BYTES) {
    return { kind: 'file', exists: true, hash: sha256(buf), size: buf.length, tooLarge: true };
  }
  const text = buf.toString('utf8');
  if (target.keyFilter) {
    const { value, errors } = parseJsonc(text);
    if (errors.length === 0 && value !== undefined) {
      const projected = projectionText(value, target.keyFilter);
      return { kind: 'file', exists: true, hash: sha256(projected), size: buf.length, content: projected };
    }
    // Unparseable: fall back to the raw file so the change is still detected.
    return { kind: 'file', exists: true, hash: sha256(buf), size: buf.length, content: text, unfiltered: true };
  }
  return { kind: 'file', exists: true, hash: sha256(buf), size: buf.length, content: text };
}

export async function scanDir(target: Pick<Target, 'path' | 'depth' | 'match' | 'storeContent'>): Promise<DirSnapshot> {
  const empty: DirSnapshot = { kind: 'dir', exists: false, entries: [], contents: {} };
  try {
    const st = await fs.stat(target.path);
    if (!st.isDirectory()) return empty;
  } catch (err) {
    if (isMissing(err)) return empty;
    throw err;
  }
  const depth = target.depth ?? 1;
  const storeContent = target.storeContent !== false;
  const entries: DirEntry[] = [];
  const contents: Record<string, string> = {};
  let truncated = false;

  const walk = async (absDir: string, relDir: string, level: number): Promise<void> => {
    let dirents;
    try {
      dirents = await fs.readdir(absDir, { withFileTypes: true });
    } catch (err) {
      if (isMissing(err)) return;
      throw err;
    }
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of dirents) {
      if (entries.length >= MAX_DIR_ENTRIES) {
        truncated = true;
        return;
      }
      const rel = relDir ? `${relDir}/${d.name}` : d.name;
      const abs = path.join(absDir, d.name);
      if (d.isSymbolicLink()) {
        let linkTarget = '';
        try {
          linkTarget = await fs.readlink(abs);
        } catch {
          /* dangling or unreadable link: hash the empty target */
        }
        entries.push({ rel, type: 'link', hash: sha256(linkTarget) });
      } else if (d.isDirectory()) {
        if (SKIP_DIRS.has(d.name)) continue;
        entries.push({ rel, type: 'dir' });
        if (level < depth) await walk(abs, rel, level + 1);
      } else if (d.isFile()) {
        if (target.match && !target.match.test(d.name)) continue;
        let buf: Buffer;
        try {
          buf = await fs.readFile(abs);
        } catch (err) {
          if (isMissing(err)) continue;
          throw err;
        }
        const hash = sha256(buf);
        entries.push({ rel, type: 'file', hash, size: buf.length });
        if (storeContent && buf.length <= MAX_DIR_FILE_CONTENT && !looksBinary(buf)) {
          contents[rel] = buf.toString('utf8');
        }
      }
    }
  };
  await walk(target.path, '', 1);
  return { kind: 'dir', exists: true, hash: listingHash(entries), entries, contents, truncated: truncated || undefined };
}

export function listingHash(entries: DirEntry[]): string {
  return sha256(entries.map((e) => `${e.type} ${e.rel} ${e.hash ?? ''}`).join('\n'));
}

/** Text form of a directory listing, used for the diff view of directory targets. */
export function listingText(entries: DirEntry[]): string {
  return entries.map((e) => (e.type === 'dir' ? `${e.rel}/` : e.type === 'link' ? `${e.rel} -> (link)` : `${e.rel}  ${e.size ?? 0} B  ${e.hash?.slice(0, 12) ?? ''}`)).join('\n') + '\n';
}

export async function scanTarget(target: Target): Promise<Snapshot> {
  return target.kind === 'file' ? scanFile(target) : scanDir(target);
}
