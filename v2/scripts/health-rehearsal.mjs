// Health module incremental rehearsal (launch check). Everything is SYNTHETIC and lives in a fresh temp directory:
// no real ledger, original, analysis or credential is read, and nothing here can reach the live data. Every review record it
// writes is labelled 演练 (rehearsal). Run from v2/:  node --import tsx scripts/health-rehearsal.mjs [outDir]
//   1 a parent note (through the real HTTP handler, login included) and a WeChat increment arrive: new content and unassigned leads are
//     visible, excluded records are not, and replaying the same inputs adds nothing
//   2 a cited fact is corrected: the analysis that rests on it is held for re-review
//   3 a synthetic new analysis version goes draft -> submit -> adopt -> the page updates, the unrelated episode does not change
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HealthFileStore } from "../lib/health/file-store.ts";
import { runCorrection, runImport } from "../lib/health/importer.ts";
import { applyPlan, planImport } from "../lib/health/ledger.ts";
import { emptyLedger } from "../lib/health/model.ts";
import { AnalysisRefused, addDraft, adopt, emptyAnalyses, submit } from "../lib/health/page/analysis.ts";
import { evidenceResolverFromFile } from "../lib/health/page/evidence.ts";
import { computeImpact, makeBaseline } from "../lib/health/page/impact.ts";
import { HealthPageService } from "../lib/health/page/service.ts";
import { loadHealthRecordConfig } from "../lib/health/record/config.ts";
import { createHealthRecordHandler } from "../lib/health/record/http.ts";
import { HealthRecordService } from "../lib/health/record/service.ts";
import { adaptMessagesJson } from "./health-import/message-adapters.mjs";

const OUT = process.argv[2] ? path.resolve(process.argv[2]) : null;
const dir = mkdtempSync(path.join(os.tmpdir(), "health-rehearsal-"));
const REHEARSAL = "演练（合成，非真实审核）";
const ORIGIN = "https://rehearsal.invalid";
const NOW = Date.parse("2026-09-22T10:00:00+08:00");
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const obs = (id, recordedAt, text, links = [], extra = {}) => ({ kind: "observation", id, content: { role: "observation", recordedAt, occurredAt: null, occurredPrecision: null, timeBasis: "message_time_only", text, speaker: "妈妈", factKind: "symptom_report", reviewStatus: "claude_full_read_r4", ...extra }, links });
const att = (ep) => [{ role: "attached", to: { kind: "episode", id: ep } }];

try {
  // ---------- synthetic data ----------
  const base = { batchId: "演练-基线", items: [
    { kind: "encounter", id: "E1", content: { kind: "visit", date: "2026-09-10", hospital: "演练医院", dept: "呼吸内科" } },
    { kind: "canonical_fact", id: "CF1", content: { type: "diagnosis", value: "急性支气管炎", structured: null }, links: [{ role: "of_encounter", to: { kind: "encounter", id: "E1" } }] },
    { kind: "episode", id: "EP-R1", content: { title: "演练病程 A：咳嗽", start: "2026-09-08", declaredEnd: "end_unknown", keyFindings: ["9/10 诊断急性支气管炎"] }, links: [{ role: "encounter", to: { kind: "encounter", id: "E1" } }] },
    { kind: "episode", id: "EP-R2", content: { title: "演练病程 B：鼻炎", start: "2026-05-23", declaredEnd: "end_unknown", keyFindings: ["5/23 鼻炎"] } },
    obs("R-O1", "2026-09-08 09:00:00", "咳嗽", att("EP-R1")), obs("R-O2", "2026-05-23 09:00:00", "鼻塞", att("EP-R2")),
  ] };
  const plan = planImport(emptyLedger(), base);
  if (plan.rejected) throw new Error("synthetic base rejected");
  const histDir = path.join(dir, "history");
  const hist = new HealthFileStore(histDir);
  await hist.transaction(() => ({ ledger: applyPlan(emptyLedger(), plan, { runId: "rehearsal-base", at: "2026-09-20T00:00:00.000Z" }), result: null }));

  const evDir = path.join(dir, "evidence"); mkdirSync(evDir, { recursive: true });
  const txt = "synthetic rehearsal guideline text"; writeFileSync(path.join(evDir, "t.txt"), txt);
  const REG = path.join(evDir, "register.json");
  writeFileSync(REG, JSON.stringify({ schema: 1, sources: [{ id: "EV-R", title: "演练证据", version: "演练", localText: "t.txt", textSha256: sha(txt), status: "current" }] }));
  const evidence = () => evidenceResolverFromFile(REG);
  const body = (over = {}) => ({ dataAsOf: "2026-09-10", episodeLastRecord: "2026-09-10", summary: ["演练：合成分析正文。"], layers: [{ level: "doctor", text: "演练：9/10 诊断急性支气管炎。" }], uncertain: ["演练：结束未知"], impact: "演练：无真实含义。", currentStatus: "演练：截至 9 月 10 日的合成资料，不代表现在。",
    measures: [{ id: "m1", group: "care", kind: "care", text: "演练：继续记录咳嗽", conditions: ["演练条件"], reassessWhen: [], evidenceIds: ["EV-R"] }], factRefs: [{ ledger: "history", ref: { kind: "canonical_fact", id: "CF1" } }], evidenceIds: ["EV-R"], ...over });
  const analysesFile = path.join(dir, "analyses.json");
  let an = emptyAnalyses();
  const L0 = { history: await hist.read(), record: null };
  for (const ep of ["EP-R1", "EP-R2"]) {
    const b = ep === "EP-R1" ? body() : body({ dataAsOf: "2026-05-23", episodeLastRecord: "2026-05-23", summary: ["演练：另一病程的合成正文。"], factRefs: [{ ledger: "history", ref: { kind: "observation", id: "R-O2" } }] });
    an = addDraft(an, L0, { episodeId: ep, author: REHEARSAL, at: "t0", body: b, evidence: evidence() }).file;
    an = submit(an, L0, { id: `AV-${ep}-1`, by: REHEARSAL, at: "t1", evidence: evidence() });
    an = adopt(an, L0, { id: `AV-${ep}-1`, by: REHEARSAL, at: "t2", basis: "演练：合成基线采用，不是真实审核", evidence: evidence() });
  }
  writeFileSync(analysesFile, JSON.stringify(an));

  const recRoot = path.join(dir, "record-root");
  const conf = loadHealthRecordConfig({ HEALTH_RECORD_ROOT: recRoot, HEALTH_RECORD_SESSION_SECRET: "r".repeat(48), HEALTH_RECORD_MOM_PASSWORD: "rehearsal-mom-pw", HEALTH_RECORD_DAD_PASSWORD: "rehearsal-dad-pw" }, "/elsewhere");
  if (!conf.ok) throw new Error(conf.reason);
  let now = NOW;
  const sources = { historyLedgerDir: histDir, originalRoots: [], intervalsFile: null, materialsFile: null, derivedFile: null, analysesFile, evidenceFile: REG, problems: [] };
  const handle = createHealthRecordHandler(() => conf, () => ({ now: () => now }), () => sources);
  const records = new HealthRecordService(recRoot, { repo: conf.config.repo, now: () => now });
  const pages = new HealthPageService(records, sources, () => now);
  const call = async (method, p, { cookie, body: b } = {}) => {
    const h = { origin: ORIGIN, host: "rehearsal.invalid" }; if (cookie) h.cookie = cookie; if (b) h["content-type"] = "application/json";
    const res = await handle(new Request(`${ORIGIN}/api/health-record/${p}`, { method, headers: h, body: b ? JSON.stringify(b) : undefined }), p.split("/"));
    return { status: res.status, headers: res.headers, json: JSON.parse(Buffer.from(await res.arrayBuffer()).toString("utf8") || "{}") };
  };
  const ep = (p, id) => p.episodes.find((e) => e.id === id);
  const before = await pages.page();
  const baseline = makeBaseline({ history: await hist.read(), record: await records.readLedger() }, "2026-09-21T00:00:00Z");

  // ---------- 1 increment ----------
  check("演练前：两个合成病程都有已采用的分析", !!ep(before, "EP-R1").summary.analysis && !!ep(before, "EP-R2").summary.analysis && ep(before, "EP-R1").summary.analysis.review === null);
  check("未登录：写入被拒绝，不读不写", (await call("POST", "entries", { body: { type: "note", entryId: "x".repeat(30), text: "x" } })).status === 401);
  const login = await call("POST", "session", { body: { who: "mom", password: "rehearsal-mom-pw" } });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  check("妈妈登录（合成密码）成功", login.status === 200 && !!cookie);
  const note = { type: "note", entryId: `rh${"0".repeat(20)}note1`, text: "演练：今天又咳了几声", when: { mode: "date", date: "2026-09-21", precision: "day" }, symptoms: { temperature: "37.9" } };
  const n1 = await call("POST", "entries", { cookie, body: note });
  const n2 = await call("POST", "entries", { cookie, body: note });
  check("新增一条爸妈手记；同一请求重放不产生第二条", n1.status === 200 && n2.status === 200 && n1.json.record?.id === n2.json.record?.id && (await records.readLedger()) && Object.values((await records.readLedger()).entities).filter((e) => e.kind === "observation").length === 1);
  const inc = { batchId: "演练-微信增量", items: [
    obs("R-N1", "2026-09-21 08:00:00", "今天还咳嗽，鼻涕多"),                                             // own, unassigned, close to episode A
    obs("R-N2", "2026-09-21 08:05:00", "别人家孩子也咳", [], { subject: "别人家的孩子" }),               // someone else: never a symptom
    obs("R-N3", "2026-09-21 08:10:00", "要不要带去医院？", [], { role: "question" }),                    // a question: never a symptom
  ] };
  const msgs = adaptMessagesJson(JSON.stringify({ session: { wxid: "rehearsal-conv" }, messages: [{ createTime: "2026-09-21 08:00:00", senderDisplayName: "妈妈", content: "今天还咳嗽，鼻涕多" }] }), { conversation: "rehearsal-conv", batchId: "演练-消息来源" });
  const r1 = await runImport(hist, inc, { apply: true }), r2 = await runImport(hist, inc, { apply: true });
  const s1 = await runImport(hist, msgs.batch, { apply: true }), s2 = await runImport(hist, msgs.batch, { apply: true });
  check("微信增量：首次新增 3 条观察，重放全部识别为重复、没有新增", r1.counts.new === 3 && r2.counts.new === 0 && r2.counts.duplicate === 3, `first new=${r1.counts.new}; replay new=${r2.counts.new} dup=${r2.counts.duplicate}`);
  check("微信原消息只作来源：重放不重复", s1.counts.new === 1 && s2.counts.new === 0);
  const p1 = await pages.page();
  const entries = p1.nodes.flatMap((n) => n.entries);
  check("页面：新手记出现在时间轴；本人未归属的微信记录可见（不计入病程）", entries.some((e) => e.id === n1.json.record.id && /演练：今天又咳了几声/.test(e.text)) && entries.some((e) => e.id === "R-N1" && !e.episode));
  check("页面：说的是别人、提问的记录不成为孩子的症状", !entries.some((e) => ["R-N2", "R-N3"].includes(e.id)));
  const H1 = await hist.read(), R1 = await records.readLedger();
  const imp = computeImpact({ history: H1, record: R1 }, an, baseline, "2026-09-22T10:00", evidence());
  check("影响识别：未归属线索被列出并给出邻近病程，不自动归属；被排除的记录有理由", imp.leads.some((l) => l.id === "R-N1" && l.near.some((x) => x.episodeId === "EP-R1")) && imp.leads.some((l) => l.ledger === "record") && Object.values(imp.excluded).flat().includes("R-N2") && Object.values(imp.excluded).flat().includes("R-N3"), `${imp.leads.length} leads`);
  const imp2 = computeImpact({ history: await hist.read(), record: await records.readLedger() }, an, baseline, "2026-09-22T10:00", evidence());
  check("重放后影响清单不变（不增殖）", imp2.digest === imp.digest);
  check("新增不改变已采用分析（未归属记录不改变病程依赖）", ep(p1, "EP-R1").summary.analysis.review === null && ep(p1, "EP-R2").summary.analysis.review === null);

  // ---------- 2 correction ----------
  const c = await runCorrection(hist, { id: "rehearsal-corr-1", type: "field", ref: { kind: "canonical_fact", id: "CF1" }, changes: [{ field: "value", after: "演练：更正后的诊断" }], author: REHEARSAL, at: "2026-09-22T09:00", reason: "演练：更正一个已引用的事实" }, { apply: true });
  const p2 = await pages.page();
  check("更正一个已引用事实：关联分析待核，措施同步待核", !!c && /待重新核对/.test(ep(p2, "EP-R1").summary.analysis.review ?? "") && p2.followUp.care.filter((m) => m.id.startsWith("AV-EP-R1")).every((m) => /待重新核对/.test(m.review ?? "")));
  check("更正后：无关病程不受影响", JSON.stringify(ep(p2, "EP-R2")) === JSON.stringify(ep(p1, "EP-R2")));

  // ---------- 3 new version -> adopt ----------
  const L2 = { history: await hist.read(), record: await records.readLedger() };
  let refused = false;
  try { adopt(an, L2, { id: "AV-EP-R1-1", by: REHEARSAL, at: "t9", basis: "演练", evidence: evidence() }); } catch (e) { refused = e instanceof AnalysisRefused; }
  check("旧版本在依赖已变后不能再次采用", refused);
  let an2 = addDraft(an, L2, { episodeId: "EP-R1", author: REHEARSAL, at: "t3", body: body({ summary: ["演练：按更正后的事实重写的合成正文。"], dataAsOf: "2026-09-21" }), evidence: evidence() }).file;
  an2 = submit(an2, L2, { id: "AV-EP-R1-2", by: REHEARSAL, at: "t4", evidence: evidence() });
  const impMid = computeImpact(L2, an2, makeBaseline(L2, "2026-09-22T00:00:00Z"), "2026-09-22T10:00", evidence());
  check("待审核期间：新基线也不遮住正在展示的旧版待核", impMid.affectedEpisodes.some((a) => a.episodeId === "EP-R1" && a.analyses.some((x) => x.role === "displayed" && x.shown === "expired")));
  an2 = adopt(an2, L2, { id: "AV-EP-R1-2", by: REHEARSAL, at: "t5", basis: "演练：合成审核采用，不是真实审核", evidence: evidence() });
  writeFileSync(analysesFile, JSON.stringify(an2));
  const p3 = await pages.page();
  check("采用后页面更新：显示新版、待核提示消失", /按更正后的事实重写/.test(ep(p3, "EP-R1").summary.analysis.paragraphs.join("")) && ep(p3, "EP-R1").summary.analysis.review === null && /演练/.test(ep(p3, "EP-R1").summary.analysis.adoptedBy));
  check("采用后：无关病程的分析与页面内容不变", JSON.stringify(ep(p3, "EP-R2")) === JSON.stringify(ep(p1, "EP-R2")));
  check("采用记录明确标为演练；真实数据未被读取（全部在临时目录）", an2.versions.every((v) => v.events.every((e) => /演练/.test(e.by))) && dir.startsWith(os.tmpdir()));
  const impEnd = computeImpact(L2, an2, makeBaseline(L2, "2026-09-22T00:00:00Z"), "2026-09-22T10:00", evidence());
  check("完成复核后影响清单里没有待处理的病程", impEnd.affectedEpisodes.length === 0);
} catch (e) {
  check("演练脚本运行", false, String(e?.stack ?? e).slice(0, 400));
} finally {
  if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(path.join(OUT, "rehearsal-results.json"), JSON.stringify({ at: new Date().toISOString(), note: "全部合成数据；审核记录均标演练", results }, null, 1)); }
  rmSync(dir, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
