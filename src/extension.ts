// Entry point. Everything is stored under the extension's globalStorage directory, on this machine only.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { pruneClaims } from './core/claim';
import { Monitor, type CheckReport, type PendingChange } from './core/monitor';
import { BaselineStore } from './core/store';
import { Controller } from './controller';
import { setLanguage } from './i18n';
import { assess } from './risk/engine';
import type { NotifyRecord } from './ui/notify';

/** Returned from activate() only when AGENT_CONFIG_GUARD_TEST=1 (integration tests). */
export interface TestApi {
  storageDir: string;
  onDidNotify: vscode.Event<NotifyRecord>;
  pending(): PendingChange[];
  checkNow(): Promise<CheckReport>;
}

let controller: Controller | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<TestApi | undefined> {
  setLanguage(vscode.env.language);
  const testMode = process.env.AGENT_CONFIG_GUARD_TEST === '1';
  const storageDir = context.globalStorageUri.fsPath;
  await fs.mkdir(storageDir, { recursive: true, mode: 0o700 });
  const claimsDir = path.join(storageDir, 'claims');
  await pruneClaims(claimsDir, 30 * 24 * 3600 * 1000);

  const store = new BaselineStore(path.join(storageDir, 'baseline'));
  const monitor = new Monitor({
    store,
    claimsDir,
    assess: (change) => assess(change),
    autoAcceptLow: () => vscode.workspace.getConfiguration('agentConfigGuard').get<boolean>('autoAcceptLowRisk', true),
  });
  controller = new Controller(store, monitor);
  context.subscriptions.push(controller);
  await controller.start({ promptForBaseline: !testMode });

  if (!testMode) return undefined;
  const c = controller;
  return {
    storageDir,
    onDidNotify: c.notifier.onDidNotify,
    pending: () => monitor.pendingChanges,
    checkNow: () => c.check(c.allTargets),
  };
}

export function deactivate(): void {
  controller = undefined;
}
