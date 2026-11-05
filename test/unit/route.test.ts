import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_TARGET_SPECS } from '../../src/agents';
import { resolveTargets } from '../../src/paths';
import { Poller } from '../../src/watch/poller';
import { TargetRouter, watchPlan } from '../../src/watch/route';

const targets = resolveTargets(ALL_TARGET_SPECS, {
  platform: 'linux',
  home: '/home/u',
  env: {},
  workspaceFolders: ['/w'],
  listSubdirs: () => [],
});

test('file targets in one folder share one non-recursive watcher', () => {
  const plan = watchPlan(targets, 'linux');
  const codex = plan.filter((s) => s.base === '/home/u/.codex');
  assert.equal(codex.length, 1);
  assert.equal(codex[0].pattern, '{AGENTS.md,AGENTS.override.md,config.toml,hooks.json,rules,skills}');
});

test('directory targets: plugin folders non-recursive, skills recursive', () => {
  const plan = watchPlan(targets, 'linux');
  assert.deepEqual(plan.find((s) => s.base === '/home/u/.codex/plugins/cache'), { base: '/home/u/.codex/plugins/cache', pattern: '*' });
  assert.deepEqual(plan.find((s) => s.base === '/home/u/.claude/skills'), { base: '/home/u/.claude/skills', pattern: '**' });
});

test('no duplicate watchers', () => {
  const plan = watchPlan(targets, 'linux');
  const ids = plan.map((s) => `${s.base}|${s.pattern}`);
  assert.equal(new Set(ids).size, ids.length);
});

test('router: exact file, file inside a directory target, unrelated file', () => {
  const router = new TargetRouter(targets, 'linux');
  assert.deepEqual(router.route('/home/u/.codex/config.toml').map((t) => t.id), ['codex.config']);
  assert.deepEqual(router.route('/home/u/.codex/plugins/cache/postman/postman').map((t) => t.id), ['codex.pluginCache']);
  assert.deepEqual(router.route('/home/u/.claude/skills').map((t) => t.id), ['claude.skills']);
  assert.deepEqual(router.route('/home/u/.codex/sessions/x.jsonl'), []);
});

test('router is case-insensitive on Windows', () => {
  const win = resolveTargets(ALL_TARGET_SPECS, { platform: 'win32', home: 'C:\\Users\\u', env: {}, workspaceFolders: [], listSubdirs: () => [] });
  const router = new TargetRouter(win, 'win32');
  assert.deepEqual(router.route('c:\\users\\U\\.codex\\CONFIG.toml').map((t) => t.id), ['codex.config']);
});

test('poller skips a tick while the previous one is still running', async () => {
  let runs = 0;
  let release!: () => void;
  const poller = new Poller(() => {
    runs++;
    return new Promise<void>((r) => (release = r));
  });
  const first = poller.tick();
  await poller.tick();
  assert.equal(runs, 1);
  release();
  await first;
  poller.start(0);
  assert.equal(poller.active, false, 'interval 0 disables polling');
});
