// Sidebar: Agent → file → findings, with status icons.
import * as vscode from 'vscode';
import { AGENTS, agentName, type AgentDef } from '../agents';
import type { PendingChange } from '../core/monitor';
import type { Finding, Target } from '../core/types';
import { t } from '../i18n';

export interface TreeModel {
  hasBaseline(): boolean;
  targets(): Target[];
  /** True when the baseline or the current state has this path. */
  exists(target: Target): boolean;
  pending(key: string): PendingChange | undefined;
  scopeLabel(target: Target): string;
}

export type Node = { type: 'agent'; agent: AgentDef } | { type: 'file'; target: Target } | { type: 'finding'; finding: Finding; key: string };

const LEVEL_ICON: Record<string, vscode.ThemeIcon> = {
  high: new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground')),
  medium: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground')),
  low: new vscode.ThemeIcon('info'),
};
const OK_ICON = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));

export class ChangesTree implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly model: TreeModel) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  private visibleTargets(agentId: string): Target[] {
    return this.model
      .targets()
      .filter((t) => t.agent === agentId && (this.model.exists(t) || this.model.pending(t.key)))
      .sort((a, b) => this.rank(a) - this.rank(b) || a.scope.localeCompare(b.scope) || a.label.localeCompare(b.label));
  }

  private rank(target: Target): number {
    const p = this.model.pending(target.key);
    return !p ? 2 : p.assessment.level === 'high' ? 0 : 1;
  }

  getChildren(node?: Node): Node[] {
    if (!this.model.hasBaseline()) return []; // the welcome view offers "Create baseline"
    if (!node) {
      return AGENTS.filter((a) => this.visibleTargets(a.id).length).map((agent) => ({ type: 'agent' as const, agent }));
    }
    if (node.type === 'agent') return this.visibleTargets(node.agent.id).map((target) => ({ type: 'file' as const, target }));
    if (node.type === 'file') {
      const p = this.model.pending(node.target.key);
      return p ? p.assessment.findings.map((finding) => ({ type: 'finding' as const, finding, key: node.target.key })) : [];
    }
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === 'agent') {
      const files = this.visibleTargets(node.agent.id);
      const pending = files.map((f) => this.model.pending(f.key)).filter((p): p is PendingChange => !!p);
      const item = new vscode.TreeItem(node.agent.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = pending.some((p) => p.assessment.level === 'high') ? LEVEL_ICON.high : pending.length ? LEVEL_ICON.medium : OK_ICON;
      item.description = pending.length ? `${pending.length} · ${t('ui.tree.changed')}` : t('ui.tree.ok');
      item.contextValue = 'agent';
      return item;
    }
    if (node.type === 'file') {
      const { target } = node;
      const p = this.model.pending(target.key);
      const item = new vscode.TreeItem(target.label, p ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.id = target.key;
      item.resourceUri = vscode.Uri.file(target.path);
      const status = !p ? t('ui.tree.ok') : p.assessment.level === 'high' ? t('ui.tree.high') : `${t('ui.tree.changed')} (${t(`ui.kind.${p.change.kind}`)})`;
      item.description = `${this.model.scopeLabel(target)} · ${status}`;
      item.iconPath = p ? LEVEL_ICON[p.assessment.level] : OK_ICON;
      const tip = [target.path];
      if (target.alsoReadBy?.length) tip.push(t('ui.tree.alsoReadBy', { agents: target.alsoReadBy.map(agentName).join(', ') }));
      if (!target.confirmed) tip.push(t('ui.tree.unconfirmed'));
      item.tooltip = tip.join('\n');
      item.contextValue = p ? 'file.pending' : 'file.ok';
      item.command = p
        ? { command: 'agentConfigGuard.showDiff', title: t('ui.viewDiff'), arguments: [target.key] }
        : target.kind === 'file'
          ? { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(target.path)] }
          : undefined;
      return item;
    }
    const item = new vscode.TreeItem(node.finding.reason, vscode.TreeItemCollapsibleState.None);
    item.iconPath = LEVEL_ICON[node.finding.level];
    item.tooltip = node.finding.where ? `${node.finding.reason}\n${node.finding.where}` : node.finding.reason;
    item.contextValue = 'finding';
    item.command = { command: 'agentConfigGuard.showDiff', title: t('ui.viewDiff'), arguments: [node.key] };
    return item;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
