// Connects the change log to the controller: check reports, baseline creation, accept/revert.
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ActionEvent } from '../actions/commands';
import { timestamp } from '../actions/files';
import type { Controller } from '../controller';
import type { CheckReport } from '../core/monitor';
import { t } from '../i18n';
import { entryForChange, entryForTarget, Journal, type JournalEntry } from './journal';

export function wireJournal(c: Controller, journal: Journal): { onAction: (e: ActionEvent) => Promise<void> } {
  const write = async (entries: JournalEntry[]) => {
    try {
      await journal.append(entries);
    } catch (err) {
      c.log.error(`change log: ${(err as Error).message}`);
    }
  };

  c.reportListeners.push(async (report: CheckReport) => {
    const entries: JournalEntry[] = [];
    for (const { pending, first } of report.detected) if (first) entries.push(entryForChange('detected', pending.change, pending.assessment));
    for (const { change, assessment, first } of report.autoAccepted) if (first) entries.push(entryForChange('auto-accepted', change, assessment));
    for (const target of report.baselined) if (c.store.record(target.key)?.exists) entries.push(entryForTarget('baselined', target, ''));
    await write(entries);
  });

  c.baselineListeners.push(async ({ files, agents }) => {
    await write([{ ts: new Date().toISOString(), action: 'baseline-created', summary: t('log.baselineCreated', { files, agents }) }]);
  });

  c.registerCommand('agentConfigGuard.exportLog', async () => {
    const entries = await journal.readAll();
    if (!entries.length) return void vscode.window.showInformationMessage(t('ui.exportEmpty'));
    const dest = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(os.homedir(), `agent-config-guard-log-${timestamp()}.jsonl`)),
      filters: { 'JSON Lines': ['jsonl'] },
    });
    if (!dest) return;
    const count = await journal.exportTo(dest.fsPath);
    void vscode.window.showInformationMessage(t('ui.exported', { count, file: dest.fsPath }));
  });

  return {
    onAction: async (e: ActionEvent) => {
      const change = e.pending?.change ?? { target: e.target, kind: 'modified' as const };
      await write([entryForChange(e.action, change, e.pending?.assessment, { backup: e.backup })]);
    },
  };
}
