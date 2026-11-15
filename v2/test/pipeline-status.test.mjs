import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  acquireProcessLock,
  releaseProcessLock,
  computeDayEvidenceFingerprint,
  classifyDayState,
  computeDayStatuses,
  recordEditorialOutcomes,
  resolveWeFlowConfigPath,
  readWeFlowTasks,
  inspectWeFlowUpstream,
} from "../scripts/editor/pipeline-status.mjs";

test("day status strictly separates no_qualifying_material, failed_infra, blocked_upstream_export, and pending_reopen", () => {
  const fpInitial = computeDayEvidenceFingerprint([{ id: "s1", time: "09:00:00", speaker: "妈妈", text: "好的" }], []);
  const fpExpanded = computeDayEvidenceFingerprint([
    { id: "s1", time: "09:00:00", speaker: "妈妈", text: "好的" },
    { id: "s2", time: "16:20:00", speaker: "老师", text: "小年今天把积木搭得很高" },
  ], ["photo-1"]);

  const statuses = computeDayStatuses({
    from: "2026-11-01",
    through: "2026-11-06",
    publishedDays: new Set(["2026-11-02"]),
    rdsMaxDay: "2026-11-05",
    upstreamStale: false,
    dayEvidence: {
      "2026-11-01": { readableCount: 2, totalCount: 3, photoCount: 1, fingerprint: fpExpanded },
      "2026-11-02": { readableCount: 5, totalCount: 5, photoCount: 3, fingerprint: "fp-2" },
      "2026-11-03": { readableCount: 1, totalCount: 1, photoCount: 0, fingerprint: fpInitial },
      "2026-11-04": { readableCount: 4, totalCount: 4, photoCount: 2, fingerprint: "fp-4" },
      "2026-11-05": { readableCount: 0, totalCount: 0, photoCount: 0, fingerprint: computeDayEvidenceFingerprint([], []) },
      "2026-11-06": { readableCount: 0, totalCount: 0, photoCount: 0, fingerprint: computeDayEvidenceFingerprint([], []) },
    },
    ledgerDays: {
      "2026-11-01": { status: "no_qualifying_material", reason: "只有后勤对话", evidenceFingerprint: fpInitial },
      "2026-11-03": { status: "no_qualifying_material", reason: "只有一句大人确认", evidenceFingerprint: fpInitial },
      "2026-11-04": { status: "failed_infra", stage: "content-install", errorCode: "SSH_TIMEOUT" },
    },
  });

  const byDay = new Map(statuses.map((s) => [s.day, s.status]));
  assert.equal(byDay.get("2026-11-01"), "pending_reopen", "newly arrived messages must reopen a skipped day");
  assert.equal(byDay.get("2026-11-02"), "published");
  assert.equal(byDay.get("2026-11-03"), "no_qualifying_material");
  assert.equal(byDay.get("2026-11-04"), "failed_infra");
  assert.equal(byDay.get("2026-11-05"), "no_raw_sources", "within RDS watermark and zero messages");
  assert.equal(byDay.get("2026-11-06"), "blocked_upstream_export", "beyond RDS watermark cannot be assumed empty");
  assert.equal(classifyDayState("no_qualifying_material"), "skipped_no_material");
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
  assert.equal(afterFail.days["2026-11-04"].status, "failed_infra");

  const scriptPath = path.resolve(import.meta.dirname, "../scripts/editor/pipeline-status.mjs");
  const cliRes = spawnSync(process.execPath, [
    scriptPath,
    "record-editorial",
    "--ledger", ledgerPath,
    "--wrote", "2026-11-05",
    "--skipped", "2026-11-06:仅物流通知",
    "--day-fingerprints", JSON.stringify({ "2026-11-05": "fp5", "2026-11-06": "fp6" }),
    "--no-rds",
  ], { encoding: "utf8" });
  assert.equal(cliRes.status, 0, cliRes.stderr);
  const saved = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  assert.equal(saved.days["2026-11-05"].status, "published");
  assert.equal(saved.days["2026-11-06"].status, "no_qualifying_material");
  assert.equal(saved.days["2026-11-06"].reason, "仅物流通知");
  assert.equal(saved.days["2026-11-06"].evidenceFingerprint, "fp6");
});

test("acquireProcessLock blocks live overlapping runs and automatically recovers dead PID locks", (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "nianlife-lock-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lockPath = path.join(dir, "sync.lock");

  const first = acquireProcessLock(lockPath, { pid: 1001, nowMs: 1000, isPidAlive: (p) => p === 1001 });
  assert.equal(first.acquired, true);

  const overlap = acquireProcessLock(lockPath, { pid: 1002, nowMs: 2000, isPidAlive: (p) => p === 1001 });
  assert.equal(overlap.acquired, false);
  assert.equal(overlap.holderPid, 1001);

  const recovered = acquireProcessLock(lockPath, { pid: 1003, nowMs: 3000, isPidAlive: () => false });
  assert.equal(recovered.acquired, true);
  assert.equal(recovered.recoveredStale, true);

  releaseProcessLock(lockPath, 1003);
  assert.equal(fs.existsSync(lockPath), false);
});

test("resolveWeFlowConfigPath and readWeFlowTasks prefer WeFlow 5.0 Community config and fall back to legacy path", (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "nianlife-wfcfg-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const communityPath = path.join(dir, "WeFlowCommunity5", "profile", "WeFlow-config.json");
  const legacyPath = path.join(dir, "Roaming", "weflow", "WeFlow-config.json");
  fs.mkdirSync(path.dirname(communityPath), { recursive: true });
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });

  fs.writeFileSync(legacyPath, JSON.stringify({
    exportAutomationTaskMap: {
      daily: {
        tasks: [{ id: "legacy-task", enabled: true, runState: { lastRunStatus: "error", lastError: "WCDB offline" } }],
      },
    },
  }));
  assert.equal(resolveWeFlowConfigPath({ configPath: null, communityPath, legacyPath }), legacyPath);
  assert.equal(readWeFlowTasks({ configPath: null, communityPath, legacyPath })[0].id, "legacy-task");
  assert.equal(readWeFlowTasks({ configPath: null, communityPath, legacyPath })[0].wcdbDisconnected, true);

  fs.writeFileSync(communityPath, JSON.stringify({
    exportAutomationTaskMap: {
      daily: {
        tasks: [
          {
            id: "community-task",
            enabled: true,
            schedule: { intervalDays: 1, intervalHours: null },
            template: { dateRangeConfig: { preset: "last7days" } },
            runState: { lastRunStatus: "success", lastTriggeredAt: 1794585600000, lastSuccessAt: 1794585600000 },
          },
          { id: "disabled-task", enabled: false, runState: { lastRunStatus: "error" } },
          { id: "never-ran", enabled: true, runState: { lastRunStatus: "idle", lastTriggeredAt: 0, lastSuccessAt: 0 } },
        ],
      },
    },
  }));

  assert.equal(resolveWeFlowConfigPath({ configPath: null, communityPath, legacyPath }), communityPath);
  const tasks = readWeFlowTasks({ configPath: null, communityPath, legacyPath });
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].id, "community-task");
  assert.equal(tasks[0].lastRunStatus, "success");
  assert.equal(tasks[0].preset, "last7days");
  assert.equal(tasks[1].lastTriggeredAt, null);
  assert.equal(tasks[1].lastSuccessAt, null);
});

test("inspectWeFlowUpstream inspects both .md and WeFlow .json transcripts, ignores auxiliary JSONs/dotfiles, and dedupes sessions", (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "nianlife-upstream-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const textsDir = path.join(dir, "texts");
  const communityPath = path.join(dir, "WeFlow-config.json");
  fs.mkdirSync(path.join(textsDir, "chat_a"), { recursive: true });
  fs.mkdirSync(path.join(textsDir, "chat_b"), { recursive: true });

  // Stale Markdown export for chat_a (2026-11-12)
  fs.writeFileSync(
    path.join(textsDir, "chat_a", "chat_a.md"),
    "# 家庭群\n- 会话ID: `12345@chatroom`\n- 会话类型: 群聊\n---\n## 2026-11-12 09:00:00 妈妈\n早安\n",
  );

  // Fresh WeFlow 5.0 JSON for the same chat_a, crossing UTC->Shanghai midnight (2026-11-12T16:30:00Z = 2026-11-13T00:30:00+08:00),
  // plus trailing avatars > 150 KB so a naive tail scan would miss messages, and a clamped future formattedTime.
  const largeAvatars = { pad: "x".repeat(160_000) };
  fs.writeFileSync(
    path.join(textsDir, "chat_a", "chat_a.json"),
    JSON.stringify({
      weflow: { version: "5.0.0" },
      session: { wxid: "12345@chatroom", displayName: "家庭群" },
      messages: [
        { createTime: Math.floor(Date.parse("2026-11-12T16:30:00Z") / 1000), formattedTime: "2026-11-13 00:30:00", type: "图片消息", content: "[图片]" },
        { createTime: 0, formattedTime: "2026-11-20 10:00:00", type: "文本消息", content: "future should clamp" },
      ],
      avatars: largeAvatars,
    }),
  );

  // Another valid transcript using formattedTime fallback (2026-11-13) without top-level `weflow` key
  fs.writeFileSync(
    path.join(textsDir, "chat_b", "chat_b.json"),
    JSON.stringify({
      session: { wxid: "wxid_mom", nickname: "妈妈" },
      messages: [
        { formattedTime: "2026-11-13 21:15:00", type: "文本消息", content: "睡啦" },
      ],
    }),
  );

  // Auxiliary JSONs, malformed JSON, and dotfiles must be ignored
  fs.writeFileSync(path.join(textsDir, "metadata.json"), JSON.stringify({ exportedAt: "2026-11-25", items: ["2026-11-25"] }));
  fs.writeFileSync(path.join(textsDir, "broken.json"), "{not-valid-json");
  fs.writeFileSync(path.join(textsDir, ".weflow-partial.json"), JSON.stringify({
    weflow: { version: "5.0.0" },
    session: { wxid: "partial" },
    messages: [{ formattedTime: "2026-11-14 08:00:00" }],
  }));

  fs.writeFileSync(communityPath, JSON.stringify({
    exportAutomationTaskMap: {
      g1: { tasks: [{ id: "auto-1", enabled: true, template: { dateRangeConfig: { preset: "last7days" } }, runState: { lastRunStatus: "success" } }] },
    },
  }));

  const res = inspectWeFlowUpstream("2026-11-14", {
    srcDir: textsDir,
    configPath: null,
    communityPath,
    legacyPath: path.join(dir, "missing.json"),
  });

  assert.equal(res.markdownCount, 1);
  assert.equal(res.jsonCount, 2);
  assert.equal(res.transcriptCount, 3);
  assert.equal(res.sessionCount, 2, "chat_a .md and .json share 12345@chatroom");
  assert.equal(res.maxExportedDay, "2026-11-13");
  assert.equal(res.stale, false);
  assert.equal(res.ok, true);
  assert.equal(res.tasks.length, 1);
  assert.equal(res.tasks[0].id, "auto-1");
});

test("t35-archive-exports CLI computes maxExportedDay across .md and .json and reads NIANLIFE_WEFLOW_CONFIG", (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "nianlife-t35-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const textsDir = path.join(dir, "texts");
  const archiveDir = path.join(dir, "exports");
  const wfCfgPath = path.join(dir, "WeFlow-config.json");
  fs.mkdirSync(path.join(textsDir, "grp"), { recursive: true });

  const oneHourAgoSec = Math.floor((Date.now() - 3600_000) / 1000);
  const expectedJsonDay = new Date(oneHourAgoSec * 1000 + 8 * 3600_000).toISOString().slice(0, 10);

  fs.writeFileSync(
    path.join(textsDir, "grp", "grp.md"),
    "# 小群\n- 会话ID: `grp@chatroom`\n---\n## 2026-01-01 08:00:00 妈妈\n旧消息\n",
  );
  fs.writeFileSync(
    path.join(textsDir, "grp", "grp.json"),
    JSON.stringify({
      weflow: { version: "5.0.0" },
      session: { wxid: "grp@chatroom" },
      messages: [{ createTime: oneHourAgoSec, type: "文本消息", content: "刚导出" }],
    }),
  );
  fs.writeFileSync(path.join(textsDir, "aux.json"), JSON.stringify({ note: "2029-12-31" }));
  fs.writeFileSync(path.join(textsDir, ".tmp.json"), JSON.stringify({ session: { wxid: "ignore" }, messages: [] }));
  fs.writeFileSync(wfCfgPath, JSON.stringify({
    exportAutomationTaskMap: {
      daily: { tasks: [{ id: "wf5-task", enabled: true, template: { dateRangeConfig: { preset: "last7days" } }, runState: { lastRunStatus: "success", lastSuccessAt: oneHourAgoSec * 1000 } }] },
    },
  }));

  const scriptPath = path.resolve(import.meta.dirname, "../.data/t35-archive-exports.mjs");
  const res = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      NIANLIFE_WECHAT_EXPORT_TEXTS: textsDir,
      NIANLIFE_EXPORTS_ARCHIVE: archiveDir,
      NIANLIFE_WEFLOW_CONFIG: wfCfgPath,
    },
  });
  assert.equal(res.status, 0, res.stderr);
  const output = JSON.parse(res.stdout.trim());
  assert.equal(output.complete, true);
  assert.equal(output.archived, 3);
  assert.equal(output.transcriptCount, 2);
  assert.equal(output.markdownCount, 1);
  assert.equal(output.jsonCount, 1);
  assert.equal(output.sessionCount, 1);
  assert.equal(output.maxExportedDay, expectedJsonDay);
  assert.equal(output.upstreamStale, false);
  assert.equal(output.weflowHasError, false);

  const manifest = JSON.parse(fs.readFileSync(path.join(output.snapshot, "MANIFEST.json"), "utf8"));
  assert.equal(manifest.maxExportedDay, expectedJsonDay);
  assert.equal(manifest.upstreamStale, false);
  assert.equal(manifest.weflowTasks.length, 1);
  assert.equal(manifest.weflowTasks[0].id, "wf5-task");
  assert.equal(manifest.weflowTasks[0].status, "success");
  assert.equal(fs.existsSync(path.join(output.snapshot, ".tmp.json")), false);
});
