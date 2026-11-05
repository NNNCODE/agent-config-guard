import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { scanDir, scanFile, sha256 } from '../../src/core/scan';
import { tempDir, writeFile } from './helpers';

let dir: string;
let cleanup: () => Promise<void>;
before(async () => ({ dir, cleanup } = await tempDir()));
after(() => cleanup());

describe('scanFile', () => {
  test('missing file', async () => {
    assert.deepEqual(await scanFile({ path: path.join(dir, 'nope.json') }), { kind: 'file', exists: false });
  });

  test('content and sha256 of an existing file', async () => {
    const file = path.join(dir, 'a.toml');
    await writeFile(file, 'model = "x"\n');
    const snap = await scanFile({ path: file });
    assert.equal(snap.exists, true);
    assert.equal(snap.content, 'model = "x"\n');
    assert.equal(snap.hash, sha256('model = "x"\n'));
  });

  test('key-filtered file ignores unrelated changes', async () => {
    const file = path.join(dir, '.claude.json');
    const keyFilter = [['mcpServers']];
    await writeFile(file, JSON.stringify({ numStartups: 1, mcpServers: { a: { command: 'node' } } }));
    const first = await scanFile({ path: file, keyFilter });
    await writeFile(file, JSON.stringify({ numStartups: 2, mcpServers: { a: { command: 'node' } } }));
    const second = await scanFile({ path: file, keyFilter });
    assert.equal(second.hash, first.hash);
    assert.ok(!second.content?.includes('numStartups'));
    await writeFile(file, JSON.stringify({ numStartups: 2, mcpServers: { a: { command: 'node' }, b: { command: 'npx' } } }));
    const third = await scanFile({ path: file, keyFilter });
    assert.notEqual(third.hash, first.hash);
  });

  test('key-filtered file that does not parse falls back to raw content', async () => {
    const file = path.join(dir, 'broken.json');
    await writeFile(file, '{ "mcpServers": ');
    const snap = await scanFile({ path: file, keyFilter: [['mcpServers']] });
    assert.equal(snap.unfiltered, true);
    assert.equal(snap.content, '{ "mcpServers": ');
  });

  test('a directory where a file is expected counts as missing', async () => {
    const sub = path.join(dir, 'isdir.json');
    await fs.mkdir(sub, { recursive: true });
    assert.equal((await scanFile({ path: sub })).exists, false);
  });
});

describe('scanDir', () => {
  test('missing directory', async () => {
    const snap = await scanDir({ path: path.join(dir, 'none') });
    assert.equal(snap.exists, false);
    assert.deepEqual(snap.entries, []);
  });

  test('lists to the given depth, applies match, skips node_modules and stores text only', async () => {
    const root = path.join(dir, 'skills');
    await writeFile(path.join(root, 'a', 'SKILL.md'), '# a\n');
    await writeFile(path.join(root, 'a', 'deep', 'deeper', 'x.md'), 'too deep\n');
    await writeFile(path.join(root, 'notes.txt'), 'ignored by match\n');
    await writeFile(path.join(root, 'node_modules', 'p', 'index.md'), 'skip\n');
    await fs.writeFile(path.join(root, 'bin.md'), Buffer.from([0x61, 0x00, 0x62]));
    const snap = await scanDir({ path: root, depth: 2, match: /\.md$/ });
    assert.deepEqual(
      snap.entries.map((e) => `${e.type}:${e.rel}`),
      ['dir:a', 'file:a/SKILL.md', 'dir:a/deep', 'file:bin.md'],
    );
    assert.equal(snap.contents['a/SKILL.md'], '# a\n');
    assert.equal(snap.contents['bin.md'], undefined, 'binary content is not stored');
  });

  test('storeContent: false keeps hashes but no content', async () => {
    const root = path.join(dir, 'plugins');
    await writeFile(path.join(root, 'mkt', 'plugin.json'), '{}');
    const snap = await scanDir({ path: root, depth: 2, storeContent: false });
    assert.equal(snap.entries.find((e) => e.rel === 'mkt/plugin.json')?.hash, sha256('{}'));
    assert.deepEqual(snap.contents, {});
  });

  test('listing hash changes when an entry is added', async () => {
    const root = path.join(dir, 'cache');
    await writeFile(path.join(root, 'openai', 'x', 'f'), '1');
    const first = await scanDir({ path: root, depth: 2 });
    await fs.mkdir(path.join(root, 'postman', 'postman'), { recursive: true });
    const second = await scanDir({ path: root, depth: 2 });
    assert.notEqual(second.hash, first.hash);
    assert.ok(second.entries.some((e) => e.rel === 'postman/postman'));
  });
});
