import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  acquireProcessLock,
  releaseProcessLock,
  computeDayEvidenceFingerprint,
  classifyDayState,
  computeDayStatuses,
  recordEditorialOutcomes,
  // @ts-expect-error -- ESM script module without .d.ts under allowJs: false
} from "../scripts/editor/pipeline-status.mjs";

type DayStatusRow = {
  day: string;
  status: string;
  classification: string;
  readableCount: number;
  totalSourceCount: number;
  approvedPhotoCount: number;
  evidenceFingerprint: string;
  detail: string;
};

test("day status strictly separates no_qualifying_material (skipped_no_material), failed_infra, blocked_upstream_export, and pending_reopen", () => {
  const fpInitial = computeDayEvidenceFingerprint([{ id: "s1", time: "09:00:00", speaker: "妈妈", text: "好的" }], []);
  const fpExpanded = computeDayEvidenceFingerprint([
    { id: "s1", time: "09:00:00", speaker: "妈妈", text: "好的" },
    { id: "s2", time: "16:20:00", speaker: "老师", text: "小年今天把积木搭得很高" },
  ], ["photo-1"]);

  const statuses = computeDayStatuses({
    from: "2026-11-01",
    through: "2026-11-07",
    publishedDays: new Set(["2026-11-02"]),
    rdsMaxDay: "2026-11-06",
    upstreamStale: false,
    dayEvidence: {
      "2026-11-01": { readableCount: 2, totalCount: 3, photoCount: 1, fingerprint: fpExpanded },
      "2026-11-02": { readableCount: 5, totalCount: 5, photoCount: 3, fingerprint: "fp-2" },
      "2026-11-03": { readableCount: 1, totalCount: 1, photoCount: 0, fingerprint: fpInitial },
      "2026-11-04": { readableCount: 4, totalCount: 4, photoCount: 2, fingerprint: "fp-4" },
      "2026-11-05": { readableCount: 0, totalCount: 0, photoCount: 0, fingerprint: computeDayEvidenceFingerprint([], []) },
      "2026-11-06": { readableCount: 3, totalCount: 3, photoCount: 1, fingerprint: "fp-6" },
      "2026-11-07": { readableCount: 0, totalCount: 0, photoCount: 0, fingerprint: computeDayEvidenceFingerprint([], []) },
    },
    ledgerDays: {
      "2026-11-01": { status: "no_qualifying_material", reason: "只有后勤对话", evidenceFingerprint: fpInitial },
      "2026-11-03": { status: "skipped_no_material", reason: "只有一句大人确认", evidenceFingerprint: fpInitial },
      "2026-11-04": { status: "failed_infra", stage: "content-install", errorCode: "SSH_TIMEOUT" },
    },
  }) as DayStatusRow[];

  const byDay = new Map<string, DayStatusRow>(statuses.map((s: DayStatusRow) => [s.day, s]));
  assert.equal(byDay.get("2026-11-01")?.status, "pending_reopen", "newly arrived messages must reopen a skipped day");
  assert.equal(byDay.get("2026-11-01")?.classification, "pending_editorial");
  assert.equal(byDay.get("2026-11-02")?.status, "published");
  assert.equal(byDay.get("2026-11-02")?.classification, "published");
  assert.equal(byDay.get("2026-11-03")?.status, "no_qualifying_material");
  assert.equal(byDay.get("2026-11-03")?.classification, "skipped_no_material");
  assert.equal(byDay.get("2026-11-04")?.status, "failed_infra");
  assert.equal(byDay.get("2026-11-04")?.classification, "failed_infra");
  assert.equal(byDay.get("2026-11-05")?.status, "no_raw_sources", "within RDS watermark and zero messages");
  assert.equal(byDay.get("2026-11-05")?.classification, "skipped_no_material");
  assert.equal(byDay.get("2026-11-06")?.status, "pending");
  assert.equal(byDay.get("2026-11-06")?.classification, "pending_editorial");
  assert.equal(byDay.get("2026-11-07")?.status, "blocked_upstream_export", "beyond RDS watermark cannot be assumed empty");
  assert.equal(byDay.get("2026-11-07")?.classification, "blocked_upstream_export");
  assert.equal(classifyDayState("skipped_no_material"), "skipped_no_material");
});

test("recordEditorialOutcomes and CLI record-editorial persist fingerprints and never downgrade published days", (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "nianlife-ledger-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ledgerPath = path.join(dir, "editorial-ledger.json");

  recordEditorialOutcomes(ledgerPath, {
    reviewedAt: "2026-11-11T04:00:00.000Z",
    runId: "run-1",
    wrote: [{ day: "2026-11-02", version: "2026-11.v1.json" }],
    skipped: [{ day: "2026-11-03", reason: "无儿童事实" }],
    dayFingerprints: { "2026-11-02": "fp2", "2026-11-03": "fp3" },
  });

  const afterFail = recordEditorialOutcomes(ledgerPath, {
    reviewedAt: "2026-11-11T05:00:00.000Z",
    runId: "run-2",
    failed: [
      { day: "2026-11-02", stage: "revalidate", errorCode: "TIMEOUT" },
      { day: "2026-11-04", stage: "prepare", errorCode: "DB_DOWN" },
    ],
  });

  assert.equal(afterFail.days["2026-11-02"].status, "published");
  assert.equal(afterFail.days["2026-11-03"].evidenceFingerprint, "fp3");
  assert.equal(afterFail.days["2026-11-03"].classification, "skipped_no_material");
  assert.equal(afterFail.days["2026-11-04"].status, "failed_infra");

  const decisionsPath = path.join(dir, "decisions.json");
  fs.writeFileSync(decisionsPath, JSON.stringify([
    { day: "2026-11-05", decision: "write", title: "搭积木", paragraphs: [] },
    { day: "2026-11-06", decision: "skip", reason: "仅群内通知" },
  ]), "utf8");
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const scriptPath = path.resolve(testDir, "../scripts/editor/pipeline-status.mjs");
  const cliRes = spawnSync(process.execPath, [
    scriptPath,
    "record-editorial",
    "--ledger", ledgerPath,
    "--decisions", decisionsPath,
    "--day-fingerprints", JSON.stringify({ "2026-11-05": "fp5", "2026-11-06": "fp6" }),
    "--no-rds",
  ], { encoding: "utf8" });
  assert.equal(cliRes.status, 0, cliRes.stderr);
  const saved = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  assert.equal(saved.days["2026-11-05"].status, "published");
  assert.equal(saved.days["2026-11-06"].status, "no_qualifying_material");
  assert.equal(saved.days["2026-11-06"].evidenceFingerprint, "fp6");
});

test("acquireProcessLock blocks live overlapping runs and automatically recovers dead PID locks", (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "nianlife-lock-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lockPath = path.join(dir, "sync.lock");

  const first = acquireProcessLock(lockPath, { pid: 1001, nowMs: 1000, isPidAlive: (p: number) => p === 1001 });
  assert.equal(first.acquired, true);

  const overlap = acquireProcessLock(lockPath, { pid: 1002, nowMs: 2000, isPidAlive: (p: number) => p === 1001 });
  assert.equal(overlap.acquired, false);
  assert.equal(overlap.holderPid, 1001);

  const recovered = acquireProcessLock(lockPath, { pid: 1003, nowMs: 3000, isPidAlive: () => false });
  assert.equal(recovered.acquired, true);
  assert.equal(recovered.recoveredStale, true);

  releaseProcessLock(lockPath, 1003);
  assert.equal(fs.existsSync(lockPath), false);
});
