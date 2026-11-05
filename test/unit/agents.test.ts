import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENTS, ALL_TARGET_SPECS } from '../../src/agents';

test('registry covers exactly the 5 v1 agents', () => {
  assert.deepEqual(
    AGENTS.map((a) => a.id),
    ['claude', 'codex', 'cursor', 'copilot', 'opencode'],
  );
});

test('every agent has user-level and project-level targets', () => {
  for (const agent of AGENTS) {
    assert.ok(agent.targets.some((t) => t.scope === 'user'), `${agent.id} has user targets`);
    assert.ok(agent.targets.some((t) => t.scope === 'project'), `${agent.id} has project targets`);
  }
});

test('target ids are unique', () => {
  const ids = ALL_TARGET_SPECS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('key filters are only used on JSON/JSONC files', () => {
  for (const t of ALL_TARGET_SPECS.filter((s) => s.keyFilter)) {
    assert.equal(t.kind, 'file', t.id);
    assert.ok(t.format === 'json' || t.format === 'jsonc', `${t.id} format ${t.format}`);
  }
});

test('unconfirmed paths are exactly the ones agreed as best effort', () => {
  const unconfirmed = ALL_TARGET_SPECS.filter((t) => !t.confirmed).map((t) => t.id).sort();
  assert.deepEqual(unconfirmed, ['codex.skills', 'cursor.commands']);
});

test('Postman case targets are present', () => {
  const ids = new Set(ALL_TARGET_SPECS.map((t) => t.id));
  for (const id of ['codex.config', 'codex.pluginCache', 'claude.settings', 'claude.plugins.installed']) assert.ok(ids.has(id), id);
});

test('file formats are inferred from the name', () => {
  const byId = new Map(ALL_TARGET_SPECS.map((t) => [t.id, t]));
  assert.equal(byId.get('codex.config')?.format, 'toml');
  assert.equal(byId.get('claude.settings')?.format, 'json');
  assert.equal(byId.get('claude.memory')?.format, 'markdown');
  assert.equal(byId.get('cursor.p.cursorrules')?.format, 'markdown');
  assert.equal(byId.get('copilot.vscodeSettings')?.format, 'jsonc');
});
