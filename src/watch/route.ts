// Pure helpers for the file watcher: which folders to watch, and which target an event belongs to.
import * as path from 'node:path';
import { pathKey } from '../paths';
import type { Target } from '../core/types';

export interface WatchSpec {
  /** Folder to watch (may not exist yet; VS Code picks it up once created). */
  base: string;
  /** Glob relative to base. Simple names = non-recursive; '**' = recursive. */
  pattern: string;
}

function api(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/**
 * One watcher per parent folder for file targets (names combined with {a,b}),
 * plus for each directory target: its parent (creation/deletion) and its contents.
 * Plugin folders and depth-1 folders are watched non-recursively; the poller covers deeper levels.
 */
export function watchPlan(targets: Target[], platform: NodeJS.Platform = process.platform): WatchSpec[] {
  const p = api(platform);
  const namesByParent = new Map<string, { base: string; names: Set<string> }>();
  const specs: WatchSpec[] = [];
  const addName = (parent: string, name: string) => {
    const k = pathKey(parent, platform);
    const entry = namesByParent.get(k) ?? { base: parent, names: new Set<string>() };
    entry.names.add(name);
    namesByParent.set(k, entry);
  };
  for (const t of targets) {
    addName(p.dirname(t.path), p.basename(t.path));
    if (t.kind === 'dir') {
      const recursive = (t.depth ?? 1) > 1 && t.storeContent !== false;
      specs.push({ base: t.path, pattern: recursive ? '**' : '*' });
    }
  }
  for (const { base, names } of namesByParent.values()) {
    const sorted = [...names].sort();
    specs.push({ base, pattern: sorted.length === 1 ? sorted[0] : `{${sorted.join(',')}}` });
  }
  const seen = new Set<string>();
  return specs.filter((s) => {
    const id = `${pathKey(s.base, platform)}|${s.pattern}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Maps an event path to the targets it affects. */
export class TargetRouter {
  private readonly byKey = new Map<string, Target>();
  private readonly dirs: Target[];

  constructor(targets: Target[], private readonly platform: NodeJS.Platform = process.platform) {
    for (const t of targets) this.byKey.set(t.key, t);
    this.dirs = targets.filter((t) => t.kind === 'dir');
  }

  route(fsPath: string): Target[] {
    const key = pathKey(fsPath, this.platform);
    const sep = api(this.platform).sep;
    const out: Target[] = [];
    const exact = this.byKey.get(key);
    if (exact) out.push(exact);
    for (const d of this.dirs) {
      if (d !== exact && key.startsWith(d.key + sep)) out.push(d);
    }
    return out;
  }
}
