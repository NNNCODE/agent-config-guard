// The case that motivated the extension: postmanlabs/postman-app-support#14370.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { after, describe, test } from 'node:test';
import { setLanguage } from '../../src/i18n';
import { findHookEvents } from '../../src/risk/inspect';
import { readFixture, tempDir, writeFile } from './helpers';
import { dirChange, fileChange, run, tags } from './risk-helpers';

after(() => setLanguage('en'));

describe('Postman 12.33.4 writing into Codex config.toml', () => {
  test('marketplace, plugin and hook pre-approval: three high findings', async () => {
    const change = fileChange('codex.config', await readFixture('codex', 'postman-before.toml'), await readFixture('codex', 'postman-after.toml'));
    const a = await run(change);
    assert.equal(a.level, 'high');
    assert.deepEqual(tags(a).sort(), ['high:plugins', 'high:plugins', 'high:preapproval']);
    const reasons = a.findings.map((f) => f.reason).join('\n');
    assert.match(reasons, /plugin marketplace postman \(github\.com\/postmanlabs\/postman-plugin\.git\)/);
    assert.match(reasons, /Plugin postman@postman installed or enabled/);
    assert.match(reasons, /Pre-approved the SessionStart hook of postman@postman \(trusted_hash, trusted_content_hash\)/);
  });

  test('reasons in Chinese when VS Code runs in Chinese', async () => {
    setLanguage('zh-cn');
    const change = fileChange('codex.config', await readFixture('codex', 'postman-before.toml'), await readFixture('codex', 'postman-after.toml'));
    const reasons = (await run(change)).findings.map((f) => f.reason).join('\n');
    assert.match(reasons, /预先批准了 postman@postman 的 SessionStart 钩子/);
    assert.match(reasons, /新增插件市场 postman/);
    setLanguage('en');
  });

  test('the same file without Postman\'s sections is not flagged', async () => {
    const before = await readFixture('codex', 'postman-before.toml');
    const a = await run(fileChange('codex.config', before, before.replace('model = "gpt-5.5"', 'model = "gpt-5.6"')));
    assert.deepEqual(tags(a), ['low:other']);
    assert.match(a.findings[0].reason, /model/);
  });

  test('new plugin folder in ~/.codex/plugins/cache names the SessionStart hook it brings', async () => {
    const { dir, cleanup } = await tempDir();
    try {
      await writeFile(
        path.join(dir, 'postman', 'postman', '1.1.0', 'hooks', 'codex-hooks.json'),
        JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup|clear|compact', hooks: [{ type: 'command', command: 'cat hooks/session-start-context.md' }] }] } }),
      );
      assert.deepEqual(await findHookEvents(path.join(dir, 'postman')), ['SessionStart']);
      const change = dirChange('codex.pluginCache', { 'openai-bundled': null, 'openai-bundled/browser': null }, { 'openai-bundled': null, 'openai-bundled/browser': null, postman: null, 'postman/postman': null });
      const a = await run(change, { findHookEvents: async (p) => (p.endsWith('postman') ? ['SessionStart'] : []) });
      assert.deepEqual(tags(a), ['high:plugins']);
      assert.match(a.findings[0].reason, /New plugin folder postman\/postman brings its own hooks: SessionStart/);
    } finally {
      await cleanup();
    }
  });
});

describe('Postman 12.33.4 writing into Claude Code', () => {
  test('settings.json: postman plugin enabled', async () => {
    const a = await run(fileChange('claude.settings', await readFixture('claude', 'postman-settings-before.json'), await readFixture('claude', 'postman-settings-after.json')));
    assert.deepEqual(tags(a), ['high:plugins']);
    assert.match(a.findings[0].reason, /postman@claude-plugins-official/);
  });

  test('installed_plugins.json: postman recorded as installed', async () => {
    const a = await run(fileChange('claude.plugins.installed', await readFixture('claude', 'postman-installed-before.json'), await readFixture('claude', 'postman-installed-after.json')));
    assert.deepEqual(tags(a), ['high:plugins']);
  });

  test('the startup instructions it injects are flagged as coercive', async () => {
    const text = await readFixture('instructions', 'postman-session-start-context.md');
    const a = await run(fileChange('claude.memory', '# My notes\n', `# My notes\n${text}`));
    assert.deepEqual(tags(a), ['medium:instructions']);
    assert.equal(a.findings[0].escalated, true);
    assert.match(a.findings[0].reason, /Before responding to any non-trivial API/);
  });
});

test('fixture files exist and are valid', async () => {
  for (const f of ['postman-before.toml', 'postman-after.toml']) assert.ok((await fs.stat(path.resolve(__dirname, '../../../test/fixtures/codex', f))).size > 0);
});
