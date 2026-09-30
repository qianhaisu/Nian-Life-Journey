import fs from "node:fs";
import { createHash } from "node:crypto";
const revisions = new Map();
export const productionRevision = (month) => revisions.get(month);
export function rememberProductionRevision(month, file) {
  revisions.set(month, createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
}
import { spawnSync } from "node:child_process";

/** Missing content is allowed only after SSH explicitly proves absence, never after an I/O error. */
export function readProductionContent(month, dest, ecs, run = spawnSync) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("invalid month");
  const remote = `/srv/nianlife-content/${month}.json`;
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-i", ecs.key];
  const probe = run("ssh", [...args, ecs.ssh, `if test -f '${remote}'; then echo PRESENT; elif test -d /srv/nianlife-content && test -r /srv/nianlife-content && ! test -e '${remote}' && ! test -L '${remote}'; then echo ABSENT; else exit 3; fi`], { encoding: "utf8" });
  if (probe.status !== 0) throw new Error(`content probe failed (${probe.status ?? "spawn"}); production content left untouched`);
  if ((probe.stdout ?? "").trim() === "ABSENT") { revisions.set(month, "absent"); return null; }
  if ((probe.stdout ?? "").trim() !== "PRESENT") throw new Error("ambiguous content probe");
  const copy = run("scp", ["-q", ...args, `${ecs.ssh}:${remote}`, dest], { encoding: "utf8" });
  if (copy.status !== 0) throw new Error("content read failed; cannot start from an empty month");
  const content = JSON.parse(fs.readFileSync(dest, "utf8"));
  if (content.schema !== "nianlife.month-content/1" || content.month !== month || !Array.isArray(content.days)) throw new Error("invalid production content");
  rememberProductionRevision(month, dest);
  return content;
}
