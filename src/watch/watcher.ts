// Real-time watching through VS Code's file watcher, which can watch folders outside the
// workspace when given a Uri base (see vscode.d.ts, workspace.createFileSystemWatcher).
import * as vscode from 'vscode';
import type { Target } from '../core/types';
import { TargetRouter, watchPlan } from './route';

export class ConfigWatcher implements vscode.Disposable {
  private watchers: vscode.Disposable[] = [];
  private router = new TargetRouter([]);
  private queued = new Map<string, Target>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly onTargets: (targets: Target[]) => void,
    private readonly debounceMs = 500,
  ) {}

  update(targets: Target[]): void {
    this.disposeWatchers();
    this.router = new TargetRouter(targets);
    for (const spec of watchPlan(targets)) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(spec.base), spec.pattern));
      const handle = (uri: vscode.Uri) => this.queue(uri.fsPath);
      this.watchers.push(w, w.onDidCreate(handle), w.onDidChange(handle), w.onDidDelete(handle));
    }
  }

  private queue(fsPath: string): void {
    for (const t of this.router.route(fsPath)) this.queued.set(t.key, t);
    if (this.queued.size === 0) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const batch = [...this.queued.values()];
      this.queued.clear();
      this.onTargets(batch);
    }, this.debounceMs);
  }

  private disposeWatchers(): void {
    for (const d of this.watchers) d.dispose();
    this.watchers = [];
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.disposeWatchers();
  }
}
