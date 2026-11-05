import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createBaseline } from '../../src/core/baseline';
import { collapseNested, compareToRecord, diffEntries } from '../../src/core/compare';
import { Monitor } from '../../src/core/monitor';
import { scanTarget } from '../../src/core/scan';
import { BaselineStore } from '../../src/core/store';
import type { Assessment, RiskLevel, Target } from '../../src/core/types';
import { tempDir, writeFile } from './helpers';

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => ({ dir, cleanup } = await tempDir()));
afterEach(() => cleanup());

function fileTarget(name: string): Target {
  const p = path.join(dir, 'home', name);
  return { id: `t.${name}`, agent: 'codex', scope: 'user', kind: 'file', root: 'codexHome', rel: name, role: 'settings', label: name, confirmed: true, path: p, key: p };
}

function dirTarget(name: string): Target {
  return { ...fileTarget(name), kind: 'dir', depth: 2, role: 'plugin-dir' };
}

function makeMonitor(level: RiskLevel = 'high', autoLow = true) {
  const store = new BaselineStore(path.join(dir, 'storage', 'baseline'));
  const assess = (): Assessment => ({ level, findings: [{ rule: 'test', level, reason: 'test' }] });
  const monitor = new Monitor({ store, claimsDir: path.join(dir, 'storage', 'claims'), assess, autoAcceptLow: () => autoLow });
  return { store, monitor };
}

describe('compare', () => {
  test('record vs snapshot outcomes', () => {
    const rec = { id: 'x', path: 'p', kind: 'file' as const, exists: true, hash: 'h1', updatedAt: '' };
    assert.equal(compareToRecord(undefined, { kind: 'file', exists: false }), 'unseen');
    assert.equal(compareToRecord(rec, { kind: 'file', exists: true, hash: 'h1' }), 'same');
    assert.equal(compareToRecord(rec, { kind: 'file', exists: true, hash: 'h2' }), 'modified');
    assert.equal(compareToRecord(rec, { kind: 'file', exists: false }), 'deleted');
    assert.equal(compareToRecord({ ...rec, exists: false }, { kind: 'file', exists: true, hash: 'h' }), 'added');
    assert.equal(compareToRecord({ ...rec, exists: false }, { kind: 'file', exists: false }), 'same');
  });

  test('directory entries: added, removed, modified; nested additions collapse', () => {
    const before = [{ rel: 'a', type: 'dir' as const }, { rel: 'a/x.md', type: 'file' as const, hash: '1' }, { rel: 'old.md', type: 'file' as const, hash: '9' }];
    const after = [{ rel: 'a', type: 'dir' as const }, { rel: 'a/x.md', type: 'file' as const, hash: '2' }, { rel: 'p', type: 'dir' as const }, { rel: 'p/q', type: 'dir' as const }];
    const d = diffEntries(before, after);
    assert.deepEqual(d.added.map((e) => e.rel), ['p', 'p/q']);
    assert.deepEqual(d.removed.map((e) => e.rel), ['old.md']);
    assert.deepEqual(d.modified.map((m) => m.after.rel), ['a/x.md']);
    assert.deepEqual(collapseNested(d.added).map((e) => e.rel), ['p']);
  });
});

describe('Monitor', () => {
  test('does nothing before a baseline exists', async () => {
    const { monitor } = makeMonitor();
    const t = fileTarget('config.toml');
    await writeFile(t.path, 'a = 1\n');
    const report = await monitor.check([t]);
    assert.equal(report.active, false);
    assert.equal(monitor.pendingChanges.length, 0);
  });

  test('detects a modification once, with baseline and current content', async () => {
    const { store, monitor } = makeMonitor();
    const t = fileTarget('config.toml');
    await writeFile(t.path, 'a = 1\n');
    await createBaseline(store, [t]);
    await writeFile(t.path, 'a = 2\n');

    const first = await monitor.check([t]);
    assert.equal(first.detected.length, 1);
    const change = first.detected[0].pending.change;
    assert.equal(change.kind, 'modified');
    assert.equal(change.before.kind === 'file' && change.before.content, 'a = 1\n');
    assert.equal(change.after.kind === 'file' && change.after.content, 'a = 2\n');

    const again = await monitor.check([t]);
    assert.equal(again.detected.length, 0, 'same pending change is not reported twice');
    assert.equal(monitor.pendingChanges.length, 1);
  });

  test('added and deleted files', async () => {
    const { store, monitor } = makeMonitor();
    const added = fileTarget('hooks.json');
    const deleted = fileTarget('AGENTS.md');
    await writeFile(deleted.path, '# rules\n');
    await createBaseline(store, [added, deleted]);
    await writeFile(added.path, '{}');
    await fs.rm(deleted.path);
    const report = await monitor.check([added, deleted]);
    assert.deepEqual(report.detected.map((d) => d.pending.change.kind).sort(), ['added', 'deleted']);
  });

  test('a new plugin folder is reported as a new directory entry', async () => {
    const { store, monitor } = makeMonitor();
    const t = dirTarget('cache');
    await fs.mkdir(path.join(t.path, 'openai-bundled', 'browser'), { recursive: true });
    await createBaseline(store, [t]);
    await fs.mkdir(path.join(t.path, 'postman', 'postman'), { recursive: true });
    const report = await monitor.check([t]);
    const entries = report.detected[0].pending.change.entries!;
    assert.deepEqual(entries.added.map((e) => e.rel), ['postman', 'postman/postman']);
  });

  test('putting the baseline content back resolves the pending change (own writes are not changes)', async () => {
    const { store, monitor } = makeMonitor();
    const t = fileTarget('settings.json');
    await writeFile(t.path, '{"a":1}');
    await createBaseline(store, [t]);
    await writeFile(t.path, '{"a":2}');
    await monitor.check([t]);
    await writeFile(t.path, '{"a":1}');
    const report = await monitor.check([t]);
    assert.deepEqual(report.resolved, [t.key]);
    assert.equal(report.detected.length, 0);
    assert.equal(monitor.pendingChanges.length, 0);
  });

  test('accepting (baseline := current) resolves it too', async () => {
    const { store, monitor } = makeMonitor();
    const t = fileTarget('settings.json');
    await writeFile(t.path, '{"a":1}');
    await createBaseline(store, [t]);
    await writeFile(t.path, '{"a":2}');
    await monitor.check([t]);
    await store.put([{ target: t, snapshot: await scanTarget(t) }]);
    assert.deepEqual((await monitor.check([t])).resolved, [t.key]);
  });

  test('a path seen for the first time is baselined silently', async () => {
    const { store, monitor } = makeMonitor();
    const known = fileTarget('a.json');
    await createBaseline(store, [known]);
    const fresh = fileTarget('workspace-mcp.json');
    await writeFile(fresh.path, '{"mcpServers":{}}');
    const report = await monitor.check([known, fresh]);
    assert.deepEqual(report.baselined.map((t) => t.key), [fresh.key]);
    assert.equal(report.detected.length, 0);
    assert.equal(store.record(fresh.key)?.exists, true);
  });

  test('low risk is accepted automatically when enabled', async () => {
    const { store, monitor } = makeMonitor('low', true);
    const t = fileTarget('config.toml');
    await writeFile(t.path, 'model = "a"\n');
    await createBaseline(store, [t]);
    await writeFile(t.path, 'model = "b"\n');
    const report = await monitor.check([t]);
    assert.equal(report.autoAccepted.length, 1);
    assert.equal(report.autoAccepted[0].first, true);
    assert.equal(monitor.pendingChanges.length, 0);
    assert.equal((await monitor.check([t])).detected.length + (await monitor.check([t])).autoAccepted.length, 0);
  });

  test('low risk stays pending when auto-accept is off', async () => {
    const { store, monitor } = makeMonitor('low', false);
    const t = fileTarget('config.toml');
    await writeFile(t.path, 'model = "a"\n');
    await createBaseline(store, [t]);
    await writeFile(t.path, 'model = "b"\n');
    assert.equal((await monitor.check([t])).detected.length, 1);
  });

  test('two windows: only one announces; the change coming back after a revert is announced again', async () => {
    const w1 = makeMonitor();
    const w2 = { monitor: new Monitor({ store: new BaselineStore(path.join(dir, 'storage', 'baseline')), claimsDir: path.join(dir, 'storage', 'claims'), assess: () => ({ level: 'high', findings: [] }), autoAcceptLow: () => true }) };
    const t = fileTarget('config.toml');
    await writeFile(t.path, 'a = 1\n');
    await createBaseline(w1.store, [t]);
    await writeFile(t.path, 'a = 2\n');
    const r1 = await w1.monitor.check([t]);
    const r2 = await w2.monitor.check([t]);
    assert.deepEqual([r1.detected[0].first, r2.detected[0].first], [true, false]);

    await writeFile(t.path, 'a = 1\n'); // revert
    await w1.monitor.check([t]);
    await w2.monitor.check([t]);
    await writeFile(t.path, 'a = 2\n'); // the installer writes the same thing again
    const again = await w1.monitor.check([t]);
    assert.equal(again.detected[0].first, true);
  });

  test('a further edit to a pending file replaces the pending change', async () => {
    const { store, monitor } = makeMonitor();
    const t = fileTarget('config.toml');
    await writeFile(t.path, 'a = 1\n');
    await createBaseline(store, [t]);
    await writeFile(t.path, 'a = 2\n');
    await monitor.check([t]);
    await writeFile(t.path, 'a = 3\n');
    const report = await monitor.check([t]);
    assert.equal(report.detected.length, 1);
    const after = monitor.getPending(t.key)!.change.after;
    assert.equal(after.kind === 'file' && after.content, 'a = 3\n');
  });

  test('a file caught half-way through a write is not acted on (stableMs)', async () => {
    const store = new BaselineStore(path.join(dir, 'storage', 'baseline'));
    const monitor = new Monitor({ store, claimsDir: path.join(dir, 'storage', 'claims'), assess: () => ({ level: 'low', findings: [] }), autoAcceptLow: () => true, stableMs: 150 });
    const t = fileTarget('config.toml');
    await writeFile(t.path, 'a = 1\nb = 2\n');
    await createBaseline(store, [t]);
    await writeFile(t.path, ''); // truncated, the writer is still busy
    const checking = monitor.check([t]);
    await new Promise((r) => setTimeout(r, 30));
    await writeFile(t.path, 'a = 1\nb = 3\n'); // write finished
    const first = await checking;
    assert.equal(first.autoAccepted.length + first.detected.length, 0, 'the empty intermediate state was skipped');
    assert.equal(store.record(t.key)?.hash !== undefined, true);
    const second = await monitor.check([t]);
    assert.equal(second.autoAccepted.length, 1);
    const accepted = second.autoAccepted[0].change.after;
    assert.equal(accepted.kind === 'file' && accepted.content, 'a = 1\nb = 3\n');
  });

  test('pending list listeners and retain()', async () => {
    const { store, monitor } = makeMonitor();
    const a = fileTarget('a.toml');
    const b = fileTarget('b.toml');
    await writeFile(a.path, '1');
    await writeFile(b.path, '1');
    await createBaseline(store, [a, b]);
    await writeFile(a.path, '2');
    await writeFile(b.path, '2');
    let calls = 0;
    monitor.onDidChangePending(() => calls++);
    await monitor.check([a, b]);
    assert.equal(calls, 1);
    monitor.retain([a]);
    assert.deepEqual(monitor.pendingChanges.map((p) => p.key), [a.key]);
  });
});
