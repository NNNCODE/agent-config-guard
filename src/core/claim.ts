// "Only one window announces a change": the first window to create the claim file wins.
// Claims are released when the change is resolved, so the same change coming back later
// (e.g. an installer re-applying itself after a revert) is announced again.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { sha256 } from './scan';

export function claimId(key: string, afterHash: string | undefined): string {
  return sha256(`${key}\n${afterHash ?? 'deleted'}`).slice(0, 32);
}

/** True if this call created the claim (this window should announce and log the change). */
export async function claimOnce(dir: string, id: string): Promise<boolean> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    const handle = await fs.open(path.join(dir, id), 'wx', 0o600);
    await handle.close();
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

export async function releaseClaim(dir: string, id: string): Promise<void> {
  await fs.rm(path.join(dir, id), { force: true });
}

/** Removes claims older than maxAgeMs (left behind by windows that closed with changes pending). */
export async function pruneClaims(dir: string, maxAgeMs: number, now = Date.now()): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    const st = await fs.stat(file).catch(() => undefined);
    if (st && now - st.mtimeMs > maxAgeMs) await fs.rm(file, { force: true });
  }
}
