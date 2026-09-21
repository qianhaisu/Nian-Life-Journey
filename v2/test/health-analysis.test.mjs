// HEALTH-M01-A: per-episode analysis versions, adoption/expiry, impact identification and the page reading them.
// All data is synthetic in fresh temp directories; no real ledger, original, database or network is touched.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { applyCorrection, applyPlan, effectiveHash, planImport } from "../lib/health/ledger.ts";
import { emptyLedger, hashOf as _hash } from "../lib/health/model.ts";
import { HealthFileStore } from "../lib/health/file-store.ts";
import { buildHealthPage as _build, categoryOf } from "../lib/health/page/model.ts";
import { AnalysisRefused, addDraft as _addDraft, adopt as _adopt, emptyAnalyses, reject, stateOf as _stateOf, submit as _submit } from "../lib/health/page/analysis.ts";
import { evidenceResolverFromFile } from "../lib/health/page/evidence.ts";
import { computeImpact as _impact, makeBaseline } from "../lib/health/page/impact.ts";
import { main } from "../scripts/health-import/cli.mjs";

const NOW = "2026-09-21T10:00";
// local medical-evidence register with the saved texts that were "read" (synthetic): the analyses are bound to these entries
const EVDIR = mkdtempSync(path.join(os.tmpdir(), "health-evidence-"));
const shaHex = (b) => createHash("sha256").update(b).digest("hex");
const REG = path.join(EVDIR, "register.json");
function writeRegister(over = {}) {
  const t1 = "synthetic guideline text one", t2 = "synthetic guideline text two";
  writeFileSync(path.join(EVDIR, "t1.txt"), t1); writeFileSync(path.join(EVDIR, "t2.txt"), t2);
  writeFileSync(REG, JSON.stringify({ schema: 1, sources: [{ id: "EV-1", title: "T1", version: "2026", localText: "t1.txt", textSha256: shaHex(t1) }, { id: "EV-2", title: "T2", version: "2026", localText: "t2.txt", textSha256: shaHex(t2) }], ...over }));
}
writeRegister();
const EV = () => evidenceResolverFromFile(REG);
const addDraft = (f, L, a) => _addDraft(f, L, { evidence: EV(), ...a });
const submit = (f, L, a) => _submit(f, L, { evidence: EV(), ...a });
const adopt = (f, L, a) => _adopt(f, L, { evidence: EV(), ...a });
const stateOf = (L, v) => _stateOf(L, v, EV());
const buildHealthPage = (i) => _build({ evidence: EV(), ...i });
const computeImpact = (s, an, base, asOf) => _impact(s, an, base, asOf, EV());
const obs = (id, recordedAt, text, links = [], extra = {}) => ({ kind: "observation", id, content: { role: "observation", recordedAt, occurredAt: null, occurredPrecision: null, timeBasis: "message_time_only", text, speaker: "妈妈", factKind: "symptom_report", reviewStatus: "claude_full_read_r4", ...extra }, links });
const later = (L, id, items, at = "2026-09-22T00:00:00.000Z") => applyPlan(L, planImport(L, { batchId: id, items }), { runId: id, at });

function base() {
  const batch = { batchId: "syn", items: [
    { kind: "encounter", id: "E1", content: { kind: "visit", date: "2026-07-26", hospital: "某儿童医院", dept: "呼吸内科" } },
    { kind: "canonical_fact", id: "CF1", content: { type: "diagnosis", value: "急性支气管炎", structured: null }, links: [{ role: "of_encounter", to: { kind: "encounter", id: "E1" } }] },
    { kind: "episode", id: "EP-X", content: { title: "2026-07 流涕→咳嗽", start: "2026-07-10", declaredEnd: "end_unknown", keyFindings: ["7/26 诊断急性支气管炎"] }, links: [{ role: "encounter", to: { kind: "encounter", id: "E1" } }] },
    { kind: "episode", id: "EP-Y", content: { title: "2026-05 急性鼻窦炎", start: "2026-05-23", declaredEnd: "end_unknown" } },
    obs("O4", "2026-07-12 19:58:37", "37.8", [{ role: "attached", to: { kind: "episode", id: "EP-X" } }]),
    obs("O5", "2026-07-26 11:13:06", "7月10日左右开始流鼻涕，这两天一直没有减轻", [{ role: "attached", to: { kind: "episode", id: "EP-X" } }]),
    obs("O10", "2026-05-25 09:00:00", "鼻塞一周了", [{ role: "attached", to: { kind: "episode", id: "EP-Y" } }]),
    obs("O11", "2026-06-01 10:00:00", "偶尔咳嗽"),
    obs("O12", "2026-06-02 10:00:00", "今天挺好"),
  ] };
  const plan = planImport(emptyLedger(), batch);
  assert.equal(plan.rejected, false, JSON.stringify(plan.items.filter((i) => i.action === "rejected")));
  return applyPlan(emptyLedger(), plan, { runId: "r1", at: "2026-09-20T00:00:00.000Z" });
}
const body = (over = {}) => ({
  dataAsOf: "2026-07-26", episodeLastRecord: "2026-07-26", summary: ["7月中旬起流涕，7月26日医院诊断为急性支气管炎；这是一次以呼吸道症状为主的病程。"],
  layers: [{ level: "doctor", text: "7/26 呼吸内科诊断急性支气管炎。" }, { level: "parent", text: "家长自述鼻涕、咳嗽没有继续减轻。" }, { level: "inferred", text: "症状约两周未缓解，符合需要复诊评估的情形。" }],
  uncertain: ["结束日期没有记录"], impact: "复诊时带上这段时间的观察记录。", currentStatus: "截至 7 月 26 日的资料，结束未知，不代表现在的状态。",
  measures: [
    { id: "c1", group: "care", kind: "care", text: "继续记录咳嗽与夜间睡眠", conditions: ["仍有咳嗽时"], reassessWhen: ["咳嗽变频繁"], evidenceIds: ["EV-1"] },
    { id: "v1", group: "visit", kind: "conditional", text: "呼吸明显费力时立刻就医", conditions: ["出现呼吸费力"], reassessWhen: [], evidenceIds: ["EV-2"] },
  ],
  factRefs: [{ ledger: "history", ref: { kind: "canonical_fact", id: "CF1" }, note: "诊断" }], evidenceIds: ["EV-1", "EV-2"], ...over });
const page = (H, an) => buildHealthPage({ history: H, record: null, intervals: null, materials: null, analyses: an, now: NOW });
const ep = (p, id) => p.episodes.find((e) => e.id === id);
const ledgers = (H) => ({ history: H, record: null });
const corr = (H, ref, field, after, id) => applyCorrection(H, { id, type: "field", ref, changes: [{ field, after }], author: "妈妈", at: "2026-09-22T00:00", reason: "更正" }).ledger;

test("A1 版本生命周期：草稿/待审核不进页面；采用后总结与两类措施出现；无关病程不变；重放不增殖；措施不带日期与剂量", () => {
  const H = base(), L = ledgers(H);
  let f = emptyAnalyses();
  const d1 = addDraft(f, L, { episodeId: "EP-X", author: "执行者", at: "2026-09-21T01:00:00Z", body: body() });
  assert.equal(d1.created, true); f = d1.file;
  assert.equal(addDraft(f, L, { episodeId: "EP-X", author: "执行者", at: "2026-09-21T02:00:00Z", body: body() }).created, false, "同样内容同样依据不重复追加");
  assert.equal(ep(page(H, f), "EP-X").summary.analysis, null, "草稿不显示");
  f = submit(f, L, { id: "AV-EP-X-1", by: "执行者", at: "2026-09-21T03:00:00Z" });
  assert.equal(ep(page(H, f), "EP-X").summary.analysis, null, "待审核也不显示");
  assert.throws(() => adopt(f, L, { id: "AV-EP-X-1", by: "Codex", at: "2026-09-21T04:00:00Z", basis: "" }), (e) => e instanceof AnalysisRefused && e.code === "missing_basis");
  const before = page(H, null);
  f = adopt(f, L, { id: "AV-EP-X-1", by: "审核人", at: "2026-09-21T04:00:00Z", basis: "对照病历与依据逐条核对" });
  const p = page(H, f), a = ep(p, "EP-X").summary.analysis;
  assert.equal(a.version, "AV-EP-X-1"); assert.equal(a.review, null); assert.equal(a.adoptedBy, "审核人");
  assert.deepEqual(a.layers.map((l) => l.label), ["医生诊断/病历", "家长报告", "辅助推断"]);
  assert.ok(p.followUp.care.some((m) => m.text === "继续记录咳嗽与夜间睡眠" && m.episodes[0].id === "EP-X" && /适用前提/.test(m.detail)));
  assert.equal(p.followUp.visit[0].kind, "conditional");
  assert.equal(p.followUp.status, "current");
  assert.deepEqual(ep(p, "EP-Y"), ep(before, "EP-Y"), "无关病程不变");
  assert.equal(p.reminders.length, 0, "建议不会变成预约或吃药提醒");
  assert.equal(categoryOf("发热 + 呼吸道感染（与烫伤期重叠但诊断不同）"), "resp", "与烫伤重叠的呼吸道病程只归呼吸道一类"); assert.equal(categoryOf("暖风机烫伤及其复查"), "burn");
  // content rules
  const bad = (over) => assert.throws(() => addDraft(emptyAnalyses(), L, { episodeId: "EP-X", author: "x", at: "t", body: body(over) }), (e) => e.code === "invalid_body");
  bad({ measures: [{ id: "c1", group: "care", kind: "care", text: "每次喂 5ml", conditions: ["发热"], reassessWhen: [], evidenceIds: ["EV-1"] }] });
  bad({ measures: [{ id: "c1", group: "care", kind: "care", text: "复诊", conditions: ["x"], reassessWhen: [], evidenceIds: ["EV-1"], date: "2026-10-01" }] });
  bad({ measures: [{ id: "c1", group: "care", kind: "care", text: "观察", conditions: [], reassessWhen: [], evidenceIds: ["EV-1"] }] });
  bad({ currentStatus: "已康复" });
  assert.throws(() => addDraft(emptyAnalyses(), L, { episodeId: "EP-Q", author: "x", at: "t", body: body() }), (e) => e.code === "unknown_episode");
});

test("A2 更正让旧分析失效但保留文字；引用记录被更正也失效；无关病程与通用内容不受影响", () => {
  const H = base(), L = ledgers(H);
  let f = addDraft(emptyAnalyses(), L, { episodeId: "EP-X", author: "执行者", at: "t1", body: body() }).file;
  f = submit(f, L, { id: "AV-EP-X-1", by: "执行者", at: "t2" });
  f = adopt(f, L, { id: "AV-EP-X-1", by: "审核人", at: "t3", basis: "逐条核对" });
  for (const [ref, field, after] of [[{ kind: "canonical_fact", id: "CF1" }, "value", "另一个诊断"], [{ kind: "encounter", id: "E1" }, "dept", "耳鼻喉科"]]) {
    const H2 = corr(H, ref, field, after, `c-${ref.id}`), p = page(H2, f), a = ep(p, "EP-X").summary.analysis;
    assert.match(a.review, /待重新核对/, `${ref.id} 更正后待核`);
    assert.equal(a.paragraphs[0], body().summary[0], "旧文字保留供追溯");
    assert.ok(p.followUp.care.concat(p.followUp.visit).filter((m) => m.id.startsWith("AV-EP-X-1")).every((m) => /待重新核对/.test(m.review)), "措施同步待核");
    assert.equal(p.followUp.status, "stale");
    assert.equal(stateOf(ledgers(H2), f.versions[0]).shown, "expired");
    assert.equal(ep(p, "EP-Y").summary.analysis, null);
  }
  // a cited record that is not part of the episode's dependency closure is watched through the snapshot refs
  let g = addDraft(emptyAnalyses(), L, { episodeId: "EP-X", author: "x", at: "t1", body: body({ factRefs: [{ ledger: "history", ref: { kind: "observation", id: "O4" } }] }) }).file;
  g = adopt(submit(g, L, { id: "AV-EP-X-1", by: "x", at: "t2" }), L, { id: "AV-EP-X-1", by: "审核人", at: "t3", basis: "核对" });
  const H3 = corr(H, { kind: "observation", id: "O4" }, "text", "37.0", "c-o4");
  assert.match(ep(page(H3, g), "EP-X").summary.analysis.review, /O4/);
});

test("A3 审核期间事实又变了：拒绝采用旧快照并保留旧版；重新起草后采用，旧版被取代；退回不影响已采用版本", () => {
  const H = base(), L = ledgers(H);
  let f = addDraft(emptyAnalyses(), L, { episodeId: "EP-X", author: "执行者", at: "t1", body: body() }).file;
  f = submit(f, L, { id: "AV-EP-X-1", by: "执行者", at: "t2" });
  const H2 = later(H, "inc", [obs("O9", "2026-07-30 08:00:00", "还在咳", [{ role: "attached", to: { kind: "episode", id: "EP-X" } }])]);
  assert.throws(() => adopt(f, ledgers(H2), { id: "AV-EP-X-1", by: "审核人", at: "t3", basis: "核对" }), (e) => e instanceof AnalysisRefused && e.code === "dependency_changed");
  assert.equal(f.versions.length, 1); assert.equal(stateOf(ledgers(H2), f.versions[0]).shown, "expired", "旧版保留，显示为过期");
  const d2 = addDraft(f, ledgers(H2), { episodeId: "EP-X", author: "执行者", at: "t4", body: body({ dataAsOf: "2026-07-30", currentStatus: "截至 7 月 30 日仍有咳嗽，结束未知。" }) });
  assert.equal(d2.version.seq, 2);
  let g = adopt(submit(d2.file, ledgers(H2), { id: "AV-EP-X-2", by: "执行者", at: "t5" }), ledgers(H2), { id: "AV-EP-X-2", by: "审核人", at: "t6", basis: "核对" });
  assert.equal(page(H2, g).episodes.find((e) => e.id === "EP-X").summary.analysis.version, "AV-EP-X-2");
  const h = reject(addDraft(g, ledgers(H2), { episodeId: "EP-X", author: "x", at: "t7", body: body({ dataAsOf: "2026-07-30", impact: "另一版" }) }).file, { id: "AV-EP-X-3", by: "审核人", at: "t8", basis: "不够准确" });
  assert.equal(page(H2, h).episodes.find((e) => e.id === "EP-X").summary.analysis.version, "AV-EP-X-2", "退回不影响已采用版本");
  const first = g.versions.find((v) => v.id === "AV-EP-X-1");
  assert.equal(first.events.at(-1).status, "pending_review", "被拒绝采用的旧版没有被改写");
  // adopting v2 supersedes an earlier adopted v-1 of the same episode
  let k = adopt(submit(addDraft(emptyAnalyses(), L, { episodeId: "EP-X", author: "x", at: "a", body: body() }).file, L, { id: "AV-EP-X-1", by: "x", at: "b" }), L, { id: "AV-EP-X-1", by: "审核人", at: "c", basis: "核对" });
  k = adopt(submit(addDraft(k, L, { episodeId: "EP-X", author: "x", at: "d", body: body({ impact: "改动后的影响说明" }) }).file, L, { id: "AV-EP-X-2", by: "x", at: "e" }), L, { id: "AV-EP-X-2", by: "审核人", at: "f", basis: "核对" });
  assert.deepEqual(k.versions.map((v) => v.events.at(-1).status), ["superseded", "adopted"]);
});

test("A4 影响识别：新微信观察/手记进入后只列受影响病程与未归属线索；非本人/提问不成为症状；重放稳定；不自动延长区间", async () => {
  const H = base();
  const baseline = makeBaseline({ history: H, record: null }, "2026-09-21T00:00:00Z");
  const same = computeImpact({ history: H, record: null }, null, baseline, NOW);
  assert.deepEqual([same.changed.length, same.affectedEpisodes.length, same.leads.length], [0, 0, 0], "没有变化就没有影响");
  const inc = [
    obs("N1", "2026-07-31 08:00:00", "今天还有点咳嗽"),                                                       // own, unattached, near EP-X: a lead
    obs("N2", "2026-07-30 09:00:00", "还在咳", [{ role: "attached", to: { kind: "episode", id: "EP-X" } }]),   // attached: the episode is affected
    obs("N3", "2026-07-31 09:00:00", "别人家孩子也咳嗽", [], { subject: "别人家的孩子" }),
    obs("N4", "2026-07-31 09:30:00", "要不要去医院看看？", [], { role: "question" }),
    obs("N5", "2026-01-05 09:00:00", "今天发烧了 38.5", []),                                                 // own, far from any episode
  ];
  const H2 = later(H, "wechat-inc", inc);
  const i1 = computeImpact({ history: H2, record: null }, null, baseline, NOW);
  assert.deepEqual(i1.affectedEpisodes.map((a) => a.episodeId), ["EP-X"]);
  assert.deepEqual(i1.attachedNew.map((a) => a.id), ["N2"]);
  const lead = i1.leads.find((l) => l.id === "N1");
  assert.equal(lead.near[0].episodeId, "EP-X"); assert.match(lead.action, /自动归属/);
  assert.deepEqual(i1.leads.find((l) => l.id === "N5").near, [], "离得远的没有候选病程，只作独立节点");
  assert.ok(!i1.leads.some((l) => ["N3", "N4"].includes(l.id)));
  assert.deepEqual(Object.values(i1.excluded).flat().sort(), ["N3", "N4"]);
  // replaying the same import adds nothing: identical impact
  const H3 = later(H2, "wechat-inc-again", inc, "2026-09-23T00:00:00.000Z");
  assert.equal(computeImpact({ history: H3, record: null }, null, baseline, NOW).digest, i1.digest);
  // the page still draws no span from these records
  const before = buildHealthPage({ history: H, record: null, intervals: null, materials: null, now: NOW });
  const after = buildHealthPage({ history: H2, record: null, intervals: null, materials: null, now: NOW });
  assert.deepEqual(after.bands.map((b) => [b.id, b.start, b.end]), before.bands.map((b) => [b.id, b.start, b.end]));
  assert.ok(!after.nodes.flatMap((n) => n.entries).some((e) => ["N3", "N4"].includes(e.id)));
  // an existing analysis over the affected episode is reported as needing a new version
  const L = ledgers(H);
  const f = addDraft(emptyAnalyses(), L, { episodeId: "EP-X", author: "x", at: "t", body: body() }).file;
  const i2 = computeImpact({ history: H2, record: null }, f, baseline, NOW);
  assert.equal(i2.affectedEpisodes[0].analysis.shown, "expired");
  // a parent note with a report image is only registered as material; new baseline empties the list
  const rec = later(emptyLedger(), "rec", [{ kind: "observation", id: "R1", content: { role: "observation", factKind: "symptom_report", reviewStatus: "claude_full_read_r4", timeBasis: "stated", occurredPrecision: "day", layer: "health_record", kind: "visit", occurredAt: "2026-07-31", recordedAt: "2026-07-31 10:00:00", images: [{ sha256: "a".repeat(64), name: "x.jpg" }], speaker: "爸爸" }, links: [] }]);
  const i3 = computeImpact({ history: H2, record: rec }, null, baseline, NOW);
  assert.equal(i3.leads.find((l) => l.id === "R1").hasReportImages, true); assert.match(i3.leads.find((l) => l.id === "R1").action, /OCR 另批/);
  const nb = makeBaseline({ history: H2, record: rec }, "2026-09-23T00:00:00Z");
  assert.equal(computeImpact({ history: H2, record: rec }, null, nb, NOW).changed.length, 0);
});

test("A5 命令入口：默认预览不写文件；采用需要 --apply 与执行人/依据；依据变化时退出码 3", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "health-analysis-cli-"));
  try {
    const hist = path.join(dir, "history"), files = { an: path.join(dir, "analyses.json"), body: path.join(dir, "body.json"), base: path.join(dir, "baseline.json") };
    await new HealthFileStore(hist).transaction(() => ({ ledger: base(), result: null }));
    await writeFile(files.body, JSON.stringify(body()));
    const run = async (...a) => { a = [...a, "--evidence", REG]; const out = []; const o = console.log, e = console.error; console.log = (x) => out.push(x); console.error = (x) => out.push(x); try { return { code: await main(["--ledger", hist, ...a]), out: out.join("\n") }; } finally { console.log = o; console.error = e; } };
    const A = ["--analyses", files.an];
    let r = await run("analysis", "draft", ...A, "--episode", "EP-X", "--body", files.body, "--author", "执行者");
    assert.equal(r.code, 0); assert.match(r.out, /dry-run/);
    await assert.rejects(() => readFile(files.an), "预览不写文件");
    await run("analysis", "draft", ...A, "--episode", "EP-X", "--body", files.body, "--author", "执行者", "--apply");
    await run("analysis", "submit", ...A, "--id", "AV-EP-X-1", "--by", "执行者", "--apply");
    r = await run("analysis", "adopt", ...A, "--id", "AV-EP-X-1", "--by", "审核人", "--apply");
    assert.equal(r.code, 2); assert.match(r.out, /missing_basis/);
    // facts change while it waits: adoption is refused with exit 3 and the file keeps its old state
    await new HealthFileStore(hist).transaction((L) => ({ ledger: later(L, "inc", [obs("O9", "2026-07-30 08:00:00", "还在咳", [{ role: "attached", to: { kind: "episode", id: "EP-X" } }])]), result: null }));
    const before = await readFile(files.an, "utf8");
    r = await run("analysis", "adopt", ...A, "--id", "AV-EP-X-1", "--by", "审核人", "--basis", "核对", "--apply");
    assert.equal(r.code, 3); assert.match(r.out, /dependency_changed/);
    assert.equal(await readFile(files.an, "utf8"), before);
    r = await run("baseline", "--out", files.base); assert.equal(r.code, 0);
    await assert.rejects(() => readFile(files.base), "baseline 默认不写");
    await run("baseline", "--out", files.base, "--apply");
    r = await run("impact", "--baseline", files.base);
    assert.equal(r.code, 0, "新基线之后没有待处理的影响");
    r = await run("impact", "--baseline", files.base, ...A);
    assert.equal(r.code, 3, "已提交待审的分析依据的事实已变：仍要重新分析");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ================= HEALTH-M01-A-R1 =================
const adoptedFile = (H, bodyOver = {}) => {
  const L = ledgers(H);
  let f = addDraft(emptyAnalyses(), L, { episodeId: "EP-X", author: "执行者", at: "t1", body: body(bodyOver) }).file;
  f = submit(f, L, { id: "AV-EP-X-1", by: "执行者", at: "t2" });
  return { f, L };
};

test("R1B-1 被审核的正文必须与提交时一致：提交后替换正文/快照、不存在或未绑定的证据都不能采用，也不能作为有效分析显示；正常对照可采用", () => {
  const H = base(), L = ledgers(H);
  // evidence that does not exist cannot even become a draft; a measure may only cite evidence the version cites
  assert.throws(() => addDraft(emptyAnalyses(), L, { episodeId: "EP-X", author: "x", at: "t", body: body({ evidenceIds: ["EV-1", "EV-2", "EV-DOES-NOT-EXIST"] }) }), (e) => e.code === "evidence_invalid" && /EV-DOES-NOT-EXIST/.test(e.reasons.join()));
  assert.throws(() => addDraft(emptyAnalyses(), L, { episodeId: "EP-X", author: "x", at: "t", body: body({ evidenceIds: ["EV-1"] }) }), (e) => e.code === "invalid_body", "措施引用了本版没有的证据 EV-2");
  const { f } = adoptedFile(H);
  // after submission the stored summary is replaced without touching bodyHash: adoption refused
  const t1 = structuredClone(f); t1.versions[0].body.summary = ["换成了另一段没有经过审核的文字。"];
  assert.throws(() => adopt(t1, L, { id: "AV-EP-X-1", by: "审核人", at: "t3", basis: "核对" }), (e) => e.code === "integrity_failed" && /哈希不一致/.test(e.reasons.join()));
  // replaced body AND recomputed bodyHash but with an evidence id that was never bound
  const t2 = structuredClone(f); t2.versions[0].body.evidenceIds = ["EV-1", "EV-2", "EV-DOES-NOT-EXIST"]; t2.versions[0].bodyHash = _hash(t2.versions[0].body);
  assert.throws(() => adopt(t2, L, { id: "AV-EP-X-1", by: "审核人", at: "t3", basis: "核对" }), (e) => e.code === "integrity_failed");
  const t3 = structuredClone(f); t3.versions[0].snapshot.evidence = [];
  assert.throws(() => adopt(t3, L, { id: "AV-EP-X-1", by: "审核人", at: "t3", basis: "核对" }), (e) => e.code === "integrity_failed", "快照被清空");
  // normal control
  const ok = adopt(f, L, { id: "AV-EP-X-1", by: "审核人", at: "t3", basis: "对照事实包与证据登记" });
  assert.equal(ep(page(H, ok), "EP-X").summary.analysis.review, null);
  // a version tampered AFTER adoption is not shown as a valid analysis: content withheld, history kept, measures gone
  const tam = structuredClone(ok); tam.versions[0].body.impact = "改过的影响说明";
  const p = page(H, tam), e = ep(p, "EP-X");
  assert.equal(e.summary.analysis, null); assert.match(e.summary.review, /不能作为有效分析/);
  assert.ok(!p.followUp.care.concat(p.followUp.visit).some((m) => m.id.startsWith("AV-EP-X-1")));
  assert.equal(tam.versions.length, 1, "历史保留");
  assert.equal(stateOf(L, tam.versions[0]).shown, "invalid");
});

test("R1B-2 医学证据登记变化：已采用后证据缺失/被修订/撤回/已读正文变了，分析与措施保留文字并待核；恢复后回到有效", () => {
  const H = base(), L = ledgers(H);
  const { f } = adoptedFile(H);
  const ok = adopt(f, L, { id: "AV-EP-X-1", by: "审核人", at: "t3", basis: "核对" });
  assert.equal(ep(page(H, ok), "EP-X").summary.analysis.review, null);
  const T1 = "synthetic guideline text one", T2 = "synthetic guideline text two";
  const src = (id, extra = {}) => ({ id, title: id, version: "2026", localText: id === "EV-1" ? "t1.txt" : "t2.txt", textSha256: shaHex(id === "EV-1" ? T1 : T2), ...extra });
  const check = (label, rx) => {
    const p = page(H, ok), a = ep(p, "EP-X").summary.analysis;
    assert.match(a.review, rx, label); assert.equal(a.paragraphs[0], body().summary[0], "文字保留供追溯");
    assert.ok(p.followUp.care.concat(p.followUp.visit).filter((m) => m.id.startsWith("AV-EP-X-1")).every((m) => /待重新核对/.test(m.review)), `${label}：措施同步待核`);
    assert.equal(p.followUp.status, "stale");
  };
  writeFileSync(path.join(EVDIR, "t1.txt"), "the saved text was silently edited"); check("已读正文变了", /医学证据 EV-1.*不一致/);
  writeRegister(); assert.equal(ep(page(H, ok), "EP-X").summary.analysis.review, null, "恢复后有效");
  writeRegister({ sources: [src("EV-2")] }); check("证据不在登记里", /EV-1.*不在证据登记/);
  writeRegister({ sources: [src("EV-1", { status: "withdrawn" }), src("EV-2")] }); check("被撤回", /EV-1.*撤回/);
  writeRegister({ sources: [src("EV-1", { version: "2027 修订版" }), src("EV-2")] }); check("登记内容被修订", /EV-1.*被修订/);
  writeRegister();
  // a register that is not connected at all never counts as verified
  const p = _build({ history: H, record: null, intervals: null, materials: null, analyses: ok, now: NOW });
  assert.match(ep(p, "EP-X").summary.analysis.review, /登记没有接通/);
  // and a changed saved text blocks adoption of a version still waiting
  writeFileSync(path.join(EVDIR, "t2.txt"), "edited while waiting");
  assert.throws(() => adopt(f, L, { id: "AV-EP-X-1", by: "审核人", at: "t3", basis: "核对" }), (e) => e.code === "evidence_invalid");
  writeRegister();
});

test("R1B-3 跨病程/未挂靠的实际引用进入可失效快照；dataAsOf 覆盖所有引用；没引用的无关更正不影响", () => {
  const H = base(), L = ledgers(H);
  const cited = [{ ledger: "history", ref: { kind: "canonical_fact", id: "CF1" } }, { ledger: "history", ref: { kind: "episode", id: "EP-Y" }, note: "5 月那一段" }, { ledger: "history", ref: { kind: "observation", id: "O11" }, note: "6/1 未挂靠" }];
  const { f } = adoptedFile(H, { factRefs: cited });
  const ok = adopt(f, L, { id: "AV-EP-X-1", by: "审核人", at: "t3", basis: "核对" });
  assert.equal(ep(page(H, ok), "EP-X").summary.analysis.review, null);
  // another episode that this reading cites is corrected (a member of it): this analysis is held
  const H1 = corr(H, { kind: "observation", id: "O10" }, "text", "鼻塞已经好了", "c-o10");
  assert.match(ep(page(H1, ok), "EP-X").summary.analysis.review, /病程 EP-Y/);
  // an unattached record that it cites is corrected
  const H2 = corr(H, { kind: "observation", id: "O11" }, "text", "没有咳嗽", "c-o11");
  assert.match(ep(page(H2, ok), "EP-X").summary.analysis.review, /O11/);
  // control: a record it does not cite is corrected -> unchanged
  const H3 = corr(H, { kind: "observation", id: "O12" }, "text", "今天有点鼻塞", "c-o12");
  assert.equal(ep(page(H3, ok), "EP-X").summary.analysis.review, null);
  // the data date has to cover the newest cited record (other episodes included) and may be later than the episode's own last record
  assert.throws(() => addDraft(emptyAnalyses(), L, { episodeId: "EP-X", author: "x", at: "t", body: body({ dataAsOf: "2026-05-30", episodeLastRecord: "2026-05-25", factRefs: cited }) }), (e) => e.code === "invalid_body" && /dataAsOf/.test(e.reasons.join()));
  assert.throws(() => addDraft(emptyAnalyses(), L, { episodeId: "EP-X", author: "x", at: "t", body: body({ episodeLastRecord: "2026-08-01" }) }), (e) => e.code === "invalid_body");
  const wide = addDraft(emptyAnalyses(), L, { episodeId: "EP-X", author: "x", at: "t", body: body({ dataAsOf: "2026-07-30", episodeLastRecord: "2026-07-26", factRefs: cited }) });
  assert.equal(wide.created, true);
});

test("R1C 待完成的复核不被新草稿和新基线遮住：已采用 v1 → 更正 → 起草 v2 → 存新基线，impact 仍报 v1 过期；采用 v2 后清空", () => {
  const H = base(), L = ledgers(H);
  const { f } = adoptedFile(H);
  let file = adopt(f, L, { id: "AV-EP-X-1", by: "审核人", at: "t3", basis: "核对" });
  const H2 = corr(H, { kind: "canonical_fact", id: "CF1" }, "value", "复核后更正的诊断", "c-cf1");
  const L2 = ledgers(H2);
  file = addDraft(file, L2, { episodeId: "EP-X", author: "执行者", at: "t4", body: body({ impact: "按更正后的诊断重写的影响说明" }) }).file;
  assert.equal(file.versions.length, 2);
  const newBase = makeBaseline(L2, "2026-09-23T00:00:00Z"); // the import baseline moves forward
  const imp = computeImpact(L2, file, newBase, NOW);
  assert.deepEqual(imp.affectedEpisodes.map((a) => a.episodeId), ["EP-X"], "基线前移、最新草稿有效，也不能隐去正在展示的 v1 的待核");
  const rows = imp.affectedEpisodes[0].analyses;
  assert.deepEqual(rows.map((r) => [r.role, r.id, r.shown]), [["displayed", "AV-EP-X-1", "expired"], ["pending", "AV-EP-X-2", "draft"]]);
  assert.match(imp.affectedEpisodes[0].reasons.join(), /正在展示的已采用分析 AV-EP-X-1/);
  assert.match(ep(page(H2, file), "EP-X").summary.analysis.review, /待重新核对/, "页面同样显示 v1 待核");
  // a waiting version that itself became stale is reported too
  const H3 = corr(H2, { kind: "encounter", id: "E1" }, "dept", "耳鼻喉科", "c-e1");
  assert.ok(computeImpact(ledgers(H3), file, makeBaseline(ledgers(H3), "x"), NOW).affectedEpisodes[0].reasons.some((r) => /待审核的分析 AV-EP-X-2/.test(r)));
  // finishing the review clears it: submit + adopt v2 on the current facts
  file = adopt(submit(file, L2, { id: "AV-EP-X-2", by: "执行者", at: "t5" }), L2, { id: "AV-EP-X-2", by: "审核人", at: "t6", basis: "对照更正后的事实" });
  assert.deepEqual(computeImpact(L2, file, newBase, NOW).affectedEpisodes, []);
  assert.equal(ep(page(H2, file), "EP-X").summary.analysis.review, null);
  assert.deepEqual(file.versions.map((v) => v.events.at(-1).status), ["superseded", "adopted"]);
});
