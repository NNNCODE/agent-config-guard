// What a rule can ask about one change. Queries work on key-path patterns over the parsed
// before/after documents, so a whole table appearing at once (e.g. Postman's [hooks.state."…"])
// still shows up as individual entries.
import { matchPaths, type Json } from '../core/keyfilter';
import type { AgentId, ChangeKind, DirEntry, EntryChanges, Finding, Format, KeyPattern, Role, Target } from '../core/types';
import type { ParsedDoc } from './parse';
import { deepEqual } from './util';

export interface DocQuery {
  target: Target;
  agent: AgentId;
  role: Role;
  format: Format;
  /** Display name: the target label, or label + relative path for a file inside a directory target. */
  file: string;
  kind: ChangeKind;
  /** True for a file inside a directory target. */
  inDir: boolean;
  before: ParsedDoc;
  after: ParsedDoc;
  added(p: KeyPattern): Array<{ path: string[]; value: Json }>;
  changed(p: KeyPattern): Array<{ path: string[]; value: Json; before: Json }>;
  addedOrChanged(p: KeyPattern): Array<{ path: string[]; value: Json; before?: Json }>;
  removed(p: KeyPattern): Array<{ path: string[]; value: Json }>;
  /** Items of the arrays found at matching paths that are new (the array itself may be new). */
  arrayItemsAdded(p: KeyPattern): Array<{ path: string[]; item: Json }>;
  arrayItemsRemoved(p: KeyPattern): Array<{ path: string[]; item: Json }>;
  /** Non-blank lines present after but not before (text formats). */
  addedLines(): string[];
}

export interface DirQuery {
  target: Target;
  agent: AgentId;
  role: Role;
  file: string;
  kind: ChangeKind;
  entries: EntryChanges;
  /** New entries with nested new entries folded into their parent. */
  newTop: DirEntry[];
  /** New plugin folders → hook events found inside them. */
  pluginHooks: Map<string, string[]>;
}

export interface Rule {
  id: string;
  doc?(q: DocQuery): Finding[];
  dir?(q: DirQuery): Finding[];
}

function index(doc: Json | undefined, p: KeyPattern): Map<string, { path: string[]; value: Json }> {
  const map = new Map<string, { path: string[]; value: Json }>();
  if (doc === undefined) return map;
  for (const m of matchPaths(doc, [p])) map.set(JSON.stringify(m.path), m);
  return map;
}

/** Multiset difference: items of `a` not matched by an equal item of `b`. */
function itemsNotIn(a: Json[], b: Json[]): Json[] {
  const pool = [...b];
  const out: Json[] = [];
  for (const item of a) {
    const i = pool.findIndex((x) => deepEqual(x, item));
    if (i >= 0) pool.splice(i, 1);
    else out.push(item);
  }
  return out;
}

function lines(text: string | undefined): string[] {
  return (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function makeDocQuery(base: Omit<DocQuery, 'added' | 'changed' | 'addedOrChanged' | 'removed' | 'arrayItemsAdded' | 'arrayItemsRemoved' | 'addedLines'>): DocQuery {
  const b = base.before.value;
  const a = base.after.value;
  const added = (p: KeyPattern) => {
    const before = index(b, p);
    return [...index(a, p).entries()].filter(([k]) => !before.has(k)).map(([, v]) => v);
  };
  const changed = (p: KeyPattern) => {
    const before = index(b, p);
    const out: Array<{ path: string[]; value: Json; before: Json }> = [];
    for (const [k, v] of index(a, p)) {
      const old = before.get(k);
      if (old && !deepEqual(old.value, v.value)) out.push({ path: v.path, value: v.value, before: old.value });
    }
    return out;
  };
  const removed = (p: KeyPattern) => {
    const after = index(a, p);
    return [...index(b, p).entries()].filter(([k]) => !after.has(k)).map(([, v]) => v);
  };
  const arrayDiff = (from: Json | undefined, to: Json | undefined, p: KeyPattern) => {
    const fromIdx = index(from, p);
    const out: Array<{ path: string[]; item: Json }> = [];
    for (const [k, v] of index(to, p)) {
      if (!Array.isArray(v.value)) continue;
      const old = fromIdx.get(k)?.value;
      for (const item of itemsNotIn(v.value, Array.isArray(old) ? old : [])) out.push({ path: v.path, item });
    }
    return out;
  };
  return {
    ...base,
    added,
    changed,
    addedOrChanged: (p) => [...added(p), ...changed(p)],
    removed,
    arrayItemsAdded: (p) => arrayDiff(b, a, p),
    arrayItemsRemoved: (p) => arrayDiff(a, b, p),
    addedLines: () => itemsNotIn(lines(base.after.text), lines(base.before.text)) as string[],
  };
}
