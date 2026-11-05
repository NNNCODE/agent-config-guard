import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PendingChange } from '../../src/core/monitor';
import { scopeLabel, singleMessage, snapshotText } from '../../src/core/render';
import { setLanguage } from '../../src/i18n';
import { target } from './risk-helpers';

test('snapshotText: file content, missing file, folder listing with stored files', () => {
  assert.equal(snapshotText({ kind: 'file', exists: true, content: 'a = 1\n' }), 'a = 1\n');
  assert.equal(snapshotText({ kind: 'file', exists: false }), '(file does not exist)\n');
  assert.match(snapshotText({ kind: 'file', exists: true, tooLarge: true }), /not stored/);
  const dir = snapshotText({
    kind: 'dir',
    exists: true,
    entries: [{ rel: 'foo', type: 'dir' }, { rel: 'foo/SKILL.md', type: 'file', hash: 'abcdef1234567890', size: 5 }],
    contents: { 'foo/SKILL.md': 'hello' },
  });
  assert.match(dir, /^foo\/\nfoo\/SKILL\.md {2}5 B {2}abcdef123456\n/);
  assert.match(dir, /===== foo\/SKILL\.md =====\nhello/);
});

test('scopeLabel names the workspace folder for project files', () => {
  const t = { ...target('claude.p.mcp'), path: '/w/repo/.mcp.json' };
  assert.equal(scopeLabel(t, ['/w/repo']), 'project (repo)');
  assert.equal(scopeLabel(target('claude.settings'), []), 'user');
});

test('singleMessage: agent, scope, file, top reason and "+N more", in both languages', () => {
  const p: PendingChange = {
    key: 'k',
    claim: 'c',
    detectedAt: '',
    change: { target: target('codex.config'), kind: 'modified', before: { kind: 'file', exists: true }, after: { kind: 'file', exists: true } },
    assessment: {
      level: 'high',
      findings: [
        { rule: 'plugins', level: 'high', reason: 'New plugin marketplace postman.' },
        { rule: 'plugins', level: 'high', reason: 'x' },
        { rule: 'preapproval', level: 'high', reason: 'y' },
      ],
    },
  };
  assert.equal(singleMessage(p, []), 'Codex user config.toml was changed: New plugin marketplace postman. (+2 more)');
  setLanguage('zh-cn');
  assert.equal(singleMessage(p, []), 'Codex 用户级 config.toml 被改动：New plugin marketplace postman.（另有 2 项）');
  setLanguage('en');
});
