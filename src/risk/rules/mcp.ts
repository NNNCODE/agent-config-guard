// High: new or re-pointed MCP servers. Escalated when launched through npx & co., an inline
// shell line, or when connecting to a non-local URL.
import type { Json } from '../../core/keyfilter';
import type { Finding, KeyPattern } from '../../core/types';
import { t } from '../../i18n';
import type { DocQuery, Rule } from '../context';
import { commandParts, deepEqual, escalationOf, hostOf, isLocalHost, isObject, keyPath } from '../util';

const LAUNCH_FIELDS = ['command', 'args', 'url', 'serverUrl', 'type', 'env', 'environment', 'headers', 'http_headers', 'http_headers_helper', 'cwd'];

function serverPatterns(q: DocQuery): KeyPattern[] {
  const p: KeyPattern[] = [
    ['mcpServers', '*'],
    ['projects', '*', 'mcpServers', '*'],
    ['mcp_servers', '*'],
    ['plugins', '*', 'mcp_servers', '*'],
    ['mcp', 'servers', '*'],
  ];
  if (q.agent === 'opencode') p.push(['mcp', '*']);
  if (q.role === 'mcp') p.push(['servers', '*']);
  return p;
}

export function describeServer(value: Json): { detail: string; extra: string; escalated: boolean } {
  if (!isObject(value)) return { detail: '?', extra: '', escalated: false };
  const url = value.url ?? value.serverUrl;
  if (typeof url === 'string') {
    const host = hostOf(url) ?? '?';
    const remote = !isLocalHost(host);
    return { detail: host, extra: remote ? t('mcp.esc.remote', { host }) : '', escalated: remote };
  }
  const { program, args } = commandParts(value.command, value.args);
  const esc = escalationOf(program, args);
  if (esc?.kind === 'download') return { detail: program ?? '?', extra: t('mcp.esc.download', { cmd: esc.cmd }), escalated: true };
  if (esc?.kind === 'shell') return { detail: program ?? '?', extra: t('mcp.esc.shell', { cmd: esc.cmd }), escalated: true };
  return { detail: program ?? '?', extra: '', escalated: false };
}

export const mcpRule: Rule = {
  id: 'mcp',
  doc(q: DocQuery): Finding[] {
    const out: Finding[] = [];
    if (q.after.value === undefined) return out;
    const seen = new Set<string>();
    for (const p of serverPatterns(q)) {
      for (const { path, value } of q.added(p)) {
        const id = JSON.stringify(path);
        if (seen.has(id) || (isObject(value) && (value.enabled === false || value.disabled === true))) continue;
        seen.add(id);
        const name = path[path.length - 1];
        const s = describeServer(value);
        out.push({ rule: 'mcp', level: 'high', reason: t('mcp.added', { name, detail: s.detail }) + s.extra, where: keyPath(path), escalated: s.escalated || undefined });
      }
      for (const { path, value, before } of q.changed(p)) {
        const id = JSON.stringify(path);
        if (seen.has(id) || !isObject(value)) continue;
        seen.add(id);
        const old = isObject(before) ? before : {};
        const name = path[path.length - 1];
        const fields = LAUNCH_FIELDS.filter((f) => !deepEqual(old[f], value[f]));
        const reEnabled = (old.enabled === false && value.enabled !== false) || (old.disabled === true && value.disabled !== true);
        if (reEnabled) {
          const s = describeServer(value);
          out.push({ rule: 'mcp', level: 'high', reason: t('mcp.added', { name, detail: s.detail }) + s.extra, where: keyPath(path), escalated: s.escalated || undefined });
        } else if (fields.length) {
          const s = describeServer(value);
          out.push({ rule: 'mcp', level: 'high', reason: t('mcp.changed', { name, field: fields.join(', ') }) + s.extra, where: keyPath(path), escalated: s.escalated || undefined });
        }
      }
    }
    return out;
  },
};
