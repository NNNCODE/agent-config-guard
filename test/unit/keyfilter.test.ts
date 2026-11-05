import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchPaths, project, projectionText } from '../../src/core/keyfilter';

const claudeJson = {
  numStartups: 42,
  tipsHistory: { a: 1 },
  mcpServers: { local: { command: 'node', args: ['x.js'] } },
  projects: {
    'D:\\leaseFrance': { allowedTools: [], history: ['x'], mcpServers: {} },
    'D:\\LeaseFrance': { hasTrustDialogAccepted: true, lastCost: 3 },
  },
};

const patterns = [['mcpServers'], ['projects', '*', 'mcpServers'], ['projects', '*', 'allowedTools'], ['projects', '*', 'hasTrustDialogAccepted']];

test('projection keeps only matching subtrees', () => {
  assert.deepEqual(project(claudeJson, patterns), {
    mcpServers: { local: { args: ['x.js'], command: 'node' } },
    projects: {
      'D:\\LeaseFrance': { hasTrustDialogAccepted: true },
      'D:\\leaseFrance': { allowedTools: [], mcpServers: {} },
    },
  });
});

test('keys that differ only by case stay separate', () => {
  const paths = matchPaths(claudeJson, patterns).map((m) => m.path.join('/'));
  assert.ok(paths.includes('projects/D:\\leaseFrance/mcpServers'));
  assert.ok(paths.includes('projects/D:\\LeaseFrance/hasTrustDialogAccepted'));
});

test('unrelated changes do not change the projection text', () => {
  const before = projectionText(claudeJson, patterns);
  const after = projectionText({ ...claudeJson, numStartups: 43, tipsHistory: { b: 2 } }, patterns);
  assert.equal(after, before);
});

test('key order in the source does not change the projection text', () => {
  const reordered = { projects: claudeJson.projects, mcpServers: claudeJson.mcpServers };
  assert.equal(projectionText(reordered, patterns), projectionText(claudeJson, patterns));
});

test('RegExp segments match flat VS Code setting keys', () => {
  const settings = { 'editor.fontSize': 14, 'chat.tools.global.autoApprove': true, 'github.copilot.enable': { '*': true }, 'mcp': { servers: {} } };
  assert.deepEqual(Object.keys(project(settings, [[/^chat\./], [/^github\.copilot/], [/^mcp/]])), ['chat.tools.global.autoApprove', 'github.copilot.enable', 'mcp']);
});

test('non-object roots project to an empty object', () => {
  assert.deepEqual(project([1, 2] as never, patterns), {});
});
