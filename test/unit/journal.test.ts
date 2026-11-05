import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { entryForChange, Journal, redact } from '../../src/log/journal';
import { tempDir } from './helpers';
import { fileChange, json, run } from './risk-helpers';

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => ({ dir, cleanup } = await tempDir()));
afterEach(() => cleanup());

const SECRETS = ['SECRET_ENV_VALUE_123', 'Bearer abc.def.ghi', 'ghp_aaaaaaaaaaaaaaaaaaaa', 'hunter2', 'sk-live-0123456789abcdef', 'q=topsecret'];

describe('change log never contains config values', () => {
  test('env values, headers, MCP args and helper command lines stay out of the summary', async () => {
    const before = json({ mcpServers: {} });
    const after = json({
      env: { NODE_OPTIONS: SECRETS[0], MY_FLAG: SECRETS[3] },
      apiKeyHelper: `bash -c "echo ${SECRETS[4]}"`,
      statusLine: { type: 'command', command: `curl https://x.example/s?${SECRETS[5]}` },
      mcpServers: {
        a: { command: 'npx', args: ['-y', 'pkg', '--token', SECRETS[2]], env: { API_KEY: SECRETS[0] } },
        b: { type: 'http', url: `https://user:${SECRETS[3]}@mcp.example.com/mcp?${SECRETS[5]}`, headers: { Authorization: SECRETS[1] } },
      },
    });
    const change = fileChange('claude.settings', before, after);
    const assessment = await run(change);
    assert.ok(assessment.findings.length >= 5, 'the rules did fire');
    const line = JSON.stringify(entryForChange('detected', change, assessment));
    for (const s of SECRETS) assert.ok(!line.includes(s), `log line leaks ${s}: ${line}`);
    assert.match(line, /mcp\.example\.com/, 'hosts are kept');
  });

  test('redact() strips credentials that a quoted allow rule could contain', () => {
    assert.equal(redact('Bash(git push https://me:pw@github.com/o/r)'), 'Bash(git push https://***@github.com/o/r)');
    assert.equal(redact('curl https://api.example.com/x?token=abc&x=1'), 'curl https://api.example.com/x?***');
    assert.equal(redact('export OPENAI_API_KEY=sk-proj-abcdefghijklmnop'), 'export OPENAI_API_KEY=sk-***');
    assert.equal(redact('password: hunter2'), 'password: ***');
    assert.equal(redact('Authorization: Bearer eyJabc.def'), 'Authorization: Bearer ***');
    assert.equal(redact('New MCP server db (node): the agent will start it.'), 'New MCP server db (node): the agent will start it.');
  });
});

describe('Journal file', () => {
  test('append, read back, export; file is owner-only', async () => {
    const j = new Journal(path.join(dir, 'storage', 'journal.jsonl'));
    const change = fileChange('codex.config', 'a = 1\n', 'notify = ["x"]\n');
    const assessment = await run(change);
    await j.append([entryForChange('detected', change, assessment, {}, new Date('2026-11-06T10:00:00Z'))]);
    await j.append([entryForChange('reverted', change, assessment, { backup: '/x/config.toml.bak-1' })]);
    const all = await j.readAll();
    assert.deepEqual(all.map((e) => e.action), ['detected', 'reverted']);
    assert.equal(all[0].level, 'high');
    assert.deepEqual(all[0].rules, ['commands']);
    assert.equal(all[0].ts, '2026-11-06T10:00:00.000Z');
    assert.equal(all[1].backup, '/x/config.toml.bak-1');
    if (process.platform !== 'win32') assert.equal((await fs.stat(j.file)).mode & 0o777, 0o600);

    const dest = path.join(dir, 'export.jsonl');
    assert.equal(await j.exportTo(dest), 2);
    assert.equal((await fs.readFile(dest, 'utf8')).trim().split('\n').length, 2);
  });

  test('a torn last line (crash mid-write) is skipped', async () => {
    const j = new Journal(path.join(dir, 'journal.jsonl'));
    await fs.writeFile(j.file, '{"ts":"t","action":"detected","summary":"ok"}\n{"ts":"t","act');
    assert.equal((await j.readAll()).length, 1);
  });

  test('missing log reads as empty', async () => {
    assert.deepEqual(await new Journal(path.join(dir, 'none.jsonl')).readAll(), []);
  });
});
