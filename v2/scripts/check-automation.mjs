import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function inspectAutomation(ops, now = Date.now()) {
  const read = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
  const recent = (file) => {
    let fd;
    try {
      fd = fs.openSync(file, "r"); const size = fs.fstatSync(fd).size;
      const buffer = Buffer.alloc(Math.min(size, 128 * 1024));
      fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      return buffer.toString("utf8").split("\n").flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    } catch { return []; } finally { if (fd !== undefined) fs.closeSync(fd); }
  };
  const receipt = read(path.join(ops, "editor/runs/latest.json"));
  const ageHours = receipt?.at ? (now - Date.parse(receipt.at)) / 3600000 : null;
  const stages = ["editor", "backfill", "reminders", "carousel"].map((name) => ({ name,
    status: receipt?.stages?.[name] === 0 ? "passed" : typeof receipt?.stages?.[name] === "number" ? "failed" : "unknown",
    exitCode: receipt?.stages?.[name] ?? null }));
  const ledger = (file) => {
    const events = recent(path.join(ops, file));
    const last = events.at(-1);
    const published = events.filter((item) => item.event === "published").at(-1);
    return { lastAt: last?.at ?? null, lastEvent: last?.event ?? null, latestPublishedDay: published?.day ?? published?.month ?? null,
      latestPublicationAt: published?.at ?? null, version: published?.version ?? null };
  };
  return { status: ageHours === null || !Number.isFinite(ageHours) ? "unknown" : ageHours < 0 || ageHours > 36 ? "stale" : stages.every((stage) => stage.status === "passed") ? "passed" : "failed",
    recordedAt: receipt?.at ?? null, ageHours, stages,
    editor: ledger("editor/ledger.jsonl"), reminders: ledger("editor/reminders-ledger.jsonl"), backfill: ledger("editor/backfill-ledger.jsonl"), photos: ledger("photos/ledger.jsonl"),
    verification: "Local execution evidence only. Verify importer, photo task, deployed cache hash and published day on ECS separately." };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2); const index = args.indexOf("--ops-dir");
  const result = inspectAutomation(index >= 0 ? args[index + 1] : process.env.NIANLIFE_OPS_DIR ?? "C:/Users/teddy/NianlifeOps/ops-daily");
  console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === "passed" ? 0 : 2;
}
