// The detection loop: scan targets, compare with the baseline, keep the list of pending changes.
// No 'vscode' import: the watcher, poller and UI call check() and read the report.
import { claimId, claimOnce, releaseClaim } from './claim';
import { compareToRecord, diffEntries } from './compare';
import { scanTarget } from './scan';
import type { BaselineStore } from './store';
import type { Assessment, Change, Snapshot, Target } from './types';

export interface PendingChange {
  key: string;
  change: Change;
  assessment: Assessment;
  detectedAt: string;
  claim: string;
}

export interface CheckReport {
  /** Changes that became pending in this check. `first` = this window claimed it (announce + log). */
  detected: Array<{ pending: PendingChange; first: boolean }>;
  /** Low-risk changes accepted automatically. */
  autoAccepted: Array<{ change: Change; assessment: Assessment; first: boolean }>;
  /** Keys that were pending and now match the baseline again (accepted elsewhere, or undone). */
  resolved: string[];
  /** Paths seen for the first time (e.g. a newly opened workspace), baselined silently. */
  baselined: Target[];
  errors: Array<{ target: Target; message: string }>;
  /** False when no baseline exists yet: nothing was checked. */
  active: boolean;
}

export interface MonitorOptions {
  store: BaselineStore;
  claimsDir: string;
  assess: (change: Change) => Assessment | Promise<Assessment>;
  autoAcceptLow: () => boolean;
  now?: () => Date;
}

export class Monitor {
  private readonly pending = new Map<string, PendingChange>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly opts: MonitorOptions) {}

  /** Called whenever the pending list changes (tree view, status bar). */
  onDidChangePending(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get pendingChanges(): PendingChange[] {
    return [...this.pending.values()];
  }

  getPending(key: string): PendingChange | undefined {
    return this.pending.get(key);
  }

  /** Checks are serialised so two triggers (watcher + poller) never race on the same target. */
  check(targets: Target[]): Promise<CheckReport> {
    const run = this.queue.then(() => this.checkNow(targets));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async checkNow(targets: Target[]): Promise<CheckReport> {
    const report: CheckReport = { detected: [], autoAccepted: [], resolved: [], baselined: [], errors: [], active: false };
    const { store } = this.opts;
    if (!(await store.load())) return report; // baseline not created yet
    report.active = true;
    const now = (this.opts.now ?? (() => new Date()))();
    const toBaseline: Array<{ target: Target; snapshot: Snapshot }> = [];
    const toAutoAccept: Array<{ target: Target; snapshot: Snapshot; claim: string }> = [];
    let pendingChanged = false;

    for (const target of targets) {
      let current: Snapshot;
      try {
        current = await scanTarget(target);
      } catch (err) {
        report.errors.push({ target, message: (err as Error).message });
        continue;
      }
      const record = store.record(target.key);
      const result = compareToRecord(record, current);

      if (result === 'unseen') {
        toBaseline.push({ target, snapshot: current });
        continue;
      }
      if (result === 'same') {
        const old = this.pending.get(target.key);
        if (old) {
          this.pending.delete(target.key);
          await releaseClaim(this.opts.claimsDir, old.claim);
          report.resolved.push(target.key);
          pendingChanged = true;
        }
        continue;
      }

      const known = this.pending.get(target.key);
      if (known && known.change.kind === result && known.change.after.hash === current.hash) continue;

      const before = await store.snapshotOf(record!);
      const change: Change = { target, kind: result, before, after: current };
      if (before.kind === 'dir' && current.kind === 'dir') change.entries = diffEntries(before.entries, current.entries);
      const assessment = await this.opts.assess(change);
      const claim = claimId(target.key, current.hash);
      if (known) await releaseClaim(this.opts.claimsDir, known.claim);

      if (assessment.level === 'low' && this.opts.autoAcceptLow()) {
        if (known) {
          this.pending.delete(target.key);
          pendingChanged = true;
        }
        const first = await claimOnce(this.opts.claimsDir, claim);
        report.autoAccepted.push({ change, assessment, first });
        toAutoAccept.push({ target, snapshot: current, claim });
        continue;
      }

      const pending: PendingChange = { key: target.key, change, assessment, detectedAt: now.toISOString(), claim };
      this.pending.set(target.key, pending);
      pendingChanged = true;
      report.detected.push({ pending, first: await claimOnce(this.opts.claimsDir, claim) });
    }

    if (toBaseline.length) {
      await store.put(toBaseline);
      report.baselined = toBaseline.map((t) => t.target);
    }
    if (toAutoAccept.length) {
      await store.put(toAutoAccept.map(({ target, snapshot }) => ({ target, snapshot })));
      for (const { claim } of toAutoAccept) await releaseClaim(this.opts.claimsDir, claim);
    }
    if (pendingChanged) for (const l of this.listeners) l();
    return report;
  }

  /** Drops pending changes of targets that are no longer watched (e.g. a workspace folder was closed). */
  retain(targets: Target[]): void {
    const keep = new Set(targets.map((t) => t.key));
    let changed = false;
    for (const key of [...this.pending.keys()]) {
      if (!keep.has(key)) {
        this.pending.delete(key);
        changed = true;
      }
    }
    if (changed) for (const l of this.listeners) l();
  }

  /** Drops all pending changes (used when the baseline is recreated). */
  clear(): void {
    if (this.pending.size === 0) return;
    this.pending.clear();
    for (const l of this.listeners) l();
  }
}
