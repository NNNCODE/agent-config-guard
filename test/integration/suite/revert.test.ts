// End to end in a real VS Code: Postman edits ~/.codex/config.toml → high-risk notification →
// diff opens on the baseline → revert puts the file back and keeps a .bak copy → change log.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { TestApi } from '../../../src/extension';
import type { NotifyRecord } from '../../../src/ui/notify';

const EXTENSION_ID = 'agent-config-guard.agent-config-guard';

function waitFor<T>(event: vscode.Event<T>, predicate: (e: T) => boolean, timeoutMs: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      reject(new Error(`timed out after ${timeoutMs} ms waiting for ${what}`));
    }, timeoutMs);
    const sub = event((e) => {
      if (!predicate(e)) return;
      clearTimeout(timer);
      sub.dispose();
      resolve(e);
    });
  });
}

async function postmanFlow(): Promise<void> {
  const ext = vscode.extensions.getExtension<TestApi>(EXTENSION_ID);
  assert.ok(ext, 'extension is installed in the test instance');
  const api = await ext.activate();
  assert.ok(api, 'test API is returned in test mode');

  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  const fixtures = process.env.ACG_FIXTURES as string;
  const before = await fs.readFile(configPath, 'utf8');
  const after = await fs.readFile(path.join(fixtures, 'codex', 'postman-after.toml'), 'utf8');

  // Poll quickly as a fallback in case the file watcher is slow on this machine.
  await vscode.workspace.getConfiguration('agentConfigGuard').update('pollIntervalSeconds', 2, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('agentConfigGuard.createBaseline');

  // 1. Postman writes its sections → a high-risk notification about config.toml.
  const notified = waitFor<NotifyRecord>(api.onDidNotify, (r) => r.level === 'high' && !!r.key?.endsWith('config.toml'), 30_000, 'the high-risk notification');
  await fs.writeFile(configPath, after);
  const record = await notified;
  assert.match(record.message, /^Codex user config\.toml was changed: /);
  assert.deepEqual(record.actions, ['View diff', 'Accept', 'Revert']);
  const pending = api.pending().find((p) => p.key === record.key);
  assert.equal(pending?.assessment.level, 'high');
  assert.deepEqual(pending?.assessment.findings.map((f) => f.rule).sort(), ['plugins', 'plugins', 'preapproval']);

  // 2. View diff: baseline (virtual, read-only) on the left, the real file on the right.
  await vscode.commands.executeCommand('agentConfigGuard.showDiff', record.key);
  const diffTab = vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputTextDiff);
  assert.ok(diffTab, 'a diff editor is open');
  const input = diffTab.input as vscode.TabInputTextDiff;
  assert.equal(input.original.scheme, 'agent-config-guard');
  assert.equal((await vscode.workspace.openTextDocument(input.original)).getText(), before);
  assert.equal(input.modified.fsPath.toLowerCase(), configPath.toLowerCase());
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');

  // 3. Revert: file back to the baseline, changed version kept next to it, nothing pending.
  await vscode.commands.executeCommand('agentConfigGuard.revert', record.key);
  assert.equal(await fs.readFile(configPath, 'utf8'), before);
  const backups = (await fs.readdir(path.dirname(configPath))).filter((n) => /^config\.toml\.bak-\d{8}-\d{6}/.test(n));
  assert.equal(backups.length, 1, `one backup, found ${backups.join(', ')}`);
  assert.equal(await fs.readFile(path.join(path.dirname(configPath), backups[0]), 'utf8'), after);
  assert.equal(api.pending().filter((p) => p.key === record.key).length, 0);

  // 4. Change log: detected and reverted, high risk, no config values.
  const log = (await fs.readFile(path.join(api.storageDir, 'journal.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  const actions = log.filter((e) => e.file?.toLowerCase() === configPath.toLowerCase()).map((e) => `${e.action}:${e.level}`);
  assert.deepEqual(actions, ['detected:high', 'reverted:high']);
  assert.ok(!JSON.stringify(log).includes('b67ddd1ece328f5a'), 'trusted_hash value is not in the log');
}

export const tests: Array<[string, () => Promise<void>]> = [['Postman edits Codex config → high-risk notification → revert', postmanFlow]];
