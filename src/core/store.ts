// Baseline storage under the extension's globalStorage directory.
//   <dir>/index.json        one record per watched path (hash, existence, directory listing)
//   <dir>/blobs/<sha256>    stored content, addressed by hash
// Contents may contain secrets: directories are 0700, files 0600, nothing leaves the machine.
// On Windows chmod only toggles the read-only flag; protection there is the per-user ACL of %APPDATA%.
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { DirEntry, Snapshot, Target } from './types';

export interface BaselineRecord {
  id: string;
  path: string;
  kind: 'file' | 'dir';
  exists: boolean;
  hash?: string;
  size?: number;
  tooLarge?: boolean;
  unfiltered?: boolean;
  /** Directory targets: the listing. Contents of stored files are blobs named by entry hash. */
  entries?: DirEntry[];
  truncated?: boolean;
  updatedAt: string;
}

export interface BaselineIndex {
  version: 1;
  createdAt: string;
  updatedAt: string;
  records: Record<string, BaselineRecord>;
}

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const LOCK_STALE_MS = 10_000;
const LOCK_TIMEOUT_MS = 8_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Writes via a temp file + rename so readers never see a half-written file. Retries on Windows sharing errors. */
export async function writeFileAtomic(file: string, data: string | Buffer, mode = FILE_MODE): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: DIR_MODE });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  await fs.writeFile(tmp, data, { mode });
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt < 5 && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
        await sleep(50 * (attempt + 1));
        continue;
      }
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }
  await fs.chmod(file, mode).catch(() => undefined);
}

/** Cross-process lock using exclusive file creation. Stale locks (crashed window) expire. */
export async function withLock<T>(lockFile: string, fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(path.dirname(lockFile), { recursive: true, mode: DIR_MODE });
  const started = Date.now();
  for (;;) {
    try {
      const handle = await fs.open(lockFile, 'wx', FILE_MODE);
      await handle.writeFile(String(process.pid));
      await handle.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const st = await fs.stat(lockFile).catch(() => undefined);
      if (st && Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        await fs.rm(lockFile, { force: true });
        continue;
      }
      if (Date.now() - started > LOCK_TIMEOUT_MS) throw new Error(`Timed out waiting for lock ${lockFile}`);
      await sleep(40);
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lockFile, { force: true });
  }
}

export function toRecord(target: Pick<Target, 'id' | 'path'>, snap: Snapshot, now = new Date()): BaselineRecord {
  const base = { id: target.id, path: target.path, kind: snap.kind, exists: snap.exists, hash: snap.hash, updatedAt: now.toISOString() };
  if (snap.kind === 'file') {
    return { ...base, size: snap.size, tooLarge: snap.tooLarge, unfiltered: snap.unfiltered };
  }
  return { ...base, entries: snap.entries, truncated: snap.truncated };
}

export class BaselineStore {
  private cache: BaselineIndex | undefined;
  readonly indexFile: string;
  readonly blobDir: string;
  readonly lockFile: string;

  constructor(readonly dir: string) {
    this.indexFile = path.join(dir, 'index.json');
    this.blobDir = path.join(dir, 'blobs');
    this.lockFile = path.join(dir, '.lock');
  }

  /** Reads the index from disk (other windows may have changed it). Undefined = no baseline yet. */
  async load(): Promise<BaselineIndex | undefined> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.indexFile, 'utf8')) as BaselineIndex;
      this.cache = parsed.version === 1 ? parsed : undefined;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.cache = undefined;
    }
    return this.cache;
  }

  get index(): BaselineIndex | undefined {
    return this.cache;
  }

  record(key: string): BaselineRecord | undefined {
    return this.cache?.records[key];
  }

  async writeBlob(hash: string, content: string): Promise<void> {
    const file = path.join(this.blobDir, hash);
    try {
      await fs.access(file);
      return; // content-addressed: already stored
    } catch {
      await writeFileAtomic(file, content);
    }
  }

  async readBlob(hash: string): Promise<string | undefined> {
    try {
      return await fs.readFile(path.join(this.blobDir, hash), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  private async writeSnapshotBlobs(snap: Snapshot): Promise<void> {
    if (snap.kind === 'file') {
      if (snap.exists && snap.hash && snap.content !== undefined) await this.writeBlob(snap.hash, snap.content);
      return;
    }
    for (const entry of snap.entries) {
      const content = snap.contents[entry.rel];
      if (entry.type === 'file' && entry.hash && content !== undefined) await this.writeBlob(entry.hash, content);
    }
  }

  /**
   * Stores snapshots as the new baseline for their targets. With `replaceAll`, records of
   * targets not in `items` are dropped (used when the user (re)creates the baseline).
   */
  async put(items: Array<{ target: Target; snapshot: Snapshot }>, opts: { replaceAll?: boolean } = {}): Promise<BaselineIndex> {
    return withLock(this.lockFile, async () => {
      // Blobs are written under the lock so another window's GC cannot delete them before the index refers to them.
      for (const { snapshot } of items) await this.writeSnapshotBlobs(snapshot);
      const now = new Date();
      const current = opts.replaceAll ? undefined : await this.load();
      const index: BaselineIndex = current ?? { version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(), records: {} };
      for (const { target, snapshot } of items) index.records[target.key] = toRecord(target, snapshot, now);
      index.updatedAt = now.toISOString();
      await writeFileAtomic(this.indexFile, JSON.stringify(index, null, 2));
      this.cache = index;
      await this.gcLocked(index);
      return index;
    });
  }

  /** Rebuilds a snapshot from a record and its blobs. Content is absent where it was not stored. */
  async snapshotOf(record: BaselineRecord): Promise<Snapshot> {
    if (record.kind === 'file') {
      const content = record.exists && record.hash && !record.tooLarge ? await this.readBlob(record.hash) : undefined;
      return { kind: 'file', exists: record.exists, hash: record.hash, size: record.size, tooLarge: record.tooLarge, unfiltered: record.unfiltered, content };
    }
    const contents: Record<string, string> = {};
    for (const entry of record.entries ?? []) {
      if (entry.type !== 'file' || !entry.hash) continue;
      const content = await this.readBlob(entry.hash);
      if (content !== undefined) contents[entry.rel] = content;
    }
    return { kind: 'dir', exists: record.exists, hash: record.hash, entries: record.entries ?? [], contents, truncated: record.truncated };
  }

  /** Deletes blobs no record refers to, so stale copies of (possibly secret) content do not linger. */
  private async gcLocked(index: BaselineIndex): Promise<void> {
    const referenced = new Set<string>();
    for (const rec of Object.values(index.records)) {
      if (rec.hash) referenced.add(rec.hash);
      for (const e of rec.entries ?? []) if (e.hash) referenced.add(e.hash);
    }
    let names: string[];
    try {
      names = await fs.readdir(this.blobDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!referenced.has(name) && !name.includes('.tmp-')) await fs.rm(path.join(this.blobDir, name), { force: true });
    }
  }
}
