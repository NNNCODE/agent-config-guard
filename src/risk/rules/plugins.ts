// High: plugin marketplaces and plugins added or enabled, new plugin folders, new plugin code.
import type { Json } from '../../core/keyfilter';
import type { Finding } from '../../core/types';
import { t } from '../../i18n';
import type { DirQuery, DocQuery, Rule } from '../context';
import { isObject, keyPath, sourceOf } from '../util';

function describeSource(value: Json | undefined): string | undefined {
  if (typeof value === 'string') return sourceOf(value);
  if (!isObject(value)) return undefined;
  const src = isObject(value.source) ? value.source : value;
  if (typeof src.repo === 'string') return `${typeof src.source === 'string' ? src.source : 'github'}:${src.repo}`;
  for (const k of ['url', 'source', 'path']) {
    if (typeof src[k] === 'string') return sourceOf(src[k]);
  }
  return undefined;
}

function marketplace(name: string, value: Json | undefined, where: string): Finding {
  const src = describeSource(value);
  return { rule: 'plugins', level: 'high', reason: t('plugins.marketplace', { name, source: src ? ` (${src})` : '' }), where };
}

function enabled(name: string, where: string): Finding {
  return { rule: 'plugins', level: 'high', reason: t('plugins.enabled', { name }), where };
}

function itemName(item: Json): string {
  if (typeof item === 'string') return item;
  if (Array.isArray(item) && typeof item[0] === 'string') return item[0];
  if (isObject(item)) return String(item.name ?? item.id ?? item.source ?? '?');
  return String(item);
}

export const pluginsRule: Rule = {
  id: 'plugins',
  doc(q: DocQuery): Finding[] {
    const out: Finding[] = [];
    if (q.after.value === undefined) return out;
    const isKnownMarketplaces = /known_marketplaces\.json$/i.test(q.target.path);

    // Marketplaces
    for (const p of [['extraKnownMarketplaces', '*'], ['additionalMarketplaces', '*'], ['marketplaces', '*']]) {
      for (const { path, value } of q.added(p)) out.push(marketplace(path[1], value, keyPath(path)));
    }
    if (isKnownMarketplaces) {
      for (const { path, value } of q.added(['*'])) out.push(marketplace(path[0], value, keyPath(path)));
    }
    for (const { path, item } of q.arrayItemsAdded(['chat.plugins.marketplaces'])) out.push(marketplace(itemName(item), item, keyPath(path)));

    // Enabled / installed plugins
    for (const p of [['enabledPlugins'], ['chat.plugins.enabledPlugins']]) {
      for (const { path, value, before } of q.addedOrChanged([...p, '*'])) {
        if (value !== false && before !== true && !Array.isArray(value)) out.push(enabled(path[path.length - 1], keyPath(path)));
      }
      for (const { path, item } of q.arrayItemsAdded(p)) out.push(enabled(itemName(item), keyPath(path)));
    }
    if (q.role === 'plugins' || q.agent === 'codex') {
      // Claude installed_plugins.json ({plugins: {name: [...]}}) and Codex [plugins."p@m"] enabled = true.
      for (const { path, value } of q.added(['plugins', '*'])) {
        if (!(isObject(value) && value.enabled === false)) out.push(enabled(path[1], keyPath(path)));
      }
      for (const { path, value, before } of q.changed(['plugins', '*'])) {
        if (isObject(before) && before.enabled === false && isObject(value) && value.enabled !== false) out.push(enabled(path[1], keyPath(path)));
      }
      // Codex marketplace definition files ({plugins: [...]}).
      for (const { item } of q.arrayItemsAdded(['plugins'])) out.push(enabled(itemName(item), 'plugins'));
    }
    if (q.agent === 'opencode') {
      for (const { path, item } of q.arrayItemsAdded(['plugin'])) {
        out.push({ rule: 'plugins', level: 'high', reason: t('plugins.npm', { name: itemName(item) }), where: keyPath(path) });
      }
    }
    for (const key of ['chat.pluginLocations', 'chat.plugins.enabled']) {
      for (const { path, value } of q.addedOrChanged([key])) {
        if (value === false) continue;
        out.push({ rule: 'plugins', level: 'high', reason: t('plugins.setting', { key }), where: keyPath(path) });
      }
    }
    return out;
  },

  dir(q: DirQuery): Finding[] {
    const out: Finding[] = [];
    if (q.role === 'plugin-dir') {
      for (const top of q.newTop) {
        if (top.type !== 'dir') continue;
        const nested = q.entries.added.filter((e) => e.type === 'dir' && e.rel.startsWith(`${top.rel}/`)).map((e) => e.rel);
        const name = nested.length ? nested.join(', ') : top.rel;
        const events = q.pluginHooks.get(top.rel) ?? [];
        out.push({
          rule: 'plugins',
          level: 'high',
          reason: events.length ? t('plugins.folderHooks', { name, events: events.join(', ') }) : t('plugins.folder', { name }),
          where: top.rel,
        });
      }
    }
    if (q.role === 'code-dir') {
      const touched = [...q.entries.added, ...q.entries.modified.map((m) => m.after)].filter((e) => e.type !== 'dir');
      for (const e of touched) out.push({ rule: 'plugins', level: 'high', reason: t('plugins.code', { name: e.rel }), where: e.rel });
    }
    return out;
  },
};
