// High: something approved in advance on the user's behalf (Codex trusted_hash, skip-confirmation
// switches, project MCP servers). Medium: a project marked as trusted.
import type { Finding } from '../../core/types';
import { t } from '../../i18n';
import type { DocQuery, Rule } from '../context';
import { isObject, keyPath, prettyEvent } from '../util';

const TRUST_FIELDS = ['trusted_hash', 'trusted_content_hash'];

/**
 * Codex hook-state keys look like "postman@postman:hooks/codex-hooks.json:session_start:0:0"
 * (plugin, hooks file, event, group index, handler index).
 */
export function parseHookStateKey(key: string): { plugin: string; event: string } {
  const m = key.match(/^(.*):([A-Za-z_]+):(\d+):(\d+)$/);
  if (!m) return { plugin: key, event: '?' };
  const prefix = m[1];
  const plugin = prefix.match(/^([^:\\/]+@[^:\\/]+):/)?.[1] ?? prefix.split(/[\\/]/).pop() ?? prefix;
  // Codex writes events in lower snake_case ("stop", "session_start"); show them as PascalCase.
  const event = m[2].includes('_') ? prettyEvent(m[2]) : m[2][0].toUpperCase() + m[2].slice(1);
  return { plugin, event };
}

const FLAGS: Array<string[]> = [['skipDangerousModePermissionPrompt'], ['chat.tools.global.autoApprove'], ['github.copilot.chat.claudeAgent.allowDangerouslySkipPermissions']];

export const preapprovalRule: Rule = {
  id: 'preapproval',
  doc(q: DocQuery): Finding[] {
    const out: Finding[] = [];
    if (q.after.value === undefined) return out;

    for (const { path, value, before } of q.addedOrChanged(['hooks', 'state', '*'])) {
      if (!isObject(value)) continue;
      const old = isObject(before) ? before : {};
      const fields = TRUST_FIELDS.filter((f) => typeof value[f] === 'string' && value[f] !== old[f]);
      if (!fields.length) continue;
      const { plugin, event } = parseHookStateKey(path[2]);
      out.push({ rule: 'preapproval', level: 'high', reason: t('pre.hookTrust', { plugin, event, field: fields.join(', ') }), where: keyPath(path) });
    }

    for (const flag of FLAGS) {
      for (const { path, value, before } of q.addedOrChanged(flag)) {
        if (value === true && before !== true) out.push({ rule: 'preapproval', level: 'high', reason: t('pre.flag', { key: keyPath(path) }), where: keyPath(path) });
      }
    }

    for (const p of [['enableAllProjectMcpServers'], ['projects', '*', 'enableAllProjectMcpServers']]) {
      for (const { path, value, before } of q.addedOrChanged(p)) {
        if (value === true && before !== true) out.push({ rule: 'preapproval', level: 'high', reason: t('pre.mcpjson', { key: keyPath(path) }), where: keyPath(path) });
      }
    }
    for (const p of [['enabledMcpjsonServers'], ['projects', '*', 'enabledMcpjsonServers']]) {
      for (const { path, item } of q.arrayItemsAdded(p)) {
        const where = `${keyPath(path)}: ${String(item)}`;
        out.push({ rule: 'preapproval', level: 'high', reason: t('pre.mcpjson', { key: where }), where });
      }
    }

    // Medium: project trust.
    for (const { path, value, before } of q.addedOrChanged(['projects', '*', 'trust_level'])) {
      if (value === 'trusted' && before !== 'trusted') out.push({ rule: 'trust', level: 'medium', reason: t('trust.project', { where: path[1] }), where: keyPath(path) });
    }
    for (const { path, value, before } of q.addedOrChanged(['projects', '*', 'hasTrustDialogAccepted'])) {
      if (value === true && before !== true) out.push({ rule: 'trust', level: 'medium', reason: t('trust.project', { where: path[1] }), where: keyPath(path) });
    }
    for (const { item } of q.arrayItemsAdded(['trustedFolders'])) {
      out.push({ rule: 'trust', level: 'medium', reason: t('trust.project', { where: String(item) }), where: 'trustedFolders' });
    }
    return out;
  },
};
