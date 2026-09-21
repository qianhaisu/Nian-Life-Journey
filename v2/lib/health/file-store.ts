// File-backed ledger store: a directory holding ledger.json. Every mutation is one transaction:
//   acquire owned lock -> read latest -> pure update -> write temp (fsync) -> verify still owner -> rename -> release.
//
// Lock rules (this is the local, isolated stand-in for a database transaction; it says nothing about Postgres):
//  - The lock directory holds owner.json {token,pid,host}. A live holder is NEVER taken over because it is slow:
//    a lock is reclaimed only when its owner process is provably dead on this host (or, when the owner is
//    unreadable / on another host, when the lock is older than staleLockMs).
//  - Reclaim and release are ownership-checked: a slow or resumed old holder cannot delete a newer lock, and
//    just before the commit rename the holder re-verifies it still owns the lock; if not, it aborts without writing.
//  - Orphan temp files of a dead writer are removed once the next writer holds the lock.
// Survives: exception/abort before rename, process kill at any point (ledger.json is only ever replaced by rename).
// Not claimed: power-loss durability beyond best-effort fsync of the file and its directory; PID reuse after a crash.
import { mkdir, open, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { emptyLedger, type Ledger } from "./model";

export interface StoreOptions {
  lockTimeoutMs?: number;
  staleLockMs?: number;
  failBeforeRename?: boolean; // test hook: abort after the temp file is written
  beforeCommit?: () => Promise<void>; // test hook: run while holding the lock, after the update, before the rename
  afterAcquire?: () => Promise<void>; // test hook: run right after the lock is taken
}
interface Owner { token: string; pid: number; host: string; startedAt: number }

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

export class HealthFileStore {
  private dir: string;
  private lockTimeoutMs: number;
  private staleLockMs: number;
  private hooks: Pick<StoreOptions, "failBeforeRename" | "beforeCommit" | "afterAcquire">;
  constructor(dir: string, opts: StoreOptions = {}) {
    this.dir = dir;
    this.lockTimeoutMs = opts.lockTimeoutMs ?? 30000;
    this.staleLockMs = opts.staleLockMs ?? 60000;
    this.hooks = { failBeforeRename: opts.failBeforeRename, beforeCommit: opts.beforeCommit, afterAcquire: opts.afterAcquire };
  }
  private get file() { return path.join(this.dir, "ledger.json"); }
  private get lockDir() { return path.join(this.dir, "ledger.lock"); }
  private get ownerFile() { return path.join(this.lockDir, "owner.json"); }

  async read(): Promise<Ledger> {
    let text: string;
    try { text = await readFile(this.file, "utf8"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyLedger(); throw e; }
    let parsed: Ledger;
    try { parsed = JSON.parse(text) as Ledger; } catch { throw new Error("ledger.json is not valid JSON (contents not shown)"); }
    if (parsed.schema !== 1) throw new Error("ledger.json has an unsupported schema version");
    const ledger = { ...emptyLedger(), ...parsed };
    // ledgers written before evidence bindings existed carried a single toVersion; it becomes the first binding
    for (const l of Object.values(ledger.links)) if (l.toVersion !== undefined && !l.bindings) { l.bindings = [{ from: 1, to: l.toVersion, runId: l.runId }]; delete l.toVersion; }
    return ledger;
  }

  private async readOwner(): Promise<Owner | null> {
    try { const o = JSON.parse(await readFile(this.ownerFile, "utf8")) as Owner; return o && typeof o.token === "string" && typeof o.pid === "number" ? o : null; } catch { return null; }
  }
  /**
   * Reclaim a lock that is provably stale. Serialised by a reclaim mutex and re-verified INSIDE it: the owner we judged
   * stale must still be the current owner and still dead. A live owner can therefore never lose its lock to a slow
   * waiter's stale observation (the classic read-then-remove race), and only one reclaimer acts at a time.
   */
  private async reclaim(expectedToken: string | null) {
    const mutex = `${this.lockDir}.reclaim`;
    try { await mkdir(mutex); }
    catch {
      try { const s = await stat(mutex); if (Date.now() - s.mtimeMs > Math.max(5000, this.staleLockMs)) await this.removeDir(mutex); } catch { /* released meanwhile */ }
      return;
    }
    try {
      const owner = await this.readOwner();
      let stale = false;
      if (owner) {
        if (owner.token === expectedToken) {
          if (owner.host === os.hostname()) stale = !pidAlive(owner.pid);
          else { const s = await stat(this.ownerFile).catch(() => null); stale = !!s && Date.now() - s.mtimeMs > this.staleLockMs; }
        }
      } else if (expectedToken === null) {
        const s = await stat(this.lockDir).catch(() => null);
        stale = !!s && Date.now() - s.mtimeMs > this.staleLockMs;
      }
      if (!stale) return;
      await this.removeDir(this.lockDir);
    } finally { await this.removeDir(mutex); }
  }

  private async acquire(): Promise<{ token: string; stop: () => void }> {
    await mkdir(this.dir, { recursive: true });
    const deadline = Date.now() + this.lockTimeoutMs;
    const token = randomUUID();
    for (let attempt = 0; ; attempt++) {
      try {
        await mkdir(this.lockDir);
        const owner: Owner = { token, pid: process.pid, host: os.hostname(), startedAt: Date.now() };
        await writeFile(this.ownerFile, JSON.stringify(owner));
        const beat = setInterval(() => { const t = new Date(); utimes(this.ownerFile, t, t).catch(() => {}); }, Math.max(50, this.staleLockMs / 4));
        beat.unref();
        return { token, stop: () => clearInterval(beat) };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
      const owner = await this.readOwner();
      if (owner) {
        if (owner.host === os.hostname()) { if (!pidAlive(owner.pid)) { await this.reclaim(owner.token); continue; } }
        else { try { const s = await stat(this.ownerFile); if (Date.now() - s.mtimeMs > this.staleLockMs) { await this.reclaim(owner.token); continue; } } catch { /* raced */ } }
      } else {
        try { const s = await stat(this.lockDir); if (Date.now() - s.mtimeMs > this.staleLockMs) { await this.reclaim(null); continue; } } catch { continue; }
      }
      if (Date.now() > deadline) throw new Error("health ledger lock timeout");
      await new Promise((r) => setTimeout(r, 5 + Math.min(attempt, 20) * 3));
    }
  }
  private async ownsLock(token: string) { return (await this.readOwner())?.token === token; }
  private async release(token: string) {
    if (!(await this.ownsLock(token))) return; // never delete a lock we do not own
    await this.removeDir(this.lockDir);
  }
  /** Delete in place (no rename: on Windows a directory with a file another process is reading cannot be renamed). */
  private async removeDir(dir: string) { await rm(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 10 }); }

  /** Run `fn` on the latest ledger under the lock. `fn` returns the new ledger (or the same object for "no change") plus a result. */
  async transaction<T>(fn: (ledger: Ledger) => { ledger: Ledger; result: T }): Promise<T> {
    const { token, stop } = await this.acquire();
    try {
      if (this.hooks.afterAcquire) await this.hooks.afterAcquire();
      for (const f of await readdir(this.dir)) if (f.startsWith("ledger.json.") && f.endsWith(".tmp")) await rm(path.join(this.dir, f), { force: true });
      const current = await this.read();
      const { ledger, result } = fn(current);
      if (ledger !== current) {
        const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
        const fh = await open(tmp, "w");
        try { await fh.writeFile(JSON.stringify(ledger)); await fh.sync(); } finally { await fh.close(); }
        if (this.hooks.failBeforeRename) throw new Error("injected failure before rename");
        if (this.hooks.beforeCommit) await this.hooks.beforeCommit();
        if (!(await this.ownsLock(token))) { await rm(tmp, { force: true }); throw new Error("health ledger lock was lost before commit; nothing written"); }
        await rename(tmp, this.file);
        try { const d = await open(this.dir, "r"); try { await d.sync(); } finally { await d.close(); } } catch { /* directory fsync is best-effort (not supported on Windows) */ }
      }
      return result;
    } finally { stop(); await this.release(token); }
  }
}
