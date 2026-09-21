// HEALTH-M01-A-R1 local medical-evidence register. A register is a JSON file next to the saved texts that were actually read:
//   { schema: 1, sources: [{ id, title, publisher, version, url, localText, textSha256, status?: "current"|"revised"|"withdrawn", ... }] }
// An analysis binds each evidence id to hashOf(entry) - the entry carries the digest of the saved text - so an id that does not exist,
// an entry that was revised or withdrawn, or a saved text that is missing or no longer hashes to its registered digest is a problem,
// never a silent pass. Nothing here goes to the network.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hashOf } from "../model";
import type { EvidenceResolver } from "./analysis";

export interface EvidenceEntry { id: string; localText?: string; textSha256?: string; status?: string; [k: string]: unknown }
export interface EvidenceRegister { schema?: number; sources: EvidenceEntry[] }

/** Resolver over a parsed register; `readText` returns the bytes of a saved text (relative to the register directory) or undefined. */
export function evidenceResolver(reg: EvidenceRegister | null, readText: (rel: string) => Buffer | undefined): EvidenceResolver {
  const byId = new Map((reg?.sources ?? []).map((s) => [s.id, s]));
  return (id) => {
    if (!reg) return { problem: "医学证据登记没有接通" };
    const e = byId.get(id);
    if (!e) return { problem: "不在证据登记里" };
    if (e.status && e.status !== "current") return { problem: e.status === "withdrawn" ? "已被撤回" : "登记显示已被修订，需要重新核对" };
    if (typeof e.localText !== "string" || !/^[0-9a-f]{64}$/.test(String(e.textSha256))) return { problem: "登记里没有已读正文的哈希，无法核验" };
    const bytes = readText(e.localText);
    if (!bytes) return { problem: "保存的已读正文找不到" };
    if (createHash("sha256").update(bytes).digest("hex") !== e.textSha256) return { problem: "保存的已读正文与登记的哈希不一致" };
    return { hash: hashOf(e) };
  };
}
/** Resolver from a register file on disk; text paths are confined to the register's directory. Missing/unreadable/malformed -> every id has a problem. */
export function evidenceResolverFromFile(file: string | null | undefined): EvidenceResolver {
  let reg: EvidenceRegister | null = null;
  const root = file ? path.dirname(path.resolve(file)) : "";
  try { if (file) { const v = JSON.parse(readFileSync(file, "utf8")); if (v && Array.isArray(v.sources)) reg = v; } } catch { reg = null; }
  return evidenceResolver(reg, (rel) => {
    const p = path.resolve(root, rel);
    if (path.relative(root, p).startsWith("..") || path.isAbsolute(path.relative(root, p))) return undefined;
    try { return readFileSync(p); } catch { return undefined; }
  });
}
