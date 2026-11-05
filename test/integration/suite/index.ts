// Minimal runner called by the Extension Development Host: runs each test in order and
// throws if any failed (no mocha needed for a handful of tests).
import { tests } from './revert.test';

export async function run(): Promise<void> {
  let failed = 0;
  for (const [name, fn] of tests) {
    const started = Date.now();
    try {
      await fn();
      console.log(`  ✔ ${name} (${Date.now() - started} ms)`);
    } catch (err) {
      failed++;
      console.error(`  ✖ ${name}\n${(err as Error).stack ?? err}`);
    }
  }
  console.log(`${tests.length - failed} passing, ${failed} failing`);
  if (failed) throw new Error(`${failed} integration test(s) failed`);
}
