// "View diff": baseline (read-only virtual document) on the left, current state on the right.
// Plain files show the real file on the right; key-filtered files and folders use a virtual
// document for both sides (the projection / the listing).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Target } from '../core/types';
import { t } from '../i18n';

export const SCHEME = 'agent-config-guard';
export type Side = 'baseline' | 'current';

export class DiffProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly source: (key: string, side: Side) => Promise<string>) {}

  provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const key = new URLSearchParams(uri.query).get('key') ?? '';
    const side = uri.path.split('/')[1] as Side;
    return this.source(key, side);
  }

  uriFor(target: Target, side: Side): vscode.Uri {
    const base = path.basename(target.path);
    // Keep the real extension so the editor picks the right syntax highlighting.
    const name = target.kind === 'dir' ? `${base}.txt` : base;
    return vscode.Uri.from({ scheme: SCHEME, path: `/${side}/${name}`, query: `key=${encodeURIComponent(target.key)}&t=${Date.now()}` });
  }

  async open(target: Target): Promise<void> {
    const left = this.uriFor(target, 'baseline');
    const realFile = target.kind === 'file' && !target.keyFilter && fs.existsSync(target.path);
    const right = realFile ? vscode.Uri.file(target.path) : this.uriFor(target, 'current');
    await vscode.commands.executeCommand('vscode.diff', left, right, t('ui.diffTitle', { file: target.label }), { preview: true });
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
