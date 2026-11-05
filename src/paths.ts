// Resolves the registry's roots to absolute directories for the current OS and environment.
// Pure: everything comes in through ResolveContext, so tests can simulate any platform.
import * as path from 'node:path';
import type { RootId, Target, TargetSpec } from './core/types';

export interface ResolveContext {
  platform: NodeJS.Platform;
  home: string;
  env: Record<string, string | undefined>;
  workspaceFolders: string[];
  /** Names of sub-directories of a directory; [] if it does not exist. */
  listSubdirs(dir: string): string[];
}

function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Normalised key for de-duplication and the baseline index. Windows paths are case-insensitive. */
export function pathKey(p: string, platform: NodeJS.Platform): string {
  const normalised = pathApi(platform).normalize(p);
  return platform === 'win32' ? normalised.toLowerCase() : normalised;
}

function nonEmpty(v: string | undefined): string | undefined {
  return v && v.trim() ? v.trim() : undefined;
}

/** VS Code user directories (stable + Insiders), plus every profile directory under each. */
function vscodeUserDirs(ctx: ResolveContext): string[] {
  const p = pathApi(ctx.platform);
  const products = ['Code', 'Code - Insiders'];
  let base: string;
  if (ctx.platform === 'win32') {
    base = nonEmpty(ctx.env.APPDATA) ?? p.join(ctx.home, 'AppData', 'Roaming');
  } else if (ctx.platform === 'darwin') {
    base = p.join(ctx.home, 'Library', 'Application Support');
  } else {
    base = nonEmpty(ctx.env.XDG_CONFIG_HOME) ?? p.join(ctx.home, '.config');
  }
  const dirs: string[] = [];
  for (const product of products) {
    const user = p.join(base, product, 'User');
    dirs.push(user);
    const profilesDir = p.join(user, 'profiles');
    for (const id of ctx.listSubdirs(profilesDir)) dirs.push(p.join(profilesDir, id));
  }
  return dirs;
}

/**
 * Every directory a root can live in. Default locations are always included, even when an
 * environment variable points elsewhere: a third-party installer may write to the default.
 */
export function resolveRoot(root: RootId, ctx: ResolveContext): string[] {
  const p = pathApi(ctx.platform);
  const env = ctx.env;
  const out: string[] = [];
  const add = (dir: string | undefined) => {
    if (dir) out.push(dir);
  };
  switch (root) {
    case 'home':
      add(ctx.home);
      break;
    case 'claudeHome':
      add(p.join(ctx.home, '.claude'));
      add(nonEmpty(env.CLAUDE_CONFIG_DIR));
      break;
    case 'claudeJsonDir':
      // ~/.claude.json lives in home; CLAUDE_CONFIG_DIR moves it inside that directory.
      add(ctx.home);
      add(nonEmpty(env.CLAUDE_CONFIG_DIR));
      break;
    case 'codexHome':
      add(p.join(ctx.home, '.codex'));
      add(nonEmpty(env.CODEX_HOME));
      break;
    case 'agentsHome':
      add(p.join(ctx.home, '.agents'));
      break;
    case 'cursorHome':
      add(p.join(ctx.home, '.cursor'));
      break;
    case 'cursorCli':
      add(p.join(ctx.home, '.cursor'));
      add(nonEmpty(env.CURSOR_CONFIG_DIR));
      if (ctx.platform === 'linux' && nonEmpty(env.XDG_CONFIG_HOME)) {
        add(p.join(env.XDG_CONFIG_HOME as string, 'cursor'));
      }
      break;
    case 'copilotHome':
      add(p.join(ctx.home, '.copilot'));
      add(nonEmpty(env.COPILOT_HOME));
      break;
    case 'opencodeConfig':
      // OpenCode uses $XDG_CONFIG_HOME/opencode, else ~/.config/opencode on every OS (Windows included).
      add(p.join(ctx.home, '.config', 'opencode'));
      if (nonEmpty(env.XDG_CONFIG_HOME)) add(p.join(env.XDG_CONFIG_HOME as string, 'opencode'));
      add(nonEmpty(env.OPENCODE_CONFIG_DIR));
      break;
    case 'vscodeUser':
      out.push(...vscodeUserDirs(ctx));
      break;
    case 'workspace':
      out.push(...ctx.workspaceFolders);
      break;
  }
  return out;
}

/** Extra targets that do not fit root + rel, e.g. OPENCODE_CONFIG pointing at a single file. */
function extraPaths(spec: TargetSpec, ctx: ResolveContext): string[] {
  if (spec.id === 'opencode.config.json') {
    const file = nonEmpty(ctx.env.OPENCODE_CONFIG);
    if (file) return [file];
  }
  return [];
}

/** Resolves registry entries to absolute targets, de-duplicated by path. */
export function resolveTargets(specs: TargetSpec[], ctx: ResolveContext): Target[] {
  const p = pathApi(ctx.platform);
  const seen = new Set<string>();
  const targets: Target[] = [];
  for (const spec of specs) {
    const relParts = spec.rel.split('/');
    const candidates = resolveRoot(spec.root, ctx).map((dir) => p.join(dir, ...relParts));
    candidates.push(...extraPaths(spec, ctx));
    for (const candidate of candidates) {
      const abs = p.normalize(candidate);
      const key = pathKey(abs, ctx.platform);
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ ...spec, path: abs, key });
    }
  }
  return targets;
}
