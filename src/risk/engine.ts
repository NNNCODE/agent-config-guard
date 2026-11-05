// Runs every rule on a change and returns the findings and the overall level.
import * as path from 'node:path';
import { guessFormat } from '../agents';
import { collapseNested } from '../core/compare';
import type { Assessment, Change, DirSnapshot, Finding, FileSnapshot, Format, Target } from '../core/types';
import { maxLevel } from '../core/types';
import { t } from '../i18n';
import { makeDocQuery, type DirQuery, type DocQuery, type Rule } from './context';
import { changedPaths, listSome } from './diff';
import { findHookEvents } from './inspect';
import { isStructured, parseContent } from './parse';
import { commandsRule } from './rules/commands';
import { hooksRule } from './rules/hooks';
import { instructionsRule } from './rules/instructions';
import { mcpRule } from './rules/mcp';
import { permissionsRule } from './rules/permissions';
import { pluginsRule } from './rules/plugins';
import { preapprovalRule } from './rules/preapproval';

export const RULES: Rule[] = [hooksRule, preapprovalRule, pluginsRule, mcpRule, permissionsRule, commandsRule, instructionsRule];

export interface AssessIO {
  findHookEvents(dir: string): Promise<string[]>;
}

const defaultIO: AssessIO = { findHookEvents };

/** Format used to parse stored content: key-filtered files are stored as their JSON projection. */
function storedFormat(target: Target, snap: FileSnapshot): Format | undefined {
  if (target.keyFilter && !snap.unfiltered) return 'json';
  return target.format;
}

function runDocRules(q: DocQuery): Finding[] {
  return RULES.flatMap((r) => (r.doc ? r.doc(q) : []));
}

function assessFile(target: Target, kind: Change['kind'], before: FileSnapshot, after: FileSnapshot, file: string, inDir: boolean): Finding[] {
  if (before.tooLarge || after.tooLarge) return [{ rule: 'size', level: 'medium', reason: t('file.tooLarge'), where: file }];
  const beforeDoc = parseContent(before.exists ? before.content : undefined, storedFormat(target, before));
  const afterDoc = parseContent(after.exists ? after.content : undefined, storedFormat(target, after));
  const format = storedFormat(target, after.exists ? after : before) ?? 'text';
  if (after.exists && afterDoc.error) {
    return [{ rule: 'parse', level: 'medium', reason: t('parse.error', { error: afterDoc.error }), where: file }];
  }
  const q = makeDocQuery({ target, agent: target.agent, role: target.role, format, file, kind, inDir, before: beforeDoc, after: afterDoc });
  const findings = runDocRules(q);
  if (findings.length || inDir) return findings;
  // Nothing risky: one low finding that says what changed.
  if (kind === 'deleted') return [{ rule: 'other', level: 'low', reason: t('other.deleted'), where: file }];
  if (isStructured(format)) {
    const paths = changedPaths(beforeDoc.value, afterDoc.value);
    return [{ rule: 'other', level: 'low', reason: t('other.changed', { paths: listSome(paths) || '(root)' }), where: file }];
  }
  return [{ rule: 'other', level: 'low', reason: t('other.text'), where: file }];
}

async function assessDir(change: Change & { before: DirSnapshot; after: DirSnapshot }, io: AssessIO): Promise<Finding[]> {
  const { target } = change;
  const entries = change.entries ?? { added: [], removed: [], modified: [] };
  const newTop = collapseNested(entries.added);
  const pluginHooks = new Map<string, string[]>();
  if (target.role === 'plugin-dir') {
    for (const e of newTop) if (e.type === 'dir') pluginHooks.set(e.rel, await io.findHookEvents(path.join(target.path, ...e.rel.split('/'))));
  }
  const dq: DirQuery = { target, agent: target.agent, role: target.role, file: target.label, kind: change.kind, entries, newTop, pluginHooks };
  const findings = RULES.flatMap((r) => (r.dir ? r.dir(dq) : []));

  // Files inside the folder: run the document rules on each new or edited file whose content is stored.
  const touched = [...entries.added.filter((e) => e.type === 'file').map((e) => ({ e, kind: 'added' as const })), ...entries.modified.filter((m) => m.after.type === 'file').map((m) => ({ e: m.after, kind: 'modified' as const }))];
  for (const { e, kind } of touched) {
    const afterContent = change.after.contents[e.rel];
    if (afterContent === undefined) continue;
    const beforeContent = kind === 'modified' ? change.before.contents[e.rel] : undefined;
    const name = e.rel.split('/').pop() as string;
    const sub: Target = { ...target, kind: 'file', format: target.format ?? guessFormat(name), label: `${target.label}${e.rel}` };
    const before: FileSnapshot = { kind: 'file', exists: beforeContent !== undefined, content: beforeContent };
    const after: FileSnapshot = { kind: 'file', exists: true, content: afterContent };
    findings.push(...assessFile(sub, kind, before, after, sub.label, true));
  }

  if (findings.length) return findings;
  const rels = [...entries.added.map((e) => `+${e.rel}`), ...entries.removed.map((e) => `-${e.rel}`), ...entries.modified.map((m) => `~${m.after.rel}`)];
  return [{ rule: 'other', level: 'low', reason: t('other.entries', { paths: listSome(rels) || target.label }), where: target.label }];
}

export async function assess(change: Change, io: AssessIO = defaultIO): Promise<Assessment> {
  let findings: Finding[];
  if (change.before.kind === 'dir' && change.after.kind === 'dir') {
    findings = await assessDir(change as Change & { before: DirSnapshot; after: DirSnapshot }, io);
  } else {
    findings = assessFile(change.target, change.kind, change.before as FileSnapshot, change.after as FileSnapshot, change.target.label, false);
  }
  // Highest level first, escalated first within a level.
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level] || Number(!!b.escalated) - Number(!!a.escalated));
  return { level: maxLevel(findings.map((f) => f.level)), findings };
}
