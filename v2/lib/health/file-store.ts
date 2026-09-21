// File-backed ledger store: a directory holding ledger.json. Every mutation is one transaction:
//   lock (mkdir is atomic) -> read latest -> pure update -> write temp -> rename -> unlock.
// If the update throws or the process dies before rename, ledger.json is untouched (no partial write).
// A lock left by a dead process is reclaimed after `staleLockMs`. This is the local, isolated
// stand-in for a database transaction; it says nothing about Postgres behaviour (see the migration note).
import { mkdir, readFile, rename, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { emptyLedger, type Ledger } from "./model";

export interface StoreOptions { lockTimeoutMs?: number; staleLockMs?: number; failBeforeRename?: boolean }

export class HealthFileStore {
  private dir: string;
  private opts: Required<Omit<StoreOptions, "failBeforeRename">> & { failBeforeRename: boolean };
  constructor(dir: string, opts: StoreOptions = {}) {
    this.dir = dir;
    this.opts = { lockTimeoutMs: opts.lockTimeoutMs ?? 30000, staleLockMs: opts.staleLockMs ?? 60000, failBeforeRename: opts.failBeforeRename ?? false };
  }
  private get file() { return path.join(this.dir, "ledger.json"); }
  private get lockDir() { return path.join(this.dir, "ledger.lock"); }

  async read(): Promise<Ledger> {
    try { return JSON.parse(await readFile(this.file, "utf8")) as Ledger; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyLedger(); throw e; }
  }

  private async acquire() {
    await mkdir(this.dir, { recursive: true });
    const deadline = Date.now() + this.opts.lockTimeoutMs;
    for (let attempt = 0; ; attempt++) {
      try { await mkdir(this.lockDir); await writeFile(path.join(this.lockDir, "owner"), `${process.pid} ${Date.now()}`); return; }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        try { const s = await stat(this.lockDir); if (Date.now() - s.mtimeMs > this.opts.staleLockMs) { await rm(this.lockDir, { recursive: true, force: true }); continue; } } catch { /* raced with release */ }
        if (Date.now() > deadline) throw new Error("health ledger lock timeout");
        await new Promise((r) => setTimeout(r, 5 + Math.min(attempt, 20) * 3));
      }
    }
  }
  private async release() { await rm(this.lockDir, { recursive: true, force: true }); }

  /** Run `fn` on the latest ledger under the lock. `fn` returns the new ledger (or the same object for "no change") plus a result. */
  async transaction<T>(fn: (ledger: Ledger) => { ledger: Ledger; result: T }): Promise<T> {
    await this.acquire();
    try {
      const current = await this.read();
      const { ledger, result } = fn(current);
      if (ledger !== current) {
        const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, JSON.stringify(ledger));
        if (this.opts.failBeforeRename) throw new Error("injected failure before rename");
        await rename(tmp, this.file);
      }
      return result;
    } finally { await this.release(); }
  }
}
