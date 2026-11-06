// "No network, no telemetry": the shipped bundle must not load any networking or
// process-spawning module. npm test builds dist/extension.js before running this.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

const FORBIDDEN = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'child_process', 'worker_threads', 'cluster', 'inspector'];

test('bundled extension loads no network or process-spawning module', async () => {
  const bundle = await fs.readFile(path.resolve(__dirname, '..', '..', '..', 'dist', 'extension.js'), 'utf8');
  const required = new Set([...bundle.matchAll(/require\(\s*["'](?:node:)?([\w/]+)["']\s*\)/g)].map((m) => m[1]));
  for (const mod of FORBIDDEN) assert.ok(!required.has(mod), `bundle requires "${mod}"`);
  for (const api of ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'navigator.sendBeacon']) assert.ok(!bundle.includes(api), `bundle uses ${api}`);
  assert.ok(required.has('vscode') && required.has('fs'), `sanity: saw ${[...required].join(', ')}`);
});
