// HEALTH-04 health page: model rules, re-review triggers, the refresh path after new/corrected records, and the protected read APIs.
// All data is synthetic and lives in fresh temp directories; nothing touches a real ledger, original or database.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { applyCorrection, applyPlan, effectiveHash, planImport } from "../lib/health/ledger.ts";
import { emptyLedger } from "../lib/health/model.ts";
import { HealthFileStore } from "../lib/health/file-store.ts";
import { buildHealthPage, looksFeverish } from "../lib/health/page/model.ts";
import { HealthPageService, loadPageSourcesConfig } from "../lib/health/page/service.ts";
import { loadHealthRecordConfig } from "../lib/health/record/config.ts";
import { createHealthRecordHandler } from "../lib/health/record/http.ts";
import { HealthRecordService } from "../lib/health/record/service.ts";

const ORIGIN = "http://health.test";
const T0 = Date.parse("2026-09-21T10:00:00+08:00");
const NOW = "2026-09-21T10:00";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const uid = (() => { let n = 0; return () => `pg${String(++n).padStart(6, "0")}${"y".repeat(12)}`; })();
const obs = (id, recordedAt, text, links = []) => ({ kind: "observation", id, content: { role: "observation", recordedAt, occurredAt: null, occurredPrecision: null, timeBasis: "message_time_only", text, speaker: "妈妈" }, links });

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "health-page-test-"));
  const allowed = path.join(dir, "pictures"), other = path.join(dir, "elsewhere");
  await mkdir(path.join(allowed, "hosp"), { recursive: true }); await mkdir(other, { recursive: true });
  const good = Buffer.from("synthetic-report-bytes"), outside = Buffer.from("outside-bytes");
  await writeFile(path.join(allowed, "hosp", "a.jpg"), good);
  await writeFile(path.join(other, "b.jpg"), outside);
  await writeFile(path.join(dir, "outside.jpg"), outside);
  const src = (id, root, relPath, bytes) => ({ kind: "source", id, content: { layer: "hospital_document", root, relPath, sha256: sha(bytes), docKind: "检验报告" } });
  const batch = { batchId: "synthetic-history", items: [
    src("doc:1", allowed, "hosp/a.jpg", good), src("doc:other-root", other, "b.jpg", outside), src("doc:trav", allowed, "../outside.jpg", outside),
    { kind: "encounter", id: "E1", content: { kind: "visit", date: "2026-07-26", hospital: "某儿童医院", dept: "呼吸内科" }, links: [{ role: "documented_in", to: { kind: "source", id: "doc:1" } }] },
    { kind: "encounter", id: "E2", content: { kind: "appointment_only", date: "2026-10-08", hospital: "某儿童医院", dept: "耳鼻喉科" } },
    { kind: "encounter", id: "E3", content: { kind: "appointment_only", date: "2026-05-05", hospital: "某医院", dept: "外科" } },
    { kind: "canonical_fact", id: "CF1", content: { type: "diagnosis", value: "急性支气管炎", structured: null }, links: [{ role: "of_encounter", to: { kind: "encounter", id: "E1" } }] },
    { kind: "canonical_fact", id: "CF2", content: { type: "medication_prescribed", value: "某口服液", structured: { name: "某口服液", dose: "每次5ml", freq: "BID" }, actuallyTaken: "reported" }, links: [{ role: "of_encounter", to: { kind: "encounter", id: "E1" } }] },
    { kind: "episode", id: "EP-X", content: { title: "2026-07 流涕→咳嗽→发热", start: "2026-07-10", declaredEnd: "end_unknown", keyFindings: ["**7/26** 诊断急性支气管炎"], openQuestions: ["结束日期"] }, links: [{ role: "encounter", to: { kind: "encounter", id: "E1" } }] },
    { kind: "episode", id: "EP-Y", content: { title: "2026-05 急性鼻窦炎", start: "2026-05-23", declaredEnd: "end_unknown" } },
    obs("O1", "2026-04-22 22:37:43", "好像又鼻塞了"),
    obs("O2", "2026-04-24 12:04:55", "还是鼻涕拖拖"),
    obs("O3", "2026-04-28 17:32:15", "目前没有流鼻涕"),
    obs("O4", "2026-07-12 19:58:37", "37.8", [{ role: "attached", to: { kind: "episode", id: "EP-X" } }]),
    obs("O5", "2026-07-26 11:13:06", "7月10日左右开始流鼻涕，这两天一直没有减轻", [{ role: "attached", to: { kind: "episode", id: "EP-X" } }]),
    obs("O6", "2026-07-13 09:00:00", "他们家孩子也发烧了"), // not reviewed, not attached: never a node
  ] };
  const plan = planImport(emptyLedger(), batch);
  assert.equal(plan.rejected, false, JSON.stringify(plan.items.filter((i) => i.action === "rejected")));
  const history = applyPlan(emptyLedger(), plan, { runId: "r1", at: "2026-09-20T00:00:00.000Z" });
  const histDir = path.join(dir, "history");
  await new HealthFileStore(histDir).transaction(() => ({ ledger: history, result: null }));
  const ref = (L, id, kind = "observation") => ({ ledger: "history", ref: { kind, id }, hash: effectiveHash(L, { kind, id }) });
  const intervals = { schema: 1, reviewedAt: "2026-09-21T00:00:00.000Z", reviewer: "test", nodes: [],
    intervals: [
      { id: "IV-a", kind: "suspected", episodeId: null, start: "2026-04-22", end: "2026-04-24", endKind: "last_record", label: "鼻涕", reason: "「还是」承接", supports: [ref(history, "O1"), ref(history, "O2")], counter: [ref(history, "O3")] },
      { id: "IV-b", kind: "recorded", episodeId: "EP-X", start: "2026-07-10", startApprox: true, end: "2026-07-26", endKind: "last_record", label: "流涕咳嗽", reason: "原文写明", supports: [ref(history, "O5")] },
    ] };
  const materials = { schema: 1, generatedAt: "2026-09-21T00:00:00Z", dataCutoff: "2026-09-19T10:19", reviewedBy: "test",
    items: [{ id: "m1", group: "visit", kind: "conditional", text: "呼吸明显费力时马上就医", source: { file: "x.md", sha256: "0", section: "§1", lines: "1" }, version: "v", conditions: [], reassessWhen: [] },
      { id: "m2", group: "care", kind: "care", text: "规律供液", source: { file: "x.md", sha256: "0", section: "§1", lines: "2" }, version: "v", conditions: [], reassessWhen: [], episodes: ["EP-X"] }] };
  await writeFile(path.join(dir, "intervals.json"), JSON.stringify(intervals));
  await writeFile(path.join(dir, "materials.json"), JSON.stringify(materials));
  return { dir, allowed, histDir, history, intervals, materials, good, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("1 模型：红色只来自核查区间；零散记录只是节点；没有绿色；就医记录不展示实际用药；提醒只有将来的预约", async () => {
  const f = await fixture();
  try {
    const p = buildHealthPage({ history: f.history, record: null, intervals: f.intervals, materials: f.materials, now: NOW });
    assert.deepEqual(p.bands.map((b) => [b.id, b.kind, b.status]), [["IV-a", "suspected", "ok"], ["IV-b", "recorded", "ok"], ["open-EP-Y", "open", "ok"]]);
    const openY = p.bands.find((b) => b.id === "open-EP-Y");
    assert.equal(openY.start, openY.end, "结束未知的病程只在开始处画一个短渐隐，不给长度");
    assert.ok(!JSON.stringify(p).includes("green") && !/确认健康/.test(JSON.stringify(p)), "没有绿色、没有“确认健康”");
    const nodeDays = p.nodes.map((n) => n.date);
    assert.ok(nodeDays.includes("2026-04-22") && nodeDays.includes("2026-07-12") && nodeDays.includes("2026-07-26"));
    assert.ok(!nodeDays.includes("2026-07-13"), "没核查、没挂靠的他人发烧不成为节点");
    assert.equal(p.nodes.find((n) => n.date === "2026-07-12").kind, "fever");
    const ep = p.episodes.find((e) => e.id === "EP-X");
    assert.equal(ep.category, "resp");
    assert.equal(ep.endKnown, false);
    assert.deepEqual(ep.summary.points, ["7/26 诊断急性支气管炎"]);
    assert.match(ep.summary.medical, /待补/);
    const v = ep.visits[0];
    assert.deepEqual([v.date, v.hospital, v.dept, v.diagnoses, v.prescriptions], ["2026-07-26", "某儿童医院", "呼吸内科", ["急性支气管炎"], ["某口服液 · 每次5ml · BID"]]);
    assert.deepEqual(v.reports, [{ href: "/api/health-record/history-originals/doc%3A1", label: "检验报告" }]);
    assert.ok(!/actuallyTaken|家长确认|实际用药/.test(JSON.stringify(p.episodes)), "就医记录里没有“实际用药/家长确认用了”");
    assert.deepEqual(p.reminders.map((r) => r.id), ["E2"], "只有尚未到来的预约进首页提醒；过去的预约、历史处方都不进");
    assert.equal(p.followUp.status, "current");
    assert.equal(p.followUp.visit[0].kind, "conditional");
    assert.deepEqual(p.years, [2026]);
  } finally { await f.cleanup(); }
});

test("2 重新核对：依据被更正、核查后有新记录落进区间、来源断开 → 该段改为“待重新核对”，不沿用旧判断", async () => {
  const f = await fixture();
  try {
    const corrected = applyCorrection(f.history, { id: "c-1", type: "field", ref: { kind: "observation", id: "O2" }, changes: [{ field: "text", after: "鼻涕没有了" }], author: "妈妈", at: "2026-09-21T09:00", reason: "更正" }).ledger;
    const p1 = buildHealthPage({ history: corrected, record: null, intervals: f.intervals, materials: f.materials, now: NOW });
    const a = p1.bands.find((b) => b.id === "IV-a");
    assert.equal(a.status, "needs_review");
    assert.match(a.statusReasons.join(), /O2 核查后被修改过/);
    assert.deepEqual(p1.pendingIntervals, ["IV-a"]);
    assert.equal(p1.bands.find((b) => b.id === "IV-b").status, "ok", "别的区间不受影响");
    // a record imported after the review whose date falls inside / near the span
    const later = applyPlan(f.history, planImport(f.history, { batchId: "inc", items: [obs("O7", "2026-04-23 08:00:00", "今天好了")] }), { runId: "r2", at: "2026-09-22T00:00:00.000Z" });
    const p2 = buildHealthPage({ history: later, record: null, intervals: f.intervals, materials: f.materials, now: NOW });
    assert.equal(p2.bands.find((b) => b.id === "IV-a").status, "needs_review");
    assert.match(p2.bands.find((b) => b.id === "IV-a").statusReasons.join(), /新记录/);
    const far = applyPlan(f.history, planImport(f.history, { batchId: "inc2", items: [obs("O8", "2026-08-30 08:00:00", "今天挺好")] }), { runId: "r3", at: "2026-09-22T00:00:00.000Z" });
    assert.ok(buildHealthPage({ history: far, record: null, intervals: f.intervals, materials: f.materials, now: NOW }).bands.every((b) => b.status === "ok"), "离得远的新记录不影响");
    // the history ledger not connected at all: nothing is drawn red on trust
    const p3 = buildHealthPage({ history: null, record: null, intervals: f.intervals, materials: null, now: NOW });
    assert.ok(p3.bands.every((b) => b.status === "needs_review"));
    assert.equal(p3.followUp.status, "missing");
  } finally { await f.cleanup(); }
});

test("3 更新入口：新增 / 更正 / 撤销后页面随之变化；重放不重复；新记录让后续措施标为待更新", async () => {
  const f = await fixture();
  try {
    const root = path.join(f.dir, "record-root");
    const conf = loadHealthRecordConfig({ HEALTH_RECORD_ROOT: root, HEALTH_RECORD_SESSION_SECRET: "s".repeat(40), HEALTH_RECORD_MOM_PASSWORD: "mom-synthetic-pw", HEALTH_RECORD_DAD_PASSWORD: "dad-synthetic-pw", HEALTH_RECORD_COOKIE_SECURE: "0" }, "/elsewhere");
    assert.ok(conf.ok);
    let now = T0;
    const records = new HealthRecordService(root, { repo: conf.config.repo, now: () => now });
    const pages = new HealthPageService(records, { historyLedgerDir: f.histDir, originalRoots: [], intervalsFile: path.join(f.dir, "intervals.json"), materialsFile: path.join(f.dir, "materials.json"), problems: [] }, () => now);
    const before = await pages.page();
    assert.equal(before.followUp.status, "current");
    const body = { entryId: uid(), text: "今天又咳了几声", when: { mode: "date", date: "2026-09-20", precision: "day" }, symptoms: { temperature: "37.9" } };
    const made = await records.createNote("mom", body);
    const p1 = await pages.page();
    const n = p1.nodes.find((x) => x.date === "2026-09-20");
    assert.ok(n && n.entries.some((e) => e.id === made.record.id && e.kind === "fever" && /今天又咳了几声/.test(e.text)), "新记录马上出现在时间轴上");
    assert.equal(p1.followUp.status, "stale");
    assert.match(p1.followUp.staleReason, /9月20日/);
    const again = await records.createNote("mom", body);
    assert.equal(again.duplicate, true);
    assert.equal((await pages.page()).nodes.flatMap((x) => x.entries).filter((e) => e.id === made.record.id).length, 1, "原样重放不重复");
    await records.correct("mom", made.record.id, { requestId: uid(), expectedRevision: 1, edit: { text: "今天没有咳", symptoms: {} } });
    const p2 = await pages.page();
    const e2 = p2.nodes.flatMap((x) => x.entries).find((e) => e.id === made.record.id);
    assert.equal(e2.text, "今天没有咳", "更正后显示有效内容");
    assert.equal(e2.kind, "dot");
    await records.setAttribution("mom", made.record.id, { requestId: uid(), expectedRevision: 2, action: "void" });
    const p3 = await pages.page();
    assert.ok(!p3.nodes.flatMap((x) => x.entries).some((e) => e.id === made.record.id), "撤销归属后不再算孩子的记录");
    assert.equal(p3.followUp.status, "current");
  } finally { await f.cleanup(); }
});

test("4 访问保护：提醒与医院原件都要登录；原件只从允许的根目录、按记录的哈希提供；路径越界、换了内容都拒绝", async () => {
  const f = await fixture();
  try {
    const root = path.join(f.dir, "record-root");
    const conf = loadHealthRecordConfig({ HEALTH_RECORD_ROOT: root, HEALTH_RECORD_SESSION_SECRET: "s".repeat(40), HEALTH_RECORD_MOM_PASSWORD: "mom-synthetic-pw", HEALTH_RECORD_DAD_PASSWORD: "dad-synthetic-pw", HEALTH_RECORD_COOKIE_SECURE: "0" }, "/elsewhere");
    const handle = createHealthRecordHandler(() => conf, () => ({ now: () => T0 }), () => ({ historyLedgerDir: f.histDir, originalRoots: [f.allowed], intervalsFile: path.join(f.dir, "intervals.json"), materialsFile: path.join(f.dir, "materials.json"), problems: [] }));
    const call = async (method, p, { cookie, body } = {}) => {
      const h = { origin: ORIGIN }; if (cookie) h.cookie = cookie; if (body) h["content-type"] = "application/json";
      const res = await handle(new Request(`${ORIGIN}/api/health-record/${p}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), p.split("/").map(decodeURIComponent));
      return { status: res.status, headers: res.headers, text: Buffer.from(await res.arrayBuffer()) };
    };
    assert.equal((await call("GET", "reminders")).status, 401);
    assert.equal((await call("GET", "history-originals/doc%3A1")).status, 401);
    const login = await call("POST", "session", { body: { who: "mom", password: "mom-synthetic-pw" } });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const r = await call("GET", "reminders", { cookie });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text).items.map((x) => x.id), ["E2"]);
    assert.match(r.headers.get("cache-control"), /no-store/);
    const ok = await call("GET", "history-originals/doc%3A1", { cookie });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.text, f.good);
    assert.match(ok.headers.get("cache-control"), /no-store/);
    assert.equal((await call("GET", "history-originals/doc%3Aother-root", { cookie })).status, 404, "来源根目录不在允许列表");
    assert.equal((await call("GET", "history-originals/doc%3Atrav", { cookie })).status, 404, "相对路径越出根目录");
    assert.equal((await call("GET", "history-originals/E1", { cookie })).status, 404, "不是医院原件来源");
    await writeFile(path.join(f.allowed, "hosp", "a.jpg"), "tampered");
    assert.equal((await call("GET", "history-originals/doc%3A1", { cookie })).status, 404, "文件内容与记录的哈希不符就不提供");
    // configuration: inputs inside the repository are refused by name
    const cfg = loadPageSourcesConfig(path.resolve("."), { HEALTH_HISTORY_LEDGER: path.resolve("lib"), HEALTH_PAGE_INTERVALS: "relative.json" });
    assert.equal(cfg.historyLedgerDir, null);
    assert.equal(cfg.intervalsFile, null);
    assert.equal(cfg.problems.length, 2);
  } finally { await f.cleanup(); }
});

test("5 发热图标判断：读数 ≥37.5 或明确发热字样；否定、退烧、“以下”都不算", () => {
  for (const t of ["37.8", "39.4", "有点发烧", "小年年感冒了，有点发烧。"]) assert.equal(looksFeverish(t), true, t);
  for (const t of ["36.7", "降到 38 以下了", "烧彻底退了", "没发烧", "体温正常", "我们给宝贝量过体温也都正常哒"]) assert.equal(looksFeverish(t), false, t);
});
