// Accept / Revert commands and notification buttons.
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Controller } from '../controller';
import { keyOf } from '../controller';
import type { PendingChange } from '../core/monitor';
import type { Target } from '../core/types';
import { t } from '../i18n';
import { acceptChange, revertChange, RevertError, type RevertResult } from './revert';

export interface ActionEvent {
  action: 'accepted' | 'reverted';
  target: Target;
  /** The pending change at the moment of the decision (absent if the file was not pending). */
  pending?: PendingChange;
  backup?: string;
}

export function registerActions(c: Controller, storageDir: string, onAction: (e: ActionEvent) => void | Promise<void>): void {
  const backupRoot = path.join(storageDir, 'backups');

  const accept = async (arg: unknown) => {
    const target = c.findTarget(keyOf(arg));
    if (!target) return;
    const pending = c.monitor.getPending(target.key);
    await acceptChange(c.store, target);
    await c.check([target]);
    await onAction({ action: 'accepted', target, pending });
    vscode.window.setStatusBarMessage(t('ui.accepted', { file: target.label }), 5000);
  };

  const revert = async (arg: unknown): Promise<RevertResult | undefined> => {
    const target = c.findTarget(keyOf(arg));
    if (!target) return undefined;
    const pending = c.monitor.getPending(target.key);
    let result: RevertResult;
    try {
      result = await revertChange(c.store, target, backupRoot);
    } catch (err) {
      const error = err instanceof RevertError ? err.message : (err as Error).message;
      c.log.error(`revert ${target.path}: ${error}`);
      void vscode.window.showErrorMessage(t('ui.revertFailed', { file: target.label, error }));
      return undefined;
    }
    const report = await c.check([target]);
    await onAction({ action: 'reverted', target, pending, backup: result.backup });
    const file = target.label;
    if (result.unrestorable.length) {
      void vscode.window.showWarningMessage(t('ui.revertPartial', { file, items: result.unrestorable.join(', ') }));
    } else if (c.monitor.getPending(target.key) && !report.resolved.includes(target.key)) {
      void vscode.window.showWarningMessage(t('ui.revertStillDiffers', { file }));
    } else if (result.removed && result.backup) {
      void vscode.window.showInformationMessage(t('ui.revertedRemoved', { file, backup: result.backup }));
    } else {
      void vscode.window.showInformationMessage(result.backup ? t('ui.reverted', { file, backup: result.backup }) : t('ui.revertedNoBackup', { file }));
    }
    return result;
  };

  c.registerCommand('agentConfigGuard.accept', accept);
  c.registerCommand('agentConfigGuard.revert', revert);
  c.singleActions.push({ label: () => t('ui.accept'), run: (key) => accept(key) }, { label: () => t('ui.revert'), run: (key) => revert(key) });
}
