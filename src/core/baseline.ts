// Creating the baseline: scan every resolved target and store the result.
import { scanTarget } from './scan';
import type { BaselineStore } from './store';
import type { Snapshot, Target } from './types';

export interface ScanResult {
  target: Target;
  snapshot?: Snapshot;
  error?: string;
}

/** Scans targets one by one; an unreadable path is reported, not fatal. */
export async function scanAll(targets: Target[]): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  for (const target of targets) {
    try {
      results.push({ target, snapshot: await scanTarget(target) });
    } catch (err) {
      results.push({ target, error: (err as Error).message });
    }
  }
  return results;
}

/** Number of targets that currently exist, for the first-run confirmation message. */
export function countExisting(results: ScanResult[]): { files: number; agents: number } {
  const existing = results.filter((r) => r.snapshot?.exists);
  return { files: existing.length, agents: new Set(existing.map((r) => r.target.agent)).size };
}

/**
 * What the first-run prompt's "Create baseline" button does when clicked. The prompt stays in the
 * notification center, so it can be clicked long after a baseline was created from the sidebar or
 * in another window. Recreating then would turn pending changes into the baseline, so that needs
 * the same confirmation as the "Create or recreate baseline" command. The caller reads the
 * baseline from disk and checks the files first, so both arguments are current.
 */
export function firstRunAction(hasBaseline: boolean, pendingCount: number): 'create' | 'confirm-recreate' | 'nothing' {
  if (!hasBaseline) return 'create';
  return pendingCount > 0 ? 'confirm-recreate' : 'nothing';
}

/** (Re)creates the baseline from scratch for the given targets. */
export async function createBaseline(store: BaselineStore, targets: Target[]): Promise<ScanResult[]> {
  const results = await scanAll(targets);
  const items = results.filter((r) => r.snapshot).map((r) => ({ target: r.target, snapshot: r.snapshot as Snapshot }));
  await store.put(items, { replaceAll: true });
  return results;
}
