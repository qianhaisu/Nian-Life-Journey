// HEALTH-04 health page: model rules, re-review triggers, the refresh path after new/corrected records, and the protected read APIs.
// All data is synthetic and lives in fresh temp directories; nothing touches a real ledger, original or database.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { applyCorrection, applyPlan, effectiveHash, planImport } from "../lib/health/ledger.ts";
import { emptyLedger, hashOf } from "../lib/health/model.ts";
import { HealthFileStore } from "../lib/health/file-store.ts";
import { buildHealthPage, exclusionReason, isHardExclusion, looksFeverish } from "../lib/health/page/model.ts";
import { Graph } from "../lib/health/graph.ts";
import { HealthPageService, loadPageSourcesConfig } from "../lib/health/page/service.ts";
import { loadHealthRecordConfig } from "../lib/health/record/config.ts";
import { createHealthRecordHandler } from "../lib/health/record/http.ts";
import { HealthRecordService } from "../lib/health/record/service.ts";

const ORIGIN = "http://health.test";
const T0 = Date.parse("2026-09-21T10:00:00+08:00");
const NOW = "2026-09-21T10:00";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const uid = (() => { let n = 0; return () => `pg${String(++n).padStart(6, "0")}${"y".repeat(12)}`; })();
const obs = (id, recordedAt, text, links = [], extra = {}) => ({ kind: "observation", id, content: { role: "observation", recordedAt, occurredAt: null, occurredPrecision: null, timeBasis: "message_time_only", text, speaker: "妈妈", factKind: "symptom_report", reviewStatus: "claude_full_read_r4", ...extra }, links });

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
    obs("O6", "2026-07-13 09:00:00", "他们家孩子也发烧了", [], { subject: "别人家的孩子" }), // explicitly someone else: never a node, whether or not it is attached
  ] };
  const plan = planImport(emptyLedger(), batch);
  assert.equal(plan.rejected, false, JSON.stringify(plan.items.filter((i) => i.action === "rejected")));
  const history = applyPlan(emptyLedger(), plan, { runId: "r1", at: "2026-09-20T00:00:00.000Z" });
  const histDir = path.join(dir, "history");
  await new HealthFileStore(histDir).transaction(() => ({ ledger: history, result: null }));
  const ref = (L, id, kind = "observation") => ({ ledger: "history", ref: { kind, id }, hash: effectiveHash(L, { kind, id }) });
  const stamps = Object.fromEntries(["EP-X", "EP-Y"].map((id) => [id, new Graph(history).closureHash({ kind: "episode", id })]));
  const intervals = { schema: 1, reviewedAt: "2026-09-21T00:00:00.000Z", reviewer: "test", nodes: [], episodeStamps: stamps,
    intervals: [
      { id: "IV-a", kind: "suspected", episodeId: null, start: "2026-04-22", end: "2026-04-24", endKind: "last_record", label: "鼻涕", reason: "「还是」承接", supports: [ref(history, "O1"), ref(history, "O2")], counter: [ref(history, "O3")] },
      { id: "IV-b", kind: "recorded", episodeId: "EP-X", start: "2026-07-10", startApprox: true, end: "2026-07-26", endKind: "last_record", label: "流涕咳嗽", reason: "原文写明", supports: [ref(history, "O5")] },
    ] };
  const SRC_HASH = sha(Buffer.from("synthetic reviewed plan"));
  const materials = { schema: 1, generatedAt: "2026-09-21T00:00:00Z", dataCutoff: "2026-09-19T10:19", reviewedBy: "test",
    items: [{ id: "m1", group: "visit", kind: "conditional", text: "呼吸明显费力时马上就医", source: { file: "x.md", sha256: SRC_HASH, section: "§1", lines: "1" }, version: "v", conditions: [], reassessWhen: [] },
      { id: "m2", group: "care", kind: "care", text: "规律供液", source: { file: "x.md", sha256: SRC_HASH, section: "§1", lines: "2" }, version: "v", conditions: [], reassessWhen: [], episodes: ["EP-X"] }] };
  const matRoot0 = path.join(dir, "materials-root"); await mkdir(matRoot0, { recursive: true }); await writeFile(path.join(matRoot0, "x.md"), "synthetic reviewed plan");
  await writeFile(path.join(dir, "intervals.json"), JSON.stringify(intervals));
  await writeFile(path.join(dir, "materials.json"), JSON.stringify(materials));
  return { dir, allowed, histDir, history, intervals, materials, good, SRC_HASH, matRoot: matRoot0, ok: () => SRC_HASH, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("1 模型：红色只来自核查区间；零散记录只是节点；没有绿色；就医记录不展示实际用药；提醒只有将来的预约", async () => {
  const f = await fixture();
  try {
    const p = buildHealthPage({ history: f.history, record: null, intervals: f.intervals, materials: f.materials, now: NOW, materialSourceHash: f.ok });
    assert.deepEqual(p.bands.map((b) => [b.id, b.kind, b.status]), [["IV-a", "suspected", "ok"], ["IV-b", "recorded", "ok"], ["open-EP-Y", "open", "ok"]]);
    const openY = p.bands.find((b) => b.id === "open-EP-Y");
    assert.equal(openY.start, openY.end, "结束未知的病程只在开始处画一个短渐隐，不给长度");
    assert.ok(!JSON.stringify(p).includes("green") && !/确认健康/.test(JSON.stringify(p)), "没有绿色、没有“确认健康”");
    const nodeDays = p.nodes.map((n) => n.date);
    assert.ok(nodeDays.includes("2026-04-22") && nodeDays.includes("2026-07-12") && nodeDays.includes("2026-07-26"));
    assert.ok(!nodeDays.includes("2026-07-13"), "说的是别人的记录不成为节点");
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
    const pages = new HealthPageService(records, { historyLedgerDir: f.histDir, originalRoots: [], intervalsFile: path.join(f.dir, "intervals.json"), materialsFile: path.join(f.dir, "materials.json"), materialRoot: f.matRoot, problems: [] }, () => now);
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

// ================= HEALTH-04-R1 =================
const addLater = (ledger, batchId, items, at = "2026-09-22T00:00:00.000Z") => applyPlan(ledger, planImport(ledger, { batchId, items }), { runId: batchId, at });

test("R1-A 本人未挂靠记录可见；别人、问句、AI 引用、日常闲聊不可见；覆盖表说明理由", async () => {
  const f = await fixture();
  try {
    const later = addLater(f.history, "new-own", [
      obs("N1", "2026-09-20 08:00:00", "孩子今天流鼻涕，确认是本人的新记录"),
      obs("N2", "2026-09-20 09:00:00", "他今天有咳嗽吗", [], { role: "question", factKind: "question" }),
      obs("N3", "2026-09-20 09:05:00", "六个月婴儿总是拿手抓头，可能是", [], { factKind: "ai_reference" }),
      obs("N4", "2026-09-20 09:10:00", "同事家孩子也发烧了", [], { subject: "同事的孩子" }),
      obs("N5", "2026-09-20 09:15:00", "今天天气不错，去公园玩了", [], { factKind: "observation" }),
      obs("N6", "2026-09-20 09:20:00", "记错孩子的发烧", [], { attribution: "not_child" }),
      obs("N7", "2026-09-20 09:25:00", "低烧没吃药", [], { role: "medication_not_given", factKind: "medication_not_given" }),
      obs("N8", "2026-09-20 09:30:00", "没有任何本人依据的一句话说他咳嗽", [], { reviewStatus: undefined }),
    ]);
    const p = buildHealthPage({ history: later, record: null, intervals: f.intervals, materials: f.materials, now: NOW });
    const shown = new Set(p.nodes.flatMap((n) => n.entries.map((e) => e.id)));
    assert.deepEqual(["N1", "N7"].map((i) => shown.has(i)), [true, true], "本人的未挂靠事实、未给药都可见");
    assert.deepEqual(["N2", "N3", "N4", "N5", "N6", "N8"].map((i) => shown.has(i)), [false, false, false, false, false, false]);
    assert.equal(p.nodes.find((n) => n.date === "2026-09-20").entries.find((e) => e.id === "N1").episode, null, "可见不等于挂靠病程");
    assert.equal(p.bands.some((b) => b.start === "2026-09-20"), false, "新记录只是节点，红色区间仍待核查、不自动生成");
    assert.equal(p.followUp.status, "stale");
    assert.ok(p.coverage.shownUnattached >= 3);
    assert.ok(p.coverage.excluded["标为不是孩子的记录"] >= 1 && p.coverage.excluded["主体是别人"] >= 1 && p.coverage.excluded["不是事实陈述（提问、计划、提醒等）"] >= 1);
    // identity and episode membership are separate questions
    assert.equal(exclusionReason({ role: "observation", factKind: "symptom_report", reviewStatus: "claude_full_read_r4", text: "x" }), null);
    assert.match(exclusionReason({ role: "observation", factKind: "symptom_report", text: "x" }), /没有本人依据/);
    assert.match(exclusionReason({ role: "observation", factKind: "observation", reviewStatus: "claude_full_read_r4", text: "今天去公园" }), /没有健康线索/);
  } finally { await f.cleanup(); }
});

test("R1-A 手记的睡眠、鼻音等有效字段不丢；无就诊号的医院事实有可达位置", async () => {
  const f = await fixture();
  try {
    const root = path.join(f.dir, "rec-root");
    const conf = loadHealthRecordConfig({ HEALTH_RECORD_ROOT: root, HEALTH_RECORD_SESSION_SECRET: "s".repeat(40), HEALTH_RECORD_MOM_PASSWORD: "mom-synthetic-pw", HEALTH_RECORD_DAD_PASSWORD: "dad-synthetic-pw" }, "/elsewhere");
    const records = new HealthRecordService(root, { repo: conf.config.repo, now: () => T0 });
    const made = await records.createNote("mom", { entryId: uid(), text: "夜里不好睡", when: { mode: "date", date: "2026-09-20", precision: "day" }, symptoms: { nasalVoice: true, sleep: ["夜醒多"], nose: "清鼻涕" } });
    const p = buildHealthPage({ history: f.history, record: await records.readLedger(), intervals: f.intervals, materials: f.materials, now: NOW });
    const e = p.nodes.flatMap((n) => n.entries).find((x) => x.id === made.record.id);
    assert.match(e.text, /有鼻音/); assert.match(e.text, /睡眠：夜醒多/); assert.match(e.text, /清鼻涕/);
    const withLoose = addLater(f.history, "loose", [{ kind: "canonical_fact", id: "CF-LOOSE", content: { type: "diagnosis", value: "急性鼻窦炎", structured: null }, links: [{ role: "documented_in", to: { kind: "source", id: "doc:1" } }] }]);
    const p2 = buildHealthPage({ history: withLoose, record: null, intervals: f.intervals, materials: f.materials, now: NOW });
    assert.deepEqual(p2.looseHospital.map((x) => [x.id, x.text, x.attachments.length]), [["CF-LOOSE", "急性鼻窦炎", 1]]);
  } finally { await f.cleanup(); }
});

test("R1-B 失效贯穿：区间、病程经过、病程要点、关联措施同时待核；历史更正与来源文件变化都触发", async () => {
  const f = await fixture();
  try {
    const v1 = sha(Buffer.from("v1"));
    const materials = { ...f.materials, items: f.materials.items.map((m) => ({ ...m, source: { ...m.source, file: "plan.md", sha256: v1 } })) };
    const base = buildHealthPage({ history: f.history, record: null, intervals: f.intervals, materials, now: NOW, materialSourceHash: () => v1 });
    assert.equal(base.followUp.status, "current");
    assert.ok(base.episodes.find((e) => e.id === "EP-X").course.every((c) => !c.review));
    const corrected = applyCorrection(f.history, { id: "c-b", type: "field", ref: { kind: "observation", id: "O5" }, changes: [{ field: "text", after: "更正：孩子没有流鼻涕，之前说的是大人" }], author: "妈妈", at: "2026-09-22T00:00", reason: "更正" }).ledger;
    const p = buildHealthPage({ history: corrected, record: null, intervals: f.intervals, materials, now: NOW, materialSourceHash: () => v1 });
    assert.equal(p.bands.find((b) => b.id === "IV-b").status, "needs_review");
    const ep = p.episodes.find((e) => e.id === "EP-X");
    assert.ok(ep.course.some((c) => /原文写明/.test(c.text) && /待重新核对/.test(c.review)), "病程经过里同一条断言带待核标识");
    assert.match(ep.summary.review, /待重新核对/, "病程要点同样标待核");
    assert.equal(p.followUp.status, "stale", "更正历史依据后措施不再是 current");
    const m2 = p.followUp.care.find((m) => m.id === "m2"), m1 = p.followUp.visit.find((m) => m.id === "m1");
    assert.match(m2.review, /关联的病程有区间待重新核对/);
    assert.equal(m1.review, null, "与该病程无关的通用危险信号不因此被撤下");
    assert.equal(m2.text, "规律供液", "旧内容保留，只是标待核");
    const changed = buildHealthPage({ history: f.history, record: null, intervals: f.intervals, materials, now: NOW, materialSourceHash: () => sha(Buffer.from("v2")) });
    assert.ok(changed.followUp.care.every((m) => /来源文件内容已变化/.test(m.review)) && changed.followUp.status === "stale");
    const gone = buildHealthPage({ history: f.history, record: null, intervals: f.intervals, materials, now: NOW, materialSourceHash: () => undefined });
    assert.ok(gone.followUp.visit.every((m) => /来源文件读不到/.test(m.review)));
  } finally { await f.cleanup(); }
});

test("R1-B 服务层：来源文件被改写后，重新读取即标待核；越出材料根目录的来源不读取", async () => {
  const f = await fixture();
  try {
    const matRoot = path.join(f.dir, "mat"); await mkdir(matRoot, { recursive: true });
    await writeFile(path.join(matRoot, "plan.md"), "plan v1");
    const m = { ...f.materials, items: f.materials.items.map((x) => ({ ...x, source: { ...x.source, file: "plan.md", sha256: sha(Buffer.from("plan v1")) } })) };
    await writeFile(path.join(f.dir, "materials.json"), JSON.stringify(m));
    const root = path.join(f.dir, "rec-root2");
    const conf = loadHealthRecordConfig({ HEALTH_RECORD_ROOT: root, HEALTH_RECORD_SESSION_SECRET: "s".repeat(40), HEALTH_RECORD_MOM_PASSWORD: "mom-synthetic-pw", HEALTH_RECORD_DAD_PASSWORD: "dad-synthetic-pw" }, "/elsewhere");
    const mk = () => new HealthPageService(new HealthRecordService(root, { repo: conf.config.repo, now: () => T0 }), { historyLedgerDir: f.histDir, originalRoots: [], intervalsFile: path.join(f.dir, "intervals.json"), materialsFile: path.join(f.dir, "materials.json"), materialRoot: matRoot, problems: [] }, () => T0);
    const svc = mk();
    assert.equal((await svc.page()).followUp.status, "current");
    await writeFile(path.join(matRoot, "plan.md"), "plan v2 edited");
    const after = await svc.page();
    assert.equal(after.followUp.status, "stale");
    assert.ok(after.followUp.care.every((x) => /来源文件内容已变化/.test(x.review)));
    await writeFile(path.join(f.dir, "outside.md"), "x");
    await writeFile(path.join(f.dir, "materials.json"), JSON.stringify({ ...m, items: m.items.map((x) => ({ ...x, source: { ...x.source, file: "../outside.md" } })) }));
    assert.ok((await mk().page()).followUp.care.every((x) => /来源文件读不到/.test(x.review)));
  } finally { await f.cleanup(); }
});

test("R1-C 恢复说法：不能确归则不作结束依据，但作为待定关联显示；能确归才延长结束；入托来源被改后失效", async () => {
  const f = await fixture();
  try {
    const rec = (over = {}) => ({ id: "D-r", date: "2026-04-25", who: "爸爸", nature: "recovery", disposition: "pending_link", intervalId: "IV-a", text: "病好了", source: { conversation: "私聊", at: "2026-04-25 21:00:00", textSha256: "0".repeat(64) }, context: "上下文没有明说指哪件事", ...over });
    const der = (r) => ({ schema: 1, reviewedAt: "2026-09-21T00:00:00Z", records: [r] });
    const pending = buildHealthPage({ history: f.history, record: null, intervals: f.intervals, materials: f.materials, derived: der(rec()), now: NOW });
    const a = pending.bands.find((b) => b.id === "IV-a");
    assert.equal(a.end, "2026-04-24", "不能确归：结束不变");
    assert.ok(a.counter.some((c) => /待定关联/.test(c.text) && /私聊 2026-04-25/.test(c.text)) && !a.supports.some((s) => s.id === "D-r"), "作为反证/待定关联显示，没有省略");
    const linked = buildHealthPage({ history: f.history, record: null, intervals: f.intervals, materials: f.materials, derived: der(rec({ disposition: "end_evidence" })), now: NOW });
    const b = linked.bands.find((x) => x.id === "IV-a");
    assert.equal(b.end, "2026-04-25"); assert.equal(b.endFromDerived, true); assert.match(b.timeNote, /派生层/);
    assert.ok(b.supports.some((s) => s.id === "D-r"));
    const en = { date: "2026-02-24", basis: "两条原文互证", parentConfirmed: false, sources: [{ ledger: "derived", ref: { kind: "observation", id: "D-r" }, hash: hashOf(rec()) }] };
    const ok = buildHealthPage({ history: f.history, record: null, intervals: { ...f.intervals, enrolment: en }, materials: f.materials, derived: der(rec()), now: NOW });
    assert.equal(ok.enrolment.status, "ok");
    const changed = buildHealthPage({ history: f.history, record: null, intervals: { ...f.intervals, enrolment: en }, materials: f.materials, derived: der(rec({ text: "被更正过" })), now: NOW });
    assert.equal(changed.enrolment.status, "needs_review"); assert.match(changed.enrolment.note, /待重新核对/);
    const removed = buildHealthPage({ history: f.history, record: null, intervals: { ...f.intervals, enrolment: en }, materials: f.materials, derived: null, now: NOW });
    assert.equal(removed.enrolment.status, "needs_review");
    const cor = applyCorrection(f.history, { id: "c-e", type: "field", ref: { kind: "observation", id: "O1" }, changes: [{ field: "text", after: "更正" }], author: "妈妈", at: "2026-09-22T00:00", reason: "x" }).ledger;
    const enL = { date: "2026-02-24", basis: "x", parentConfirmed: true, sources: [{ ledger: "history", ref: { kind: "observation", id: "O1" }, hash: effectiveHash(f.history, { kind: "observation", id: "O1" }) }] };
    assert.equal(buildHealthPage({ history: f.history, record: null, intervals: { ...f.intervals, enrolment: enL }, materials: f.materials, now: NOW }).enrolment.status, "ok");
    assert.equal(buildHealthPage({ history: cor, record: null, intervals: { ...f.intervals, enrolment: enL }, materials: f.materials, now: NOW }).enrolment.status, "needs_review");
  } finally { await f.cleanup(); }
});

// ================= HEALTH-04-R1 定点补正 =================
test("R1F-1 当前的身份/角色更正优先于旧审核引用：区间依据更正成别人的、或改成提问后，不再生成孩子的时间轴节点", async () => {
  const f = await fixture();
  try {
    const base = buildHealthPage({ history: f.history, record: null, intervals: f.intervals, materials: f.materials, now: NOW, materialSourceHash: f.ok });
    assert.ok(base.nodes.flatMap((n) => n.entries).some((e) => e.id === "O5"), "更正前，O5 是被区间引用的孩子记录");
    for (const [name, changes] of [
      ["主体改成别人", [{ field: "subject", after: "other_child" }]],
      ["角色改成提问", [{ field: "role", after: "question" }]],
      ["同时更正", [{ field: "subject", after: "other_child" }, { field: "role", after: "question" }]],
      ["标为不是孩子", [{ field: "attribution", after: "not_child" }]],
    ]) {
      const changed = applyCorrection(f.history, { id: `c-${name}`, type: "field", ref: { kind: "observation", id: "O5" }, changes, author: "妈妈", at: "2026-09-22T00:00", reason: name }).ledger;
      const p = buildHealthPage({ history: changed, record: null, intervals: f.intervals, materials: f.materials, now: NOW, materialSourceHash: f.ok });
      assert.equal(p.nodes.flatMap((n) => n.entries).some((e) => e.id === "O5"), false, `${name}：不能再显示为孩子的事实节点`);
      assert.equal(p.bands.find((b) => b.id === "IV-b").status, "needs_review", `${name}：区间同时待核，旧引用只留在历史依据里`);
      assert.ok(p.bands.find((b) => b.id === "IV-b").supports.some((s) => s.id === "O5"), "旧依据仍可见，供核对");
      assert.ok(p.coverage.excluded["主体是别人"] || p.coverage.excluded["不是事实陈述（提问、计划、提醒等）"] || p.coverage.excluded["标为不是孩子的记录"], `${name}：覆盖表里记为排除`);
    }
    // soft classification may still be rescued by a review reference; hard ones may not
    assert.equal(isHardExclusion({ role: "observation", subject: "other_child" }), true);
    assert.equal(isHardExclusion({ role: "question" }), true);
    assert.equal(isHardExclusion({ role: "observation", factKind: "observation", text: "今天去公园" }), false);
    // and the fixed behaviours stay: an own unattached record is still visible
    const later = addLater(f.history, "own-again", [obs("N-own", "2026-09-20 08:00:00", "孩子今天流鼻涕")]);
    assert.ok(buildHealthPage({ history: later, record: null, intervals: f.intervals, materials: f.materials, now: NOW, materialSourceHash: f.ok }).nodes.flatMap((n) => n.entries).some((e) => e.id === "N-own"));
  } finally { await f.cleanup(); }
});

test("R1F-2a 医院事实更正：总结与关联措施待核，不只依赖红色区间", async () => {
  const f = await fixture();
  try {
    const args = (h) => ({ history: h, record: null, intervals: f.intervals, materials: f.materials, now: NOW, materialSourceHash: f.ok });
    const base = buildHealthPage(args(f.history));
    assert.equal(base.followUp.status, "current"); assert.equal(base.episodes.find((e) => e.id === "EP-X").summary.review, null);
    const cor = (ref, field, after, id) => applyCorrection(f.history, { id, type: "field", ref, changes: [{ field, after }], author: "妈妈", at: "2026-09-22T00:00", reason: "更正" }).ledger;
    // the corrected diagnosis of the linked hospital visit (no interval involved)
    const p = buildHealthPage(args(cor({ kind: "canonical_fact", id: "CF1" }, "value", "原诊断录入有误，待重新核对", "c-cf1")));
    assert.ok(p.bands.every((b) => b.status === "ok"), "区间本身没有失效，证明不是靠红色区间判断");
    const ep = p.episodes.find((e) => e.id === "EP-X");
    assert.match(ep.summary.review, /待重新核对/); assert.match(ep.summary.review, /医院事实|就诊|来源|成员/);
    assert.equal(ep.summary.points[0], "7/26 诊断急性支气管炎", "旧论断保留，只是标待核");
    assert.match(p.followUp.care.find((m) => m.id === "m2").review, /底账有变化/);
    assert.equal(p.followUp.visit.find((m) => m.id === "m1").review, null, "无关的通用危险信号不因此撤下");
    assert.equal(p.followUp.status, "stale");
    // other hospital-side changes: the encounter itself, and a visit source revision
    for (const [ref, field, after, id] of [[{ kind: "encounter", id: "E1" }, "dept", "耳鼻喉科", "c-e1"], [{ kind: "canonical_fact", id: "CF2" }, "value", "另一种口服液", "c-cf2"]]) {
      const q = buildHealthPage(args(cor(ref, field, after, id)));
      assert.match(q.episodes.find((e) => e.id === "EP-X").summary.review ?? "", /待重新核对/, `${id} 触发`);
    }
    // an unrelated episode is not touched
    assert.equal(p.episodes.find((e) => e.id === "EP-Y").summary.review, null);
    // a new record attached to the episode also holds its summary until re-reviewed
    const grown = addLater(f.history, "grow", [obs("N9", "2026-07-30 08:00:00", "还在咳", [{ role: "attached", to: { kind: "episode", id: "EP-X" } }])]);
    assert.match(buildHealthPage(args(grown)).episodes.find((e) => e.id === "EP-X").summary.review ?? "", /待重新核对/);
    // a review file without stamps never claims the summary is verified
    const noStamp = buildHealthPage({ ...args(f.history), intervals: { ...f.intervals, episodeStamps: undefined } });
    assert.match(noStamp.episodes.find((e) => e.id === "EP-X").summary.review ?? "", /还没有记录核对时的底账版本/);
  } finally { await f.cleanup(); }
});

test("R1F-2b 来源核验缺失、不可读、哈希无效时不标 current；通用护理仍显示；服务层未配置根目录也一样", async () => {
  const f = await fixture();
  try {
    const p0 = (extra) => buildHealthPage({ history: f.history, record: null, intervals: f.intervals, materials: f.materials, now: NOW, ...extra });
    // 1 no checker at all (root not configured)
    const none = p0({});
    assert.equal(none.followUp.status, "stale");
    assert.ok([...none.followUp.care, ...none.followUp.visit].every((m) => /来源核验没有配置/.test(m.review)));
    assert.deepEqual(none.followUp.care.map((m) => m.text), ["规律供液"], "通用护理仍显示，没有整体撤下");
    // 2 checker present but the file is unreadable
    assert.ok(p0({ materialSourceHash: () => undefined }).followUp.visit.every((m) => /来源文件读不到/.test(m.review)));
    // 3 malformed recorded hash (including the old "0" placeholder) can never be treated as verified
    for (const bad of ["0", "", "abc", "Z".repeat(64), null]) {
      const mat = { ...f.materials, items: f.materials.items.map((m) => ({ ...m, source: { ...m.source, sha256: bad } })) };
      const p = buildHealthPage({ history: f.history, record: null, intervals: f.intervals, materials: mat, now: NOW, materialSourceHash: () => bad ?? undefined });
      assert.equal(p.followUp.status, "stale", `哈希 ${JSON.stringify(bad)}`);
      assert.ok(p.followUp.care.every((m) => /哈希格式无效/.test(m.review)));
    }
    // 4 verified and matching: current, no notes
    const ok = p0({ materialSourceHash: f.ok });
    assert.equal(ok.followUp.status, "current"); assert.ok([...ok.followUp.care, ...ok.followUp.visit].every((m) => m.review === null));
    // 5 the service without HEALTH_PAGE_MATERIAL_ROOT, using a valid 64-hex hash whose source file cannot be read
    const root = path.join(f.dir, "rec-root-x");
    const conf = loadHealthRecordConfig({ HEALTH_RECORD_ROOT: root, HEALTH_RECORD_SESSION_SECRET: "s".repeat(40), HEALTH_RECORD_MOM_PASSWORD: "mom-synthetic-pw", HEALTH_RECORD_DAD_PASSWORD: "dad-synthetic-pw" }, "/elsewhere");
    const mk = (materialRoot) => new HealthPageService(new HealthRecordService(root, { repo: conf.config.repo, now: () => T0 }), { historyLedgerDir: f.histDir, originalRoots: [], intervalsFile: path.join(f.dir, "intervals.json"), materialsFile: path.join(f.dir, "materials.json"), materialRoot, problems: [] }, () => T0);
    const noRoot = await mk(null).page();
    assert.equal(noRoot.followUp.status, "stale"); assert.ok(noRoot.followUp.care.every((m) => /来源核验没有配置/.test(m.review)));
    const withRoot = await mk(f.matRoot).page();
    assert.equal(withRoot.followUp.status, "current", "配置了根目录且哈希一致才算已核验");
    const emptyRoot = path.join(f.dir, "empty-root"); await mkdir(emptyRoot, { recursive: true });
    const missing = await mk(emptyRoot).page();
    assert.ok(missing.followUp.care.every((m) => /来源文件读不到/.test(m.review)), "根目录里没有源文件：读不到，不是 current");
  } finally { await f.cleanup(); }
});

test("4b 部署时的原件目录映射：账本记录的根目录不改，映射到服务器目录后仍按允许列表、包含关系和 SHA-256 提供", async () => {
  const f = await fixture();
  try {
    const served = path.join(f.dir, "served"); await mkdir(path.join(served, "hosp"), { recursive: true });
    await writeFile(path.join(served, "hosp", "a.jpg"), f.good);
    const conf = loadHealthRecordConfig({ HEALTH_RECORD_ROOT: path.join(f.dir, "rr"), HEALTH_RECORD_SESSION_SECRET: "s".repeat(40), HEALTH_RECORD_MOM_PASSWORD: "mom-synthetic-pw", HEALTH_RECORD_DAD_PASSWORD: "dad-synthetic-pw" }, "/elsewhere");
    const svc = (cfg) => new HealthPageService(new HealthRecordService(path.join(f.dir, "rr"), { repo: conf.config.repo, now: () => T0 }), { historyLedgerDir: f.histDir, intervalsFile: null, materialsFile: null, problems: [], ...cfg }, () => T0);
    // the recorded root (f.allowed) is NOT served directly any more; only the mapped server directory is
    const mapped = svc({ originalRoots: [served], originalRootMap: [{ from: f.allowed, to: served }] });
    assert.deepEqual((await mapped.historyOriginal("doc:1"))?.data, f.good);
    assert.equal(await svc({ originalRoots: [served], originalRootMap: [] }).historyOriginal("doc:1"), null, "没有映射：记录的根目录不在允许列表");
    assert.equal(await mapped.historyOriginal("doc:other-root"), null, "另一个根目录没有映射");
    await writeFile(path.join(served, "hosp", "a.jpg"), "tampered");
    assert.equal(await mapped.historyOriginal("doc:1"), null, "内容与记录的哈希不符不提供");
    // env parsing: pairs are "<recorded root>=<absolute dir>", a target inside the repo or a relative one is refused by name
    const P1 = String.raw`C:\Users\x\Pictures`, P2 = String.raw`E:\WechatHis\texts`;
    const ok = loadPageSourcesConfig("/elsewhere-repo", { HEALTH_HISTORY_ORIGINAL_ROOT_MAP: `${P1}=${served};${P2}=${served}` });
    assert.deepEqual(ok.originalRootMap.map((m) => m.from), [P1, P2]);
    assert.ok(ok.originalRoots.length >= 1 && ok.problems.length === 0);
    const bad = loadPageSourcesConfig(path.resolve("."), { HEALTH_HISTORY_ORIGINAL_ROOT_MAP: `${P1}=relative/dir;${P2}=${path.resolve("lib")}` });
    assert.equal(bad.originalRootMap.length, 0); assert.equal(bad.problems.length, 2);
  } finally { await f.cleanup(); }
});
