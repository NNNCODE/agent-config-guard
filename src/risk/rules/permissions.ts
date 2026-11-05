// Permissions loosened: broad allow rules (high), specific allow rules (medium), deny rules
// removed (high), approval/sandbox modes that stop asking (high).
import type { Json } from '../../core/keyfilter';
import type { Finding, KeyPattern } from '../../core/types';
import { t } from '../../i18n';
import type { DocQuery, Rule } from '../context';
import { hostOf, isObject, keyPath } from '../util';

const BROAD_BARE = new Set(['bash', 'shell', 'write', 'edit', 'multiedit', 'webfetch', 'notebookedit', 'powershell']);

/** "Bash", "Bash(*)", "Bash(*:*)", "Shell(*)", "*" — rules that allow a whole tool. */
export function isBroadRule(rule: string): boolean {
  const r = rule.trim();
  if (r === '*' || r === '.*' || r === '/.*/') return true;
  if (BROAD_BARE.has(r.toLowerCase())) return true;
  return /^[A-Za-z_]+\(\s*\*[\s:*]*\)$/.test(r);
}

function allowFinding(rule: string, where: string): Finding {
  const broad = isBroadRule(rule);
  return { rule: 'permissions', level: broad ? 'high' : 'medium', reason: t(broad ? 'perm.broadAllow' : 'perm.allow', { rule }), where };
}

function str(v: Json): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** [key pattern, values that stop all asking (high), values that loosen less (medium)]. */
const MODES: Array<[KeyPattern, string[], string[]]> = [
  [['permissions', 'defaultMode'], ['bypassPermissions', 'auto', 'dontAsk'], ['acceptEdits']],
  [['approval_policy'], ['never'], []],
  [['profiles', '*', 'approval_policy'], ['never'], []],
  [['sandbox_mode'], ['danger-full-access'], []],
  [['profiles', '*', 'sandbox_mode'], ['danger-full-access'], []],
  [['approvalMode'], ['unrestricted'], ['auto-review']],
  [['defaultPermissionMode'], ['allow-all'], ['assisted']],
  [['chat.permissions.default'], ['autoApprove', 'autopilot'], []],
];

const LOOSENING_SWITCHES: Array<[KeyPattern, 'high' | 'medium']> = [
  [['chat.tools.terminal.ignoreDefaultAutoApproveRules'], 'high'],
  [['chat.agent.sandbox.allowUnsandboxedCommands'], 'high'],
  [['sandbox_workspace_write', 'network_access'], 'medium'],
];

export const permissionsRule: Rule = {
  id: 'permissions',
  doc(q: DocQuery): Finding[] {
    const out: Finding[] = [];

    // Codex .rules files (Starlark): a new prefix_rule with decision = "allow".
    if (q.role === 'permissions' && q.format === 'text') {
      if (q.addedLines().some((l) => /decision\s*=\s*["']allow["']/.test(l))) {
        out.push({ rule: 'permissions', level: 'high', reason: t('perm.rulesAllow', { file: q.file }), where: q.file });
      }
      return out;
    }
    if (q.after.value === undefined && q.before.value === undefined) return out;

    // Allow lists (Claude, Cursor CLI, ~/.claude.json per project).
    for (const p of [['permissions', 'allow'], ['projects', '*', 'allowedTools'], ['autoRun', 'allow_instructions']]) {
      for (const { path, item } of q.arrayItemsAdded(p)) out.push(allowFinding(str(item), keyPath(path)));
    }
    for (const { path, item } of q.arrayItemsAdded(['allowedUrls'])) {
      const rule = hostOf(item) ?? str(item);
      out.push({ rule: 'permissions', level: 'medium', reason: t('perm.allow', { rule }), where: keyPath(path) });
    }
    // Deny lists removed.
    for (const p of [['permissions', 'deny'], ['autoRun', 'block_instructions']]) {
      for (const { path, item } of q.arrayItemsRemoved(p)) {
        out.push({ rule: 'permissions', level: 'high', reason: t('perm.denyRemoved', { rule: str(item) }), where: keyPath(path) });
      }
    }
    // Modes.
    for (const [pattern, high, medium] of MODES) {
      for (const { path, value } of q.addedOrChanged(pattern)) {
        const key = keyPath(path);
        if (typeof value === 'string' && high.includes(value)) out.push({ rule: 'permissions', level: 'high', reason: t('perm.mode', { key, value }), where: key });
        else if (typeof value === 'string' && medium.includes(value)) out.push({ rule: 'permissions', level: 'medium', reason: t('perm.modeSoft', { key, value }), where: key });
        else if (isObject(value) && /approval_policy$/.test(key)) out.push({ rule: 'permissions', level: 'medium', reason: t('perm.modeSoft', { key, value: 'granular' }), where: key });
      }
    }
    for (const [pattern, level] of LOOSENING_SWITCHES) {
      for (const { path, value, before } of q.addedOrChanged(pattern)) {
        if (value === true && before !== true) out.push({ rule: 'permissions', level, reason: t('perm.setting', { key: keyPath(path) }), where: keyPath(path) });
      }
    }
    for (const { path } of q.arrayItemsAdded(['permissions', 'additionalDirectories'])) {
      out.push({ rule: 'permissions', level: 'medium', reason: t('perm.setting', { key: keyPath(path) }), where: keyPath(path) });
    }
    // VS Code terminal auto-approve map: {"npm": true, "/.*/": true}.
    for (const { path, value } of q.addedOrChanged(['chat.tools.terminal.autoApprove', '*'])) {
      const approve = value === true || (isObject(value) && value.approve === true);
      if (approve) out.push(allowFinding(path[1], keyPath(path)));
    }
    for (const key of ['chat.tools.edits.autoApprove', 'chat.tools.urls.autoApprove']) {
      for (const { path } of q.addedOrChanged([key, '*'])) out.push({ rule: 'permissions', level: 'medium', reason: t('perm.setting', { key }), where: keyPath(path) });
    }
    // OpenCode: permission / agent.<name>.permission, either a string or {tool: action | {pattern: action}}.
    if (q.agent === 'opencode') {
      for (const prefix of [['permission'], ['agent', '*', 'permission']] as KeyPattern[]) {
        for (const { path, value } of q.addedOrChanged(prefix)) {
          if (value === 'allow') out.push({ rule: 'permissions', level: 'high', reason: t('perm.mode', { key: keyPath(path), value: 'allow' }), where: keyPath(path) });
        }
        for (const { path, value } of q.addedOrChanged([...prefix, '*'])) {
          if (value === 'allow') {
            const key = keyPath(path);
            out.push({ rule: 'permissions', level: 'high', reason: t('perm.mode', { key, value: 'allow' }), where: key });
          }
        }
        for (const { path, value } of q.addedOrChanged([...prefix, '*', '*'])) {
          if (value !== 'allow') continue;
          const tool = path[path.length - 2];
          const pattern = path[path.length - 1];
          out.push(pattern === '*' ? { rule: 'permissions', level: 'high', reason: t('perm.broadAllow', { rule: `${tool}: *` }), where: keyPath(path) } : allowFinding(`${tool}: ${pattern}`, keyPath(path)));
        }
      }
    }
    // Copilot CLI saved permissions (shape not documented): any addition counts as medium.
    if (q.target.id === 'copilot.cliPermissions' && q.kind !== 'deleted') {
      out.push({ rule: 'permissions', level: 'medium', reason: t('perm.setting', { key: 'permissions-config.json' }), where: q.file });
    }
    return out;
  },
};
