// Looks inside a newly appeared plugin folder for hook definitions, so the alert can say
// "brings its own SessionStart hook" (Postman's hook lives in the plugin cache, not in config.toml).
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parseJsonc } from '../core/scan';
import { isObject, prettyEvent } from './util';

const MAX_FILES = 300;
const MAX_DEPTH = 4;
const HOOK_FILE = /hooks[^\\/]*\.json$/i;

export async function findHookEvents(dir: string): Promise<string[]> {
  const events = new Set<string>();
  let visited = 0;
  const walk = async (d: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || visited > MAX_FILES) return;
    let dirents;
    try {
      dirents = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of dirents) {
      if (++visited > MAX_FILES) return;
      const p = path.join(d, e.name);
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git') await walk(p, depth + 1);
      else if (e.isFile() && HOOK_FILE.test(e.name)) {
        const text = await fs.readFile(p, 'utf8').catch(() => '');
        const { value } = parseJsonc(text);
        const hooks = isObject(value) && isObject(value.hooks) ? value.hooks : isObject(value) ? value : {};
        for (const k of Object.keys(hooks)) if (!['version', '$schema', 'description'].includes(k)) events.add(prettyEvent(k));
      }
    }
  };
  await walk(dir, 1);
  return [...events].sort();
}
