// Baseline vs current state of one target.
import type { BaselineRecord } from './store';
import type { ChangeKind, DirEntry, EntryChanges, Snapshot } from './types';

export type CompareResult = 'unseen' | 'same' | ChangeKind;

/** 'unseen' = no baseline record for this path yet (e.g. a workspace opened for the first time). */
export function compareToRecord(record: BaselineRecord | undefined, current: Snapshot): CompareResult {
  if (!record) return 'unseen';
  if (!record.exists && !current.exists) return 'same';
  if (!record.exists && current.exists) return 'added';
  if (record.exists && !current.exists) return 'deleted';
  return record.hash === current.hash ? 'same' : 'modified';
}

/** Entry-level differences of a directory target (new plugins, removed skills, edited rules). */
export function diffEntries(before: DirEntry[], after: DirEntry[]): EntryChanges {
  const beforeMap = new Map(before.map((e) => [e.rel, e]));
  const afterMap = new Map(after.map((e) => [e.rel, e]));
  const result: EntryChanges = { added: [], removed: [], modified: [] };
  for (const [rel, a] of afterMap) {
    const b = beforeMap.get(rel);
    if (!b) result.added.push(a);
    else if (b.type !== a.type || b.hash !== a.hash) result.modified.push({ before: b, after: a });
  }
  for (const [rel, b] of beforeMap) if (!afterMap.has(rel)) result.removed.push(b);
  return result;
}

/** Drops entries whose parent folder is itself in the list: ['a', 'a/SKILL.md', 'b.md'] → ['a', 'b.md']. */
export function collapseNested(list: DirEntry[]): DirEntry[] {
  const rels = new Set(list.map((e) => e.rel));
  return list.filter((e) => {
    const parts = e.rel.split('/');
    for (let i = 1; i < parts.length; i++) if (rels.has(parts.slice(0, i).join('/'))) return false;
    return true;
  });
}
