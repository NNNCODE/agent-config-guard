// Wires the pieces together inside VS Code: targets, watcher + poller, monitor, notifications,
// tree, status bar, diff view and commands.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { ALL_TARGET_SPECS } from './agents';
import { countExisting, createBaseline, firstRunAction, scanAll } from './core/baseline';
import type { CheckReport, Monitor, PendingChange } from './core/monitor';
import { scopeLabel, singleMessage, snapshotText } from './core/render';
import { scanTarget } from './core/scan';
import type { BaselineStore } from './core/store';
import type { Target } from './core/types';
import { t } from './i18n';
import { resolveTargets, type ResolveContext } from './paths';
import { DiffProvider, SCHEME, type Side } from './ui/diffView';
import { Notifier } from './ui/notify';
import { StatusView } from './ui/statusBar';
import { ChangesTree, type Node } from './ui/tree';
import { Poller } from './watch/poller';
import { ConfigWatcher } from './watch/watcher';

const VIEW_ID = 'agentConfigGuard.changes';

/** Commands receive a target key (from notifications) or a tree node (from context menus). */
export function keyOf(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg;
  const node = arg as Node | undefined;
  if (node?.type === 'file') return node.target.key;
  if (node?.type === 'finding') return node.key;
  return undefined;
}

export class Controller implements vscode.Disposable {
  private targets: Target[] = [];
  readonly notifier = new Notifier();
  private readonly watcher: ConfigWatcher;
  private readonly poller: Poller;
  private readonly tree: ChangesTree;
  private readonly treeView: vscode.TreeView<Node>;
  private readonly status = new StatusView();
  private readonly diff: DiffProvider;
  readonly log = vscode.window.createOutputChannel('Agent Config Guard', { log: true });
  private readonly disposables: vscode.Disposable[] = [];
  /** Extension points filled in by later modules (change log). */
  readonly reportListeners: Array<(report: CheckReport) => void | Promise<void>> = [];
  readonly baselineListeners: Array<(counts: { files: number; agents: number }) => void | Promise<void>> = [];

  constructor(
    readonly store: BaselineStore,
    readonly monitor: Monitor,
  ) {
    this.watcher = new ConfigWatcher((targets) => void this.check(targets));
    this.poller = new Poller(() => this.check(this.targets));
    this.tree = new ChangesTree({
      hasBaseline: () => !!this.store.index,
      targets: () => this.targets,
      exists: (target) => !!this.store.record(target.key)?.exists,
      pending: (key) => this.monitor.getPending(key),
      scopeLabel: (target) => scopeLabel(target, this.workspaceFolders()),
    });
    this.treeView = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this.tree, showCollapseAll: true });
    this.diff = new DiffProvider((key, side) => this.diffText(key, side));
    this.disposables.push(
      this.watcher,
      this.tree,
      this.treeView,
      this.status,
      this.diff,
      this.notifier,
      this.log,
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, this.diff),
      { dispose: this.monitor.onDidChangePending(() => this.refreshViews()) },
      { dispose: () => this.poller.stop() },
    );
  }

  workspaceFolders(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
  }

  resolveContext(): ResolveContext {
    return {
      platform: process.platform,
      home: os.homedir(),
      env: process.env,
      workspaceFolders: this.workspaceFolders(),
      listSubdirs: (dir) => {
        try {
          return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
        } catch {
          return [];
        }
      },
    };
  }

  get allTargets(): Target[] {
    return this.targets;
  }

  findTarget(key: string | undefined): Target | undefined {
    return key ? this.targets.find((t) => t.key === key) : undefined;
  }

  refreshTargets(): void {
    this.targets = resolveTargets(ALL_TARGET_SPECS, this.resolveContext());
    this.monitor.retain(this.targets);
    if (this.store.index) this.watcher.update(this.targets);
  }

  async start(opts: { promptForBaseline: boolean }): Promise<void> {
    this.refreshTargets();
    this.registerCommands();
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.refreshTargets();
        void this.check(this.targets);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('agentConfigGuard.pollIntervalSeconds') && this.store.index) this.startPolling();
      }),
    );
    const index = await this.store.load();
    await this.refreshViews();
    if (!index) {
      if (opts.promptForBaseline) void this.promptFirstRun();
      return;
    }
    this.startWatching();
    const report = await this.monitor.check(this.targets);
    await this.handleReport(report, { startup: true });
  }

  private startPolling(): void {
    const seconds = vscode.workspace.getConfiguration('agentConfigGuard').get<number>('pollIntervalSeconds', 60);
    this.poller.start(seconds);
  }

  private startWatching(): void {
    this.watcher.update(this.targets);
    this.startPolling();
  }

  async refreshViews(): Promise<void> {
    const hasBaseline = !!this.store.index;
    await vscode.commands.executeCommand('setContext', 'agentConfigGuard.noBaseline', !hasBaseline);
    const pending = this.monitor.pendingChanges;
    this.status.update(pending, hasBaseline);
    this.treeView.badge = pending.length ? { value: pending.length, tooltip: t('ui.status.some', { count: pending.length, high: pending.filter((p) => p.assessment.level === 'high').length }) } : undefined;
    this.tree.refresh();
  }

  /** Runs a check and handles its report (notifications, change log). */
  async check(targets: Target[]): Promise<CheckReport> {
    const report = await this.monitor.check(targets);
    await this.handleReport(report, { startup: false });
    return report;
  }

  private async promptFirstRun(): Promise<void> {
    const { files, agents } = countExisting(await scanAll(this.targets));
    const create = t('ui.createBaseline');
    const choice = await this.notifier.show({ level: 'info', message: t('ui.firstRun', { files, agents }), actions: [create, t('ui.notNow')] });
    if (choice !== create) return;
    await this.syncWithDisk();
    const action = firstRunAction(!!this.store.index, this.monitor.pendingChanges.length);
    if (action !== 'nothing') await this.createBaseline({ confirm: action === 'confirm-recreate' });
  }

  /**
   * Reads the baseline again and, when there is one, starts monitoring and checks the files.
   * Another window may have created the baseline or found changes since this window last looked;
   * a window that started without a baseline never reads it again on its own.
   */
  private async syncWithDisk(): Promise<void> {
    if (!(await this.store.load())) return;
    this.startWatching();
    await this.check(this.targets);
    await this.refreshViews();
  }

  async createBaseline(opts: { confirm: boolean }): Promise<void> {
    if (opts.confirm) {
      // Without this, a window that has not seen the baseline yet would recreate it without asking,
      // and the count below would miss changes found by other windows.
      await this.syncWithDisk();
      if (this.store.index) {
        const recreate = t('ui.recreate');
        const choice = await vscode.window.showWarningMessage(t('ui.recreateConfirm', { count: this.monitor.pendingChanges.length }), { modal: true }, recreate);
        if (choice !== recreate) return;
      }
    }
    const results = await createBaseline(this.store, this.targets);
    for (const r of results) if (r.error) this.log.warn(`${r.target.path}: ${r.error}`);
    this.monitor.clear();
    this.startWatching();
    await this.refreshViews();
    const { files, agents } = countExisting(results);
    for (const l of this.baselineListeners) await l({ files, agents });
    void this.notifier.show({ level: 'info', message: t('ui.baselineCreated', { files, agents }), actions: [] });
  }

  private async handleReport(report: CheckReport, opts: { startup: boolean }): Promise<void> {
    for (const e of report.errors) this.log.warn(`${e.target.path}: ${e.message}`);
    for (const l of this.reportListeners) {
      try {
        await l(report);
      } catch (err) {
        this.log.error(`report listener: ${(err as Error).message}`);
      }
    }
    // At startup remind about everything pending; at runtime announce only what this window claimed.
    const toAnnounce: PendingChange[] = opts.startup ? this.monitor.pendingChanges : report.detected.filter((d) => d.first).map((d) => d.pending);
    if (toAnnounce.length === 1) this.announceOne(toAnnounce[0]);
    else if (toAnnounce.length > 1) this.announceMany(toAnnounce, opts.startup);
  }

  /** Actions offered on a single-change notification. Extended by the accept/revert module. */
  singleActions: Array<{ label: () => string; run: (key: string) => unknown }> = [{ label: () => t('ui.viewDiff'), run: (key) => this.showDiff(key) }];

  private announceOne(p: PendingChange): void {
    const actions = this.singleActions.map((a) => ({ title: a.label(), run: a.run }));
    void this.notifier.show({ level: p.assessment.level, message: singleMessage(p, this.workspaceFolders()), actions: actions.map((a) => a.title), key: p.key }).then((choice) => {
      const action = actions.find((a) => a.title === choice);
      if (action) return action.run(p.key);
    });
  }

  private announceMany(list: PendingChange[], startup: boolean): void {
    const high = list.filter((p) => p.assessment.level === 'high').length;
    const open = t('ui.openList');
    const message = t(startup ? 'ui.summaryStartup' : 'ui.summary', { count: list.length, high });
    void this.notifier.show({ level: high ? 'high' : 'medium', message, actions: [open] }).then((choice) => {
      if (choice === open) return vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    });
  }

  async showDiff(arg: unknown): Promise<void> {
    const target = this.findTarget(keyOf(arg));
    if (target) await this.diff.open(target);
  }

  private async diffText(key: string, side: Side): Promise<string> {
    const target = this.findTarget(key);
    if (!target) return '';
    if (side === 'baseline') {
      const pending = this.monitor.getPending(key);
      if (pending) return snapshotText(pending.change.before);
      const record = this.store.record(key);
      return snapshotText(record ? await this.store.snapshotOf(record) : undefined);
    }
    return snapshotText(await scanTarget(target));
  }

  private registerCommands(): void {
    const reg = (id: string, fn: (...args: unknown[]) => unknown) => this.disposables.push(vscode.commands.registerCommand(id, fn));
    reg('agentConfigGuard.createBaseline', () => this.createBaseline({ confirm: true }));
    reg('agentConfigGuard.checkNow', async () => {
      if (!this.store.index) return void vscode.window.showInformationMessage(t('ui.needBaseline'));
      const report = await this.check(this.targets);
      if (!report.detected.length) {
        const n = this.monitor.pendingChanges.length;
        void vscode.window.showInformationMessage(n ? t('ui.checkFound', { count: n }) : t('ui.checkNone'));
      }
    });
    reg('agentConfigGuard.showDiff', (arg) => this.showDiff(arg));
  }

  registerCommand(id: string, fn: (...args: unknown[]) => unknown): void {
    this.disposables.push(vscode.commands.registerCommand(id, fn));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
