import { mkdir, readFile, writeFile, rename, unlink, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { emptyState, type State } from './contract.js';

export class SharedStore {
  readonly directory: string;
  constructor(root: string, key: string) {
    this.directory = join(root, createHash('sha256').update(key).digest('hex'));
  }
  async read(): Promise<State> {
    try {
      const value = JSON.parse(await readFile(join(this.directory, 'state.json'), 'utf8'));
      if (value.version !== 1 || typeof value.state?.autoPaused !== 'boolean'
        || !Number.isFinite(value.state.nextAllowedAtMs) || !Number.isFinite(value.state.nextRefreshAtMs))
        throw new Error('cache_error');
      return value.state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
      throw new Error('cache_error');
    }
  }
  async write(state: State): Promise<void> {
    const target = join(this.directory, 'state.json');
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, state }), { mode: 0o600 });
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => {}); }
  }
  private async recover(): Promise<void> {
    const recovery = join(this.directory, 'recovery');
    try { await mkdir(recovery); } catch { return; }
    const lock = join(this.directory, 'lock');
    try {
      let dead = false;
      try {
        const owner = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return;
        try { process.kill(owner.pid, 0); }
        catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
      } catch {
        const info = await stat(lock).catch(() => null);
        dead = info !== null && Date.now() - info.mtimeMs > 30_000;
      }
      if (dead) {
        await unlink(join(lock, 'owner.json')).catch(() => {});
        await rmdir(lock).catch(() => {});
      }
    } finally { await rmdir(recovery).catch(() => {}); }
  }
  async locked<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = join(this.directory, 'lock');
    const deadline = performance.now() + 20_000;
    for (;;) {
      try { await mkdir(lock); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('cache_error');
        await this.recover();
        if (performance.now() >= deadline) throw new Error('busy');
        await sleep(50);
      }
    }
    try {
      await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }));
      return await operation();
    } finally {
      await unlink(join(lock, 'owner.json')).catch(() => {});
      await rmdir(lock).catch(() => {});
    }
  }
}
