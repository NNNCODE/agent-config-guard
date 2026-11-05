// Small helpers shared by the rules. Everything returned here is safe to show and log:
// command names, hosts and key names only, never full command lines or values.
import type { Json } from '../core/keyfilter';

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]));
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function isObject(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Splits a command line into tokens, honouring simple quotes. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Program name only ("C:\\x\\npx.cmd -y pkg" → "npx"). */
export function programName(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const base = token.split(/[\\/]/).pop() ?? token;
  return base.replace(/\.(exe|cmd|bat|ps1|sh)$/i, '');
}

/** Program and its arguments from the usual shapes: "cmd args", ["cmd", ...], or {command, args}. */
export function commandParts(command: unknown, args?: unknown): { program?: string; args: string[] } {
  let tokens: string[] = [];
  if (typeof command === 'string') tokens = tokenize(command);
  else if (Array.isArray(command)) tokens = command.filter((x): x is string => typeof x === 'string');
  const extra = Array.isArray(args) ? args.filter((x): x is string => typeof x === 'string') : [];
  return { program: programName(tokens[0]), args: [...tokens.slice(1), ...extra] };
}

/** Command name of a setting value that can be a string, an array or {command: ...}. */
export function commandNameOf(value: unknown): string | undefined {
  if (isObject(value)) return commandParts(value.command, value.args).program;
  return commandParts(value).program;
}

export function hostOf(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url).host || undefined;
  } catch {
    return undefined;
  }
}

/** host + path without credentials or query ("https://u:t@github.com/o/r.git?x" → "github.com/o/r.git"). */
export function sourceOf(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url.includes('://') ? undefined : url.slice(0, 80);
  }
}

export function isLocalHost(host: string | undefined): boolean {
  if (!host) return true;
  const h = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || h === '0.0.0.0' || /^127\./.test(h);
}

const DOWNLOAD_RUNNERS = new Set(['npx', 'uvx', 'bunx', 'pnpx']);
const DLX_TOOLS = new Set(['pnpm', 'yarn', 'bun', 'npm']);
const FETCHERS = new Set(['curl', 'wget']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'fish', 'pwsh', 'powershell', 'cmd']);
const INLINE_FLAGS = new Set(['-c', '/c', '/k', '-command', '-encodedcommand', '-e', '-ec']);

export type Escalation = { kind: 'download' | 'shell'; cmd: string } | undefined;

/** Why a launch command deserves extra weight: it fetches code or runs an inline shell line. */
export function escalationOf(program: string | undefined, args: string[]): Escalation {
  if (!program) return undefined;
  const p = program.toLowerCase();
  if (DOWNLOAD_RUNNERS.has(p)) return { kind: 'download', cmd: p };
  if (DLX_TOOLS.has(p) && (args[0] === 'dlx' || args[0] === 'x' || args[0] === 'exec')) return { kind: 'download', cmd: `${p} ${args[0]}` };
  if (FETCHERS.has(p)) return { kind: 'shell', cmd: p };
  if (SHELLS.has(p) && args.some((a) => INLINE_FLAGS.has(a.toLowerCase()))) return { kind: 'shell', cmd: `${p} ${args.find((a) => INLINE_FLAGS.has(a.toLowerCase()))}` };
  return undefined;
}

/** "session_start" → "SessionStart"; camelCase and PascalCase names are kept as written. */
export function prettyEvent(raw: string): string {
  if (!raw.includes('_')) return raw;
  return raw
    .split('_')
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join('');
}

/** Events that fire on their own when a session or workspace starts. */
export function isStartupEvent(raw: string): boolean {
  return /^(session_?start|setup|workspace_?open)$/i.test(raw);
}

export function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

export function keyPath(path: string[]): string {
  return path.map((p) => (/^[\w-]+$/.test(p) ? p : JSON.stringify(p))).join('.');
}
