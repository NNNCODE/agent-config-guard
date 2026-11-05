import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Fresh temp directory; removed when the returned cleanup runs. */
export async function tempDir(prefix = 'acg-'): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

/** Absolute path of a file under test/fixtures (tests run from out/test/unit). */
export function fixture(...parts: string[]): string {
  return path.resolve(__dirname, '..', '..', '..', 'test', 'fixtures', ...parts);
}

export async function readFixture(...parts: string[]): Promise<string> {
  return fs.readFile(fixture(...parts), 'utf8');
}

export async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}
