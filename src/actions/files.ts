// File helpers for accept/revert: timestamped backups, in-place writes with retry, moves.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** 20261106-153012 (local time). */
export function timestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** First free name among base, base-1, base-2, ... */
export async function freeName(base: string): Promise<string> {
  if (!(await exists(base))) return base;
  for (let i = 1; ; i++) if (!(await exists(`${base}-${i}`))) return `${base}-${i}`;
}

/** Copies a file to "<file>.bak-<timestamp>" next to it. Returns the backup path. */
export async function backupNextTo(file: string, now = new Date()): Promise<string> {
  const target = await freeName(`${file}.bak-${timestamp(now)}`);
  await fs.copyFile(file, target);
  return target;
}

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt < 5 && (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')) {
        await new Promise((r) => setTimeout(r, 60 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

/** Writes in place (keeps the file's mode and identity), creating parent folders if needed. */
export async function writeInPlace(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await retry(() => fs.writeFile(file, content));
}

export async function removeFile(file: string): Promise<void> {
  await retry(() => fs.rm(file, { force: true }));
}

/** Moves a file or folder, falling back to copy + delete across drives. */
export async function move(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true, mode: 0o700 });
  try {
    await retry(() => fs.rename(from, to));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }
}
