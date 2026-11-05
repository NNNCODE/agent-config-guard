import { ALL_TARGET_SPECS } from '../../src/agents';
import { diffEntries } from '../../src/core/compare';
import { projectionText } from '../../src/core/keyfilter';
import { listingHash, parseJsonc, sha256 } from '../../src/core/scan';
import type { Assessment, Change, DirEntry, DirSnapshot, FileSnapshot, Target } from '../../src/core/types';
import { assess, type AssessIO } from '../../src/risk/engine';

/** A registry target with a fake path, so tests exercise the real role/format/keyFilter. */
export function target(id: string): Target {
  const spec = ALL_TARGET_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`no target ${id}`);
  const p = `/fake/${spec.rel}`;
  return { ...spec, path: p, key: p };
}

function fileSnap(t: Target, content: string | undefined): FileSnapshot {
  if (content === undefined) return { kind: 'file', exists: false };
  let c = content;
  if (t.keyFilter) {
    const { value, errors } = parseJsonc(content);
    if (!errors.length && value !== undefined) c = projectionText(value, t.keyFilter);
  }
  return { kind: 'file', exists: true, hash: sha256(c), content: c, size: c.length };
}

export function fileChange(id: string, before: string | undefined, after: string | undefined): Change {
  const t = target(id);
  const kind = before === undefined ? 'added' : after === undefined ? 'deleted' : 'modified';
  return { target: t, kind, before: fileSnap(t, before), after: fileSnap(t, after) };
}

/** Folder contents as {rel: text} (file) or {rel: null} (sub-folder). */
export type Tree = Record<string, string | null>;

function dirSnap(tree: Tree | undefined): DirSnapshot {
  if (!tree) return { kind: 'dir', exists: false, entries: [], contents: {} };
  const entries: DirEntry[] = Object.keys(tree)
    .sort()
    .map((rel) => (tree[rel] === null ? { rel, type: 'dir' as const } : { rel, type: 'file' as const, hash: sha256(tree[rel] as string), size: (tree[rel] as string).length }));
  const contents: Record<string, string> = {};
  for (const [rel, v] of Object.entries(tree)) if (v !== null) contents[rel] = v;
  return { kind: 'dir', exists: true, entries, contents, hash: listingHash(entries) };
}

export function dirChange(id: string, before: Tree | undefined, after: Tree | undefined): Change {
  const b = dirSnap(before);
  const a = dirSnap(after);
  const kind = !before ? 'added' : !after ? 'deleted' : 'modified';
  return { target: target(id), kind, before: b, after: a, entries: diffEntries(b.entries, a.entries) };
}

const noIO: AssessIO = { findHookEvents: async () => [] };

export function run(change: Change, io: AssessIO = noIO): Promise<Assessment> {
  return assess(change, io);
}

/** "level:rule" of every finding, for compact assertions. */
export function tags(a: Assessment): string[] {
  return a.findings.map((f) => `${f.level}:${f.rule}`);
}

export const json = (o: unknown): string => JSON.stringify(o, null, 2);
