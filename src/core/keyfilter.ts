// Projection of a JSON document onto a set of key patterns.
// Used for files the agent rewrites constantly (~/.claude.json, VS Code settings.json):
// only the matching subtrees are baselined, compared and reverted.
import type { KeyPattern } from './types';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isObject(v: unknown): v is { [key: string]: Json } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function segmentMatches(segment: string | RegExp, key: string): boolean {
  if (segment === '*') return true;
  if (segment instanceof RegExp) return segment.test(key);
  return segment === key;
}

/** Every concrete key path in `doc` that one of `patterns` matches, with its value. */
export function matchPaths(doc: Json, patterns: KeyPattern[]): Array<{ path: string[]; value: Json }> {
  const out: Array<{ path: string[]; value: Json }> = [];
  const seen = new Set<string>();
  const walk = (node: Json, pattern: KeyPattern, depth: number, prefix: string[]) => {
    if (depth === pattern.length) {
      const id = JSON.stringify(prefix);
      if (!seen.has(id)) {
        seen.add(id);
        out.push({ path: prefix, value: node });
      }
      return;
    }
    if (!isObject(node)) return;
    for (const key of Object.keys(node)) {
      if (segmentMatches(pattern[depth], key)) walk(node[key], pattern, depth + 1, [...prefix, key]);
    }
  };
  for (const pattern of patterns) walk(doc, pattern, 0, []);
  return out;
}

/** Builds a new object that contains only the matching subtrees, keys sorted for stable output. */
export function project(doc: Json, patterns: KeyPattern[]): { [key: string]: Json } {
  const result: { [key: string]: Json } = {};
  for (const { path, value } of matchPaths(doc, patterns)) {
    let node = result;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (!isObject(node[key])) node[key] = {};
      node = node[key] as { [key: string]: Json };
    }
    node[path[path.length - 1]] = value;
  }
  return sortKeys(result) as { [key: string]: Json };
}

export function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isObject(value)) {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

/** Stable text form of a projection; this is what gets hashed, stored and shown in the diff. */
export function projectionText(doc: Json, patterns: KeyPattern[]): string {
  return JSON.stringify(project(doc, patterns), null, 2) + '\n';
}
