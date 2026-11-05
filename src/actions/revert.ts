// Accept and revert. Never runs on its own: only from the user's click.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { applyEdits, modify } from 'jsonc-parser';
import { collapseNested, diffEntries } from '../core/compare';
import { matchPaths, type Json } from '../core/keyfilter';
import { parseJsonc, scanTarget } from '../core/scan';
import type { BaselineStore } from '../core/store';
import type { DirSnapshot, KeyPattern, Snapshot, Target } from '../core/types';
import { t } from '../i18n';
import { backupNextTo, freeName, move, removeFile, timestamp, writeInPlace } from './files';

export class RevertError extends Error {}

export interface RevertResult {
  /** Backup of the changed version (file next to the target, or a folder under the extension storage). */
  backup?: string;
  /** The file did not exist in the baseline and was removed. */
  removed?: boolean;
  /** Folder entries that could not be restored because their content was not stored. */
  unrestorable: string[];
}

/** Accept: the current state becomes the baseline for this target. */
export async function acceptChange(store: BaselineStore, target: Target): Promise<Snapshot> {
  const snapshot = await scanTarget(target);
  await store.put([{ target, snapshot }]);
  return snapshot;
}

/**
 * Writes the baseline values of the watched subtrees into the current file, leaving every
 * other key (Claude Code's own state, the user's other VS Code settings) as it is now.
 */
export function restoreSubtrees(currentText: string, baselineProjection: Json, patterns: KeyPattern[]): string {
  const { value: current } = parseJsonc(currentText);
  const paths = new Map<string, string[]>();
  for (const m of [...matchPaths(current ?? {}, patterns), ...matchPaths(baselineProjection, patterns)]) paths.set(JSON.stringify(m.path), m.path);
  const desired = new Map(matchPaths(baselineProjection, patterns).map((m) => [JSON.stringify(m.path), m.value]));
  const eol = currentText.includes('\r\n') ? '\r\n' : '\n';
  const indent = currentText.match(/^([ \t]+)"/m)?.[1] ?? '  ';
  let text = currentText;
  for (const [id, p] of paths) {
    const edits = modify(text, p, desired.has(id) ? desired.get(id) : undefined, {
      formattingOptions: { insertSpaces: !indent.includes('\t'), tabSize: indent.includes('\t') ? 1 : indent.length, eol },
    });
    text = applyEdits(text, edits);
  }
  return text;
}

async function revertFile(store: BaselineStore, target: Target, baseline: Snapshot, now: Date): Promise<RevertResult> {
  const record = store.record(target.key)!;
  if (baseline.kind !== 'file') throw new RevertError(t('ui.noBaselineFor'));
  const currentExists = await fs
    .stat(target.path)
    .then((s) => s.isFile())
    .catch(() => false);
  const backup = currentExists ? await backupNextTo(target.path, now) : undefined;

  if (!record.exists) {
    if (currentExists) await removeFile(target.path);
    return { backup, removed: true, unrestorable: [] };
  }
  if (record.tooLarge || baseline.content === undefined) throw new RevertError(t('ui.notStoredRevert'));

  if (target.keyFilter && !record.unfiltered && currentExists) {
    const currentText = await fs.readFile(target.path, 'utf8');
    const parsed = parseJsonc(currentText);
    if (!parsed.errors.length) {
      const projection = JSON.parse(baseline.content) as Json;
      await writeInPlace(target.path, restoreSubtrees(currentText, projection, target.keyFilter));
      return { backup, unrestorable: [] };
    }
    // The current file does not parse: fall through and write the stored projection.
  }
  await writeInPlace(target.path, baseline.content);
  return { backup, unrestorable: [] };
}

async function revertDir(target: Target, baseline: DirSnapshot, backupRoot: string, now: Date): Promise<RevertResult> {
  const current = (await scanTarget(target)) as DirSnapshot;
  const diff = diffEntries(baseline.entries, current.entries);
  const backupDir = await freeName(path.join(backupRoot, `${target.id}-${timestamp(now)}`));
  let backedUp = false;
  const abs = (rel: string) => path.join(target.path, ...rel.split('/'));
  const toBackup = (rel: string) => path.join(backupDir, ...rel.split('/'));
  const unrestorable: string[] = [];

  // New entries: moved out of the agent's folder (a renamed skill folder would still be loaded).
  for (const e of collapseNested(diff.added)) {
    await move(abs(e.rel), toBackup(e.rel));
    backedUp = true;
  }
  // Edited files: keep the changed copy, then restore.
  for (const { after } of diff.modified) {
    if (after.type !== 'file') continue;
    const content = baseline.contents[after.rel];
    if (content === undefined) {
      unrestorable.push(after.rel);
      continue;
    }
    await fs.mkdir(path.dirname(toBackup(after.rel)), { recursive: true, mode: 0o700 });
    await fs.copyFile(abs(after.rel), toBackup(after.rel));
    backedUp = true;
    await writeInPlace(abs(after.rel), content);
  }
  // Removed entries: recreate folders, restore stored files.
  for (const e of diff.removed) {
    if (e.type === 'dir') await fs.mkdir(abs(e.rel), { recursive: true });
    else if (e.type === 'file' && baseline.contents[e.rel] !== undefined) await writeInPlace(abs(e.rel), baseline.contents[e.rel]);
    else unrestorable.push(e.rel);
  }
  return { backup: backedUp ? backupDir : undefined, unrestorable };
}

/** Revert: back up the current state, then put the baseline back. */
export async function revertChange(store: BaselineStore, target: Target, backupRoot: string, now = new Date()): Promise<RevertResult> {
  await store.load();
  const record = store.record(target.key);
  if (!record) throw new RevertError(t('ui.noBaselineFor'));
  const baseline = await store.snapshotOf(record);
  if (baseline.kind === 'dir') return revertDir(target, baseline, backupRoot, now);
  return revertFile(store, target, baseline, now);
}
