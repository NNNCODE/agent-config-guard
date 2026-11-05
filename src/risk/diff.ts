// Generic key-path diff, used for the low-risk fallback ("other changes: model, tui.theme").
import type { Json } from '../core/keyfilter';
import { deepEqual, isObject, keyPath } from './util';

/** Key paths whose values differ, descending at most `maxDepth` levels into objects. */
export function changedPaths(before: Json | undefined, after: Json | undefined, maxDepth = 3): string[] {
  const out: string[] = [];
  const walk = (a: Json | undefined, b: Json | undefined, path: string[]) => {
    if (deepEqual(a, b)) return;
    if (path.length < maxDepth && isObject(a) && isObject(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], [...path, k]);
      return;
    }
    out.push(path.length ? keyPath(path) : '(root)');
  };
  walk(before, after, []);
  return out;
}

export function listSome(items: string[], max = 3): string {
  return items.length > max ? `${items.slice(0, max).join(', ')} (+${items.length - max})` : items.join(', ');
}
