// Status bar: "$(shield) N" pending changes; warning background when any is high risk.
import * as vscode from 'vscode';
import type { PendingChange } from '../core/monitor';
import { t } from '../i18n';

export class StatusView implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('agentConfigGuard.status', vscode.StatusBarAlignment.Left, 50);

  constructor() {
    this.item.name = 'Agent Config Guard';
    this.item.command = 'agentConfigGuard.changes.focus';
    this.item.show();
  }

  update(pending: PendingChange[], hasBaseline: boolean): void {
    const high = pending.filter((p) => p.assessment.level === 'high').length;
    if (!hasBaseline) {
      this.item.text = '$(shield)';
      this.item.tooltip = t('ui.status.noBaseline');
      this.item.backgroundColor = undefined;
      return;
    }
    this.item.text = pending.length ? `$(shield) ${pending.length}` : '$(shield)';
    this.item.tooltip = pending.length ? t('ui.status.some', { count: pending.length, high }) : t('ui.status.none');
    this.item.backgroundColor = high ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
