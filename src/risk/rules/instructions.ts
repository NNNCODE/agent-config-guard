// Medium: new content in instruction files (flagged when it contains "always do X first" wording),
// new skills / agents / commands, changed instruction locations.
import type { Finding } from '../../core/types';
import { t, type MessageKey } from '../../i18n';
import type { DirQuery, DocQuery, Rule } from '../context';
import { isStructured } from '../parse';
import { hostOf, keyPath, truncate } from '../util';

/** Wording that makes an instruction apply to every task, or overrides other instructions. */
export const COERCIVE: RegExp[] = [
  /\bbefore (responding|answering|replying|doing|starting|working|handling|acting)\b.{0,20}\b(any|every|each|all)\b/i,
  /\b(always|must always|you must)\s+(first\s+)?(load|use|run|call|invoke|read|execute|follow|consult)\b/i,
  /\bload the\s+[`'"]?[\w:./-]+[`'"]?\s+skill\b/i,
  /\b(ignore|disregard|override)\s+(all\s+|any\s+)?(previous|prior|above|other|earlier)\s+(instructions|rules|guidelines)\b/i,
  /\b(at the start of|at the beginning of)\s+(every|each|any)\s+(session|task|conversation|request)\b/i,
  /(任何|所有|每个|每一个|每次).{0,12}(任务|请求|对话|回答|回复|操作|会话).{0,6}(之前|以前)/,
  /(总是|始终|一律|务必|必须)(先)?(加载|调用|使用|运行|执行|读取|遵循)/,
  /忽略(之前|以上|前面|其他|其它)的?(所有)?(指令|规则|说明)/,
];

export function findCoercive(lines: string[]): string | undefined {
  for (const line of lines) if (COERCIVE.some((re) => re.test(line))) return truncate(line, 80);
  return undefined;
}

const TEXT_ROLES = new Set(['instructions', 'skills', 'agents', 'commands']);
const LOCATION_KEYS = ['chat.instructionsFilesLocations', 'chat.agentFilesLocations', 'chat.agentSkillsLocations', 'chat.promptFilesLocations', 'chat.modeFilesLocations'];
const KIND_BY_ROLE: Record<string, MessageKey> = { skills: 'kind.skill', agents: 'kind.agent', commands: 'kind.command', instructions: 'kind.rule' };

export const instructionsRule: Rule = {
  id: 'instructions',
  doc(q: DocQuery): Finding[] {
    const out: Finding[] = [];
    if (TEXT_ROLES.has(q.role) && !isStructured(q.format)) {
      const lines = q.addedLines();
      if (!lines.length) return out;
      const snippet = findCoercive(lines);
      if (snippet) {
        out.push({ rule: 'instructions', level: 'medium', reason: t('instr.coercive', { file: q.file, snippet }), where: q.file, escalated: true });
      } else if (!(q.inDir && q.kind === 'added')) {
        // A brand-new file inside a folder is already reported as a new skill/agent/command.
        out.push({ rule: 'instructions', level: 'medium', reason: t('instr.added', { file: q.file, count: lines.length }), where: q.file });
      }
      return out;
    }
    if (q.after.value === undefined) return out;
    for (const key of LOCATION_KEYS) {
      for (const { path } of q.addedOrChanged([key])) out.push({ rule: 'instructions', level: 'medium', reason: t('instr.location', { key }), where: keyPath(path) });
    }
    if (q.agent === 'opencode') {
      for (const { path, item } of q.arrayItemsAdded(['instructions'])) {
        const host = /^https?:\/\//i.test(String(item)) ? hostOf(item) : undefined;
        out.push(
          host
            ? { rule: 'instructions', level: 'medium', reason: t('instr.remote', { host }), where: keyPath(path), escalated: true }
            : { rule: 'instructions', level: 'medium', reason: t('instr.location', { key: String(item) }), where: keyPath(path) },
        );
      }
    }
    return out;
  },

  dir(q: DirQuery): Finding[] {
    const kindKey = KIND_BY_ROLE[q.role];
    if (!kindKey) return [];
    return q.newTop.map((e) => ({ rule: 'instructions', level: 'medium' as const, reason: t('instr.newEntry', { kind: t(kindKey), name: e.rel }), where: e.rel }));
  },
};
