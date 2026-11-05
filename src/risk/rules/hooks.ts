// High: hooks added or changed. Startup events are named explicitly because they run unasked.
import type { Finding } from '../../core/types';
import { t } from '../../i18n';
import type { DocQuery, Rule } from '../context';
import { isObject, isStartupEvent, keyPath, prettyEvent } from '../util';

/** Any key under `hooks` except Codex's `hooks.state` (trust records, handled by preapproval). */
const EVENT_KEY = /^(?!state$)/;
/** For hook files that list events at the top level instead of under `hooks`. */
const TOP_LEVEL_EVENT = /^(?!version$|\$schema$|disableAllHooks$|hooks$)/;

const ENABLE_SWITCHES: Array<string[]> = [['features', 'hooks'], ['features', 'codex_hooks'], ['chat.useHooks'], ['chat.useClaudeHooks']];
const BLOCK_SWITCHES: Array<string[]> = [['disableAllHooks'], ['allowManagedHooksOnly']];

function hookFinding(rawEvent: string, where: string): Finding {
  const event = prettyEvent(rawEvent);
  return { rule: 'hooks', level: 'high', reason: t(isStartupEvent(rawEvent) ? 'hooks.startup' : 'hooks.event', { event }), where };
}

export const hooksRule: Rule = {
  id: 'hooks',
  doc(q: DocQuery): Finding[] {
    const out: Finding[] = [];
    if (q.after.value === undefined) return out;
    if (q.role === 'settings' || q.role === 'hooks') {
      for (const { path } of q.addedOrChanged(['hooks', EVENT_KEY])) out.push(hookFinding(path[1], keyPath(path)));
      if (q.role === 'hooks' && !(isObject(q.after.value) && 'hooks' in q.after.value)) {
        for (const { path } of q.addedOrChanged([TOP_LEVEL_EVENT])) out.push(hookFinding(path[0], keyPath(path)));
      }
    }
    for (const sw of ENABLE_SWITCHES) {
      for (const { path, value, before } of q.addedOrChanged(sw)) {
        if (value === true && before !== true) out.push({ rule: 'hooks', level: 'high', reason: t('hooks.enabled', { key: keyPath(path) }), where: keyPath(path) });
      }
    }
    for (const sw of BLOCK_SWITCHES) {
      const unblocked = [...q.changed(sw).filter((c) => c.before === true && c.value !== true), ...q.removed(sw).filter((r) => r.value === true)];
      for (const { path } of unblocked) out.push({ rule: 'hooks', level: 'high', reason: t('hooks.unblocked', { key: keyPath(path) }), where: keyPath(path) });
    }
    for (const { path } of q.addedOrChanged(['chat.hookFilesLocations'])) {
      out.push({ rule: 'hooks', level: 'high', reason: t('hooks.location', { key: keyPath(path) }), where: keyPath(path) });
    }
    return out;
  },
};
