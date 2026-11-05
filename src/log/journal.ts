// Change log: one JSON object per line in globalStorage/journal.jsonl (0600), local only.
// Summaries are built from rule reasons (names, hosts, command names) and then redacted again,
// in case a quoted rule or name happens to contain a credential.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Assessment, AgentId, Change, ChangeKind, RiskLevel, Scope, Target } from '../core/types';

export type JournalAction = 'baseline-created' | 'baselined' | 'detected' | 'auto-accepted' | 'accepted' | 'reverted';

export interface JournalEntry {
  ts: string;
  action: JournalAction;
  agent?: AgentId;
  scope?: Scope;
  /** Absolute path of the watched file or folder. */
  file?: string;
  change?: ChangeKind;
  level?: RiskLevel;
  rules?: string[];
  summary: string;
  /** Where the changed version was saved before a revert. */
  backup?: string;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@'], // URL user:password@
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]+)\?[^\s)"'`]*/gi, '$1?***'], // URL query strings
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, '$1-***'],
  [/\b(ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abpr])[-_][A-Za-z0-9_-]{8,}/g, '$1_***'],
  [/\bAKIA[0-9A-Z]{12,}/g, 'AKIA***'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, 'eyJ***'],
  [/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer ***'],
  [/\b(token|api[_-]?key|key|secret|password|passwd|pwd|auth)(\s*[=:]\s*)[^\s,;)"'`]+/gi, '$1$2***'],
];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((s, [re, rep]) => s.replace(re, rep), text);
}

export function summarize(assessment: Assessment): string {
  return redact(assessment.findings.map((f) => f.reason).join(' | '));
}

export function entryForChange(action: JournalAction, change: Pick<Change, 'target' | 'kind'>, assessment: Assessment | undefined, extra: Partial<JournalEntry> = {}, now = new Date()): JournalEntry {
  return {
    ts: now.toISOString(),
    action,
    agent: change.target.agent,
    scope: change.target.scope,
    file: change.target.path,
    change: change.kind,
    level: assessment?.level,
    rules: assessment ? [...new Set(assessment.findings.map((f) => f.rule))] : undefined,
    summary: assessment ? summarize(assessment) : '',
    ...extra,
  };
}

export function entryForTarget(action: JournalAction, target: Target, summary: string, extra: Partial<JournalEntry> = {}, now = new Date()): JournalEntry {
  return { ts: now.toISOString(), action, agent: target.agent, scope: target.scope, file: target.path, summary: redact(summary), ...extra };
}

export class Journal {
  constructor(readonly file: string) {}

  async append(entries: JournalEntry[]): Promise<void> {
    if (!entries.length) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    // One write per batch of complete lines, so concurrent windows never interleave inside a line.
    await fs.appendFile(this.file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
    await fs.chmod(this.file, 0o600).catch(() => undefined);
  }

  async readAll(): Promise<JournalEntry[]> {
    let text: string;
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: JournalEntry[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as JournalEntry);
      } catch {
        // A torn line (crash mid-write) is skipped rather than failing the export.
      }
    }
    return out;
  }

  /** Writes all valid entries to `dest` as JSONL. Returns the number of entries. */
  async exportTo(dest: string): Promise<number> {
    const entries = await this.readAll();
    await fs.writeFile(dest, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
    return entries.length;
  }
}
