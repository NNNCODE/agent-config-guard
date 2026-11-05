// Notifications. High risk uses a warning; everything else an information message.
// Every notification is also emitted as an event so the integration test can observe it.
import * as vscode from 'vscode';
import type { RiskLevel } from '../core/types';

export interface NotifyRecord {
  level: RiskLevel | 'info';
  message: string;
  actions: string[];
  /** Target key when the notification is about one change. */
  key?: string;
}

export class Notifier implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<NotifyRecord>();
  readonly onDidNotify = this.emitter.event;

  /** Resolves with the chosen action, or undefined when dismissed. */
  show(record: NotifyRecord): Thenable<string | undefined> {
    this.emitter.fire(record);
    const show = record.level === 'high' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    return show(record.message, ...record.actions);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
