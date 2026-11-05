import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createBaseline } from '../../src/core/baseline';
import { scanDir, scanFile } from '../../src/core/scan';
import { BaselineStore, withLock } from '../../src/core/store';
import type { Target } from '../../src/core/types';
import { tempDir, writeFile } from './helpers';

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => ({ dir, cleanup } = await tempDir()));
afterEach(() => cleanup());

function fileTarget(p: string, id = 't.file'): Target {
  return { id, agent: 'codex', scope: 'user', kind: 'file', root: 'codexHome', rel: 'x', role: 'settings', label: 'x', confirmed: true, path: p, key: p };
}

function dirTarget(p: string, id = 't.dir'): Target {
  return { ...fileTarget(p, id), kind: 'dir', depth: 2, role: 'skills' };
}

describe('BaselineStore', () => {
  test('no baseline yet', async () => {
    const store = new BaselineStore(path.join(dir, 'baseline'));
    assert.equal(await store.load(), undefined);
  });

  test('stores records and content-addressed blobs; snapshot round-trips', async () => {
    const file = path.join(dir, 'config.toml');
    await writeFile(file, 'a = 1\n');
    const t = fileTarget(file);
    const snap = await scanFile(t);
    const store = new BaselineStore(path.join(dir, 'baseline'));
    await store.put([{ target: t, snapshot: snap }]);

    const fresh = new BaselineStore(path.join(dir, 'baseline'));
    await fresh.load();
    const rec = fresh.record(t.key);
    assert.equal(rec?.hash, snap.hash);
    assert.deepEqual(await fs.readdir(fresh.blobDir), [snap.hash]);
    const back = await fresh.snapshotOf(rec!);
    assert.equal(back.kind === 'file' && back.content, 'a = 1\n');
  });

  test('directory snapshot round-trips with file contents', async () => {
    const root = path.join(dir, 'skills');
    await writeFile(path.join(root, 'a', 'SKILL.md'), '# a\n');
    const t = dirTarget(root);
    const store = new BaselineStore(path.join(dir, 'baseline'));
    await store.put([{ target: t, snapshot: await scanDir(t) }]);
    const back = await store.snapshotOf(store.record(t.key)!);
    assert.equal(back.kind === 'dir' && back.contents['a/SKILL.md'], '# a\n');
  });

  test('files are owner-only (0600) and directories 0700', { skip: process.platform === 'win32' ? 'chmod is a no-op on Windows' : false }, async () => {
    const file = path.join(dir, 'c.json');
    await writeFile(file, '{}');
    const t = fileTarget(file);
    const store = new BaselineStore(path.join(dir, 'baseline'));
    await store.put([{ target: t, snapshot: await scanFile(t) }]);
    assert.equal((await fs.stat(store.indexFile)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(path.join(store.blobDir, (await fs.readdir(store.blobDir))[0]))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(store.blobDir)).mode & 0o777, 0o700);
  });

  test('old blobs are deleted once nothing refers to them', async () => {
    const file = path.join(dir, 'c.json');
    const t = fileTarget(file);
    const store = new BaselineStore(path.join(dir, 'baseline'));
    await writeFile(file, '{"v":1}');
    await store.put([{ target: t, snapshot: await scanFile(t) }]);
    await writeFile(file, '{"v":2}');
    const second = await scanFile(t);
    await store.put([{ target: t, snapshot: second }]);
    assert.deepEqual(await fs.readdir(store.blobDir), [second.hash]);
  });

  test('replaceAll drops records of targets no longer present', async () => {
    const a = fileTarget(path.join(dir, 'a.json'), 'a');
    const b = fileTarget(path.join(dir, 'b.json'), 'b');
    const store = new BaselineStore(path.join(dir, 'baseline'));
    await store.put([{ target: a, snapshot: await scanFile(a) }, { target: b, snapshot: await scanFile(b) }]);
    await store.put([{ target: a, snapshot: await scanFile(a) }], { replaceAll: true });
    assert.deepEqual(Object.keys(store.index!.records), [a.key]);
  });

  test('concurrent puts from two stores (two windows) keep both records', async () => {
    const a = fileTarget(path.join(dir, 'a.json'), 'a');
    const b = fileTarget(path.join(dir, 'b.json'), 'b');
    await writeFile(a.path, '{"a":1}');
    await writeFile(b.path, '{"b":1}');
    const s1 = new BaselineStore(path.join(dir, 'baseline'));
    const s2 = new BaselineStore(path.join(dir, 'baseline'));
    await Promise.all([s1.put([{ target: a, snapshot: await scanFile(a) }]), s2.put([{ target: b, snapshot: await scanFile(b) }])]);
    const check = new BaselineStore(path.join(dir, 'baseline'));
    await check.load();
    assert.deepEqual(Object.keys(check.index!.records).sort(), [a.key, b.key].sort());
  });

  test('createBaseline records missing targets as not existing', async () => {
    const present = fileTarget(path.join(dir, 'p.json'), 'p');
    const missing = fileTarget(path.join(dir, 'm.json'), 'm');
    await writeFile(present.path, '{}');
    const store = new BaselineStore(path.join(dir, 'baseline'));
    await createBaseline(store, [present, missing]);
    assert.equal(store.record(present.key)?.exists, true);
    assert.equal(store.record(missing.key)?.exists, false);
  });
});

describe('withLock', () => {
  test('runs critical sections one at a time', async () => {
    const lock = path.join(dir, '.lock');
    const order: string[] = [];
    const job = (name: string) =>
      withLock(lock, async () => {
        order.push(`${name}:start`);
        await new Promise((r) => setTimeout(r, 30));
        order.push(`${name}:end`);
      });
    await Promise.all([job('a'), job('b')]);
    assert.ok(order.join() === 'a:start,a:end,b:start,b:end' || order.join() === 'b:start,b:end,a:start,a:end', order.join());
  });

  test('a stale lock left by a crashed window is taken over', async () => {
    const lock = path.join(dir, '.lock');
    await fs.writeFile(lock, '99999');
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lock, old, old);
    assert.equal(await withLock(lock, async () => 'ok'), 'ok');
  });
});
