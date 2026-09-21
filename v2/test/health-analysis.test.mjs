// HEALTH-M01-A: per-episode analysis versions, adoption/expiry, impact identification and the page reading them.
// All data is synthetic in fresh temp directories; no real ledger, original, database or network is touched.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { applyCorrection, applyPlan, effectiveHash, planImport } from "../lib/health/ledger.ts";
import { emptyLedger } from "../lib/health/model.ts";
import { HealthFileStore } from "../lib/health/file-store.ts";
import { buildHealthPage, categoryOf } from "../lib/health/page/model.ts";
import { AnalysisRefused, addDraft, adopt, emptyAnalyses, reject, stateOf, submit } from "../lib/health/page/analysis.ts";
import { computeImpact, makeBaseline } from "../lib/health/page/impact.ts";
import { main } from "../scripts/health-import/cli.mjs";

const NOW = "2026-09-21T10:00";
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
  ] };
  const plan = planImport(emptyLedger(), batch);
  assert.equal(plan.rejected, false, JSON.stringify(plan.items.filter((i) => i.action === "rejected")));
  return applyPlan(emptyLedger(), plan, { runId: "r1", at: "2026-09-20T00:00:00.000Z" });
}
const body = (over = {}) => ({
  dataAsOf: "2026-07-26", summary: ["7月中旬起流涕，7月26日医院诊断为急性支气管炎；这是一次以呼吸道症状为主的病程。"],
  layers: [{ level: "doctor", text: "7/26 呼吸内科诊断急性支气管炎。" }, { level: "parent", text: "家长自述鼻涕、咳嗽没有继续减轻。" }, { level: "inferred", text: "症状约两周未缓解，符合需要复诊评估的情形。" }],
  uncertain: ["结束日期没有记录"], impact: "复诊时带上这段时间的观察记录。", currentStatus: "截至 7 月 26 日的资料，结束未知，不代表现在的状态。",
  measures: [
    { id: "c1", group: "care", kind: "care", text: "继续记录咳嗽与夜间睡眠", conditions: ["仍有咳嗽时"], reassessWhen: ["咳嗽变频繁"] },
    { id: "v1", group: "visit", kind: "conditional", text: "呼吸明显费力时立刻就医", conditions: ["出现呼吸费力"], reassessWhen: [] },
  ],
  factRefs: [{ ledger: "history", ref: { kind: "canonical_fact", id: "CF1" }, note: "诊断" }], evidenceIds: ["EV-1"], ...over });
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
  bad({ measures: [{ id: "c1", group: "care", kind: "care", text: "每次喂 5ml", conditions: ["发热"], reassessWhen: [] }] });
  bad({ measures: [{ id: "c1", group: "care", kind: "care", text: "复诊", conditions: ["x"], reassessWhen: [], date: "2026-10-01" }] });
  bad({ measures: [{ id: "c1", group: "care", kind: "care", text: "观察", conditions: [], reassessWhen: [] }] });
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
    const run = async (...a) => { const out = []; const o = console.log, e = console.error; console.log = (x) => out.push(x); console.error = (x) => out.push(x); try { return { code: await main(["--ledger", hist, ...a]), out: out.join("\n") }; } finally { console.log = o; console.error = e; } };
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
