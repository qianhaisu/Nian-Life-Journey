// HEALTH-03 record feature: five server-side core scenario groups (the sixth, a real 390x844 browser flow, is
// scripts/health-record-e2e.mjs). All data is synthetic and lives in a fresh temp directory; nothing touches a real ledger or database.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { loadHealthRecordConfig } from "../lib/health/record/config.ts";
import { issueSession } from "../lib/health/record/auth.ts";
import { createHealthRecordHandler } from "../lib/health/record/http.ts";
import { HealthFileStore } from "../lib/health/file-store.ts";
import { runImport } from "../lib/health/importer.ts";
import { businessDigest } from "../lib/health/model.ts";

const ORIGIN = "http://health.test";
const ENV = (root) => ({ HEALTH_RECORD_ROOT: root, HEALTH_RECORD_SESSION_SECRET: "s".repeat(40), HEALTH_RECORD_MOM_PASSWORD: "mom-synthetic-pw", HEALTH_RECORD_DAD_PASSWORD: "dad-synthetic-pw" });
const uid = (() => { let n = 0; return () => `req${String(++n).padStart(6, "0")}${"x".repeat(12)}`; })();
const T0 = Date.parse("2026-09-21T10:00:00+08:00");

async function setup(over = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "health-record-test-"));
  const clock = { now: T0 };
  const flags = { ledgerFail: false, originalFail: false };
  const conf = loadHealthRecordConfig({ ...ENV(root), HEALTH_RECORD_COOKIE_SECURE: "0" }, over.cwd ?? "/elsewhere");
  assert.ok(conf.ok, conf.reason);
  const handle = createHealthRecordHandler(() => conf, () => ({
    now: () => clock.now,
    store: { beforeCommit: async () => { if (flags.ledgerFail) throw new Error("injected"); } },
    originalsHooks: { failWrite: () => flags.originalFail },
  }));
  const call = async (method, p, { body, files, cookie, origin = ORIGIN, headers = {} } = {}) => {
    const h = { ...headers }; if (origin) h.origin = origin; if (cookie) h.cookie = cookie;
    let payload;
    if (files) { const f = new FormData(); f.set("payload", JSON.stringify(body ?? {})); for (const x of files) f.append("files", new File([x.data], x.name, { type: x.type ?? "image/jpeg" })); payload = f; }
    else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await handle(new Request(`${ORIGIN}/api/health-record/${p}`, { method, headers: h, body: payload }), p.split("?")[0].split("/").filter(Boolean));
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, headers: res.headers, json: type.includes("json") ? await res.json() : null, buf: type.includes("json") ? null : Buffer.from(await res.arrayBuffer()) };
  };
  const login = async (who) => { const r = await call("POST", "session", { body: { who, password: who === "mom" ? "mom-synthetic-pw" : "dad-synthetic-pw" } }); assert.equal(r.status, 200); return r.headers.get("set-cookie").split(";")[0]; };
  return { root, clock, flags, conf, handle, call, login, cleanup: () => rm(root, { recursive: true, force: true }), ...over };
}
const jpeg = (w = 80, h = 100, rgb = { r: 200, g: 120, b: 90 }, orientation) => { let s = sharp({ create: { width: w, height: h, channels: 3, background: rgb } }); if (orientation) s = s.withMetadata({ orientation }); return s.jpeg().toBuffer(); };
const nowStr = (ms) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 16);
const noteBody = (over = {}) => ({ type: "note", entryId: uid(), text: "夜里咳嗽", when: { mode: "unknown" }, symptoms: {}, ...over });

// ============ 1 未认证 / 作者不可伪造 / 跨来源写入 ============
test("1 未认证访问被拒；作者取自会话；跨来源与篡改会话被拒；未配置即关闭", async () => {
  const s = await setup();
  try {
    const mom = await s.login("mom");
    const made = await s.call("POST", "entries", { cookie: mom, body: noteBody({ author: "爸爸", speaker: "爸爸", who: "dad" }) });
    assert.equal(made.status, 200);
    const id = made.json.record.id;
    assert.equal(made.json.record.author, "妈妈", "作者来自会话，请求里自报的作者被忽略");
    // 图片先存好，后面检查原件也要授权
    const img = await jpeg();
    const v = await s.call("POST", "entries", { cookie: mom, body: { type: "visit", entryId: uid(), note: "x", hospital: "浙一" }, files: [{ name: "a.jpg", data: img }] });
    const sha = v.json.record.images[0].sha256;

    for (const [m, p, body] of [["GET", "entries"], ["GET", `entries/${id}`], ["GET", `originals/${sha}`], ["GET", `originals/${sha}?thumb=1`], ["POST", "entries", noteBody()], ["POST", `entries/${id}/corrections`, { requestId: uid(), expectedRevision: 1, edit: { text: "x" } }], ["POST", `entries/${id}/attribution`, { requestId: uid(), expectedRevision: 1, action: "void" }]]) {
      const r = await s.call(m, p, { body });
      assert.equal(r.status, 401, `${m} ${p} 未登录应 401`);
      assert.match(r.headers.get("cache-control"), /no-store/);
    }
    assert.equal((await s.call("POST", "session", { body: { who: "mom", password: "wrong-password" } })).status, 401);
    assert.equal((await s.call("POST", "session", { body: { who: "mom", password: "dad-synthetic-pw" } })).status, 401, "爸爸的密码不能登录妈妈");
    // 跨来源 / 缺 Origin 的写入
    assert.equal((await s.call("POST", "entries", { cookie: mom, origin: "http://evil.example", body: noteBody() })).status, 403);
    assert.equal((await s.call("POST", "entries", { cookie: mom, origin: null, body: noteBody() })).status, 403);
    assert.equal((await s.call("POST", "entries", { cookie: mom, headers: { "sec-fetch-site": "cross-site" }, body: noteBody() })).status, 403);
    // 篡改 / 过期 / 伪造会话
    assert.equal((await s.call("GET", "entries", { cookie: mom.slice(0, -3) + "abc" })).status, 401);
    const expired = issueSession(s.conf.config, "mom", Date.now() - 10 * 3600_000).token;
    assert.equal((await s.call("GET", "entries", { cookie: `hr_session=${expired}` })).status, 401);
    const forgedBody = Buffer.from(JSON.stringify({ w: "dad", exp: 9999999999 })).toString("base64url");
    assert.equal((await s.call("GET", "entries", { cookie: `hr_session=${forgedBody}.AAAA` })).status, 401);
    // Cookie 属性
    const lr = await s.call("POST", "session", { body: { who: "dad", password: "dad-synthetic-pw" } });
    assert.match(lr.headers.get("set-cookie"), /HttpOnly/); assert.match(lr.headers.get("set-cookie"), /SameSite=Strict/);
    // 原件：只服务已提交记录引用的图片，不接受路径
    assert.equal((await s.call("GET", `originals/${"a".repeat(64)}`, { cookie: mom })).status, 404);
    assert.equal((await s.call("GET", "originals/..%2f..%2fledger%2fledger.json", { cookie: mom })).status, 404);
    assert.equal((await s.call("GET", `originals/${sha}`, { cookie: mom })).status, 200);
    // 暴力尝试被刹车
    for (let i = 0; i < 5; i++) await s.call("POST", "session", { body: { who: "mom", password: `bad-${i}-bad-bad` } });
    assert.equal((await s.call("POST", "session", { body: { who: "mom", password: "mom-synthetic-pw" } })).status, 429);
    // 配置缺失 / 位置不安全 = 关闭，不回退
    const off = createHealthRecordHandler(() => loadHealthRecordConfig({}));
    assert.equal((await off(new Request(`${ORIGIN}/api/health-record/entries`), ["entries"])).status, 404);
    for (const env of [{ ...ENV("/x"), HEALTH_RECORD_ROOT: "relative/dir" }, { ...ENV(s.root), HEALTH_RECORD_SESSION_SECRET: "short" }, { ...ENV(s.root), HEALTH_RECORD_DAD_PASSWORD: "mom-synthetic-pw" }, ENV(path.join(process.cwd(), "public", "hr"))]) assert.equal(loadHealthRecordConfig(env).ok, false);
  } finally { await s.cleanup(); }
});

// ============ 2 手记：可选项 / 未知时间 / 固定℃ / 失败重试不重复且时间不漂移 ============
test("2 手记：可选项与取消、未知时间、℃ 校验；失败重试不重复、发生时间不漂移", async () => {
  const s = await setup();
  try {
    const c = await s.login("mom");
    const full = await s.call("POST", "entries", { cookie: c, body: noteBody({ text: "睡前哄了很久", symptoms: { temperature: "37.8", nose: "浓鼻涕", cough: "轻微", nasalVoice: true, sleep: ["夜醒多", "哄睡困难"] } }) });
    assert.deepEqual(full.json.record.symptoms, { temperature: { value: 37.8, unit: "℃" }, nose: "浓鼻涕", cough: "轻微", nasalVoice: true, sleep: ["哄睡困难", "夜醒多"] });
    assert.equal(full.json.record.occurred.at, null, "没选时间 = 不确定，不冒充现在");
    assert.equal(full.json.record.occurred.basis, "unknown");
    // 只写一句话：没有生成“正常/无症状”，未选鼻音/睡眠不存在
    const bare = await s.call("POST", "entries", { cookie: c, body: noteBody({ text: "情绪不错" }) });
    assert.deepEqual(bare.json.record.symptoms, {});
    assert.doesNotMatch(JSON.stringify(bare.json.record), /正常|无鼻音|无症状/);
    // 空记录不能保存；只选一项补充可以
    assert.equal((await s.call("POST", "entries", { cookie: c, body: noteBody({ text: "  " }) })).json.code, "empty_entry");
    assert.equal((await s.call("POST", "entries", { cookie: c, body: noteBody({ text: "", symptoms: { sleep: ["夜醒多"] } }) })).status, 200);
    // 选项取消 = 更正为“未记录”（不是“无”）
    const rev = full.json.record.revision;
    const cleared = await s.call("POST", `entries/${full.json.record.id}/corrections`, { cookie: c, body: { requestId: uid(), expectedRevision: rev, edit: { text: "睡前哄了很久", symptoms: { temperature: "37.8", nose: "浓鼻涕", cough: "轻微", nasalVoice: false, sleep: [] } } } });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.json.record.symptoms.sleep, undefined); assert.equal(cleared.json.record.symptoms.nasalVoice, undefined);
    assert.equal(cleared.json.history.at(-1).changes.find((x) => x.field === "symptoms.sleep").after, null);
    // 选项不在白名单 / 单位不可换
    for (const symptoms of [{ nose: "黄鼻涕" }, { cough: "中度" }, { sleep: ["睡得好"] }, { temperature: "98.6F" }, { temperature: "abc" }, { temperature: "150" }]) assert.equal((await s.call("POST", "entries", { cookie: c, body: noteBody({ symptoms }) })).status, 400, JSON.stringify(symptoms));
    // 可疑体温：先提示，明确确认后保留数值并带标记；34-43 不被当作“正常范围”强改
    const sus = noteBody({ text: "", symptoms: { temperature: "45" } });
    const first = await s.call("POST", "entries", { cookie: c, body: sus });
    assert.equal(first.status, 422); assert.equal(first.json.code, "temperature_needs_confirmation");
    const conf = await s.call("POST", "entries", { cookie: c, body: { ...sus, confirmUnusualTemp: true } });
    assert.equal(conf.status, 200); assert.equal(conf.json.record.symptoms.temperature.value, 45); assert.equal(conf.json.record.symptoms.temperatureFlag, "unusual_confirmed");
    assert.equal((await s.call("POST", "entries", { cookie: c, body: noteBody({ text: "", symptoms: { temperature: "36.6" } }) })).json.record.symptoms.temperatureFlag, undefined);
    // 时间语义：今天（时间不详）/其他日期/不合理
    const today = await s.call("POST", "entries", { cookie: c, body: noteBody({ when: { mode: "today", date: "2026-09-21" } }) });
    assert.deepEqual(today.json.record.occurred, { at: "2026-09-21", precision: "day", basis: "parent_reported_today" });
    const past = await s.call("POST", "entries", { cookie: c, body: noteBody({ when: { mode: "date", date: "2026-09-19", precision: "minute", time: "07:30" } }) });
    assert.deepEqual(past.json.record.occurred, { at: "2026-09-19T07:30", precision: "minute", basis: "parent_reported_date" });
    for (const when of [{ mode: "date", date: "2026-09-30" }, { mode: "date" }, { mode: "date", date: "2026-09-19", precision: "minute" }, { mode: "now", at: "2026-09-21T11:30" }, { mode: "date", date: "2026-02-31" }]) assert.equal((await s.call("POST", "entries", { cookie: c, body: noteBody({ when }) })).status, 400, JSON.stringify(when));

    // 失败重试：保存失败 -> 无记录；过了很久重试沿用冻结内容与“刚刚”时间；再重放不增殖
    const frozen = noteBody({ text: "刚刚咳了一阵", when: { mode: "now", at: nowStr(T0 - 60_000) }, symptoms: { cough: "重度" } });
    const before = (await s.call("GET", "entries?limit=50", { cookie: c })).json.items.length;
    s.flags.ledgerFail = true;
    const failed = await s.call("POST", "entries", { cookie: c, body: frozen });
    assert.equal(failed.status, 500); assert.equal(failed.json.code, "storage_failed");
    assert.equal((await s.call("GET", "entries?limit=50", { cookie: c })).json.items.length, before, "失败后没有虚假成功的记录");
    s.flags.ledgerFail = false; s.clock.now += 30 * 60_000;
    const retry = await s.call("POST", "entries", { cookie: c, body: frozen });
    assert.equal(retry.status, 200); assert.equal(retry.json.duplicate, false);
    assert.equal(retry.json.record.occurred.at, frozen.when.at, "发生时间是冻结的“刚刚”，不是重试时间");
    assert.notEqual(retry.json.record.recordedAt.slice(0, 16), frozen.when.at);
    const replay = await s.call("POST", "entries", { cookie: c, body: frozen });
    assert.equal(replay.json.duplicate, true);
    assert.equal((await s.call("GET", "entries?limit=50", { cookie: c })).json.items.length, before + 1);
    assert.equal((await s.call("POST", "entries", { cookie: c, body: { ...frozen, text: "改了内容但沿用了旧提交标识" } })).status, 409);
    // 主动“再记一条”：内容相同、新 ID = 新记录
    assert.equal((await s.call("POST", "entries", { cookie: c, body: { ...frozen, entryId: uid() } })).json.duplicate, false);
  } finally { await s.cleanup(); }
});

// ============ 3 就医：其他文本 / 原图 / 授权读取 / 备注 / 未知日期；坏文件与失败不产生虚假成功 ============
test("3 就医：原图保存与授权读取、坏文件拒绝、失败无虚假成功", async () => {
  const s = await setup();
  try {
    const c = await s.login("dad");
    const a = await jpeg(80, 120, { r: 200, g: 100, b: 80 }), b = await jpeg(64, 64, { r: 60, g: 140, b: 200 });
    const rotated = await jpeg(60, 100, { r: 90, g: 90, b: 200 }, 6); // EXIF：显示时应是横的 100x60
    const visit = { type: "visit", entryId: uid(), hospital: "其他", hospitalOther: "社区门诊（合成）", department: "其他", departmentOther: "中医儿科（合成）", note: "医生说先观察", visitDate: "" };
    const r = await s.call("POST", "entries", { cookie: c, body: visit, files: [{ name: "报告A.jpg", data: a }, { name: "报告B.jpg", data: b }, { name: "方向.jpg", data: rotated }] });
    assert.equal(r.status, 200);
    const rec = r.json.record;
    assert.equal(rec.kind, "visit"); assert.equal(rec.hospitalOther, "社区门诊（合成）"); assert.equal(rec.departmentOther, "中医儿科（合成）"); assert.equal(rec.note, "医生说先观察");
    assert.equal(rec.occurred.at, null, "没填就医日期 = 未知，不当作今天已就诊");
    assert.equal(rec.images.length, 3);
    assert.doesNotMatch(JSON.stringify(rec), /diagnos|确诊|已就诊|dose|剂量/, "不自动生成确诊/服药/实际就诊事实");
    // 原图逐字节保存；缩略图只是预览
    const o = await s.call("GET", `originals/${rec.images[0].sha256}`, { cookie: c });
    assert.equal(o.status, 200); assert.equal(o.headers.get("content-type"), "image/jpeg"); assert.ok(o.buf.equals(a), "原件与上传字节一致");
    const t = await s.call("GET", `originals/${rec.images[0].sha256}?thumb=1`, { cookie: c });
    const tm = await sharp(t.buf).metadata(); assert.ok(Math.max(tm.width, tm.height) <= 480 && t.buf.length < a.length + 1000);
    const oo = await s.call("GET", `originals/${rec.images[2].sha256}?thumb=1`, { cookie: c });
    const om = await sharp(oo.buf).metadata(); assert.ok(om.width > om.height, "EXIF 方向已按显示方向处理（横向）");
    // 医院/科室其他文字规则、备注/图至少一项
    assert.equal((await s.call("POST", "entries", { cookie: c, body: { type: "visit", entryId: uid(), hospital: "浙一", hospitalOther: "偷偷写的", note: "x" } })).status, 400);
    assert.equal((await s.call("POST", "entries", { cookie: c, body: { type: "visit", entryId: uid(), hospital: "浙一" } })).json.code, "empty_entry");
    assert.equal((await s.call("POST", "entries", { cookie: c, body: { type: "visit", entryId: uid(), hospital: "医院X", note: "x" } })).status, 400);
    assert.equal((await s.call("POST", "entries", { cookie: c, body: { type: "visit", entryId: uid(), note: "只有备注，日期已知", visitDate: "2026-09-20" } })).json.record.occurred.at, "2026-09-20");
    // 坏文件：改名的文本、被截断的图片、SVG、空文件、超大、过多
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    const listBefore = (await s.call("GET", "entries?limit=50", { cookie: c })).json.items.length;
    for (const [name, data, code, status] of [["假图片.jpg", Buffer.from("这不是图片"), "bad_image", 400], ["截断.jpg", a.subarray(0, 200), "bad_image", 400], ["矢量.png", svg, "bad_image", 400], ["空.jpg", Buffer.alloc(0), "bad_image", 400], ["大.jpg", Buffer.alloc(13 * 1024 * 1024, 1), "image_too_large", 413]]) {
      const bad = await s.call("POST", "entries", { cookie: c, body: { type: "visit", entryId: uid(), note: "带坏图" }, files: [{ name, data }] });
      assert.equal(bad.status, status, name); assert.equal(bad.json.code, code, name); assert.match(bad.json.message, /“.+”/, "错误信息带文件名、可理解");
    }
    const many = await s.call("POST", "entries", { cookie: c, body: { type: "visit", entryId: uid(), note: "太多" }, files: Array.from({ length: 9 }, (_, i) => ({ name: `${i}.jpg`, data: b })) });
    assert.equal(many.json.code, "too_many_images");
    assert.equal((await s.call("GET", "entries?limit=50", { cookie: c })).json.items.length, listBefore, "坏文件没有产生任何记录");
    // 存原图失败 / 账本提交失败：不留成功假象，且未提交的图片不可读；重试成功
    const fresh = await jpeg(50, 50, { r: 10, g: 200, b: 10 });
    const req = { type: "visit", entryId: uid(), note: "重试用", hospital: "三墩" };
    s.flags.originalFail = true;
    assert.equal((await s.call("POST", "entries", { cookie: c, body: req, files: [{ name: "n.jpg", data: fresh }] })).json.code, "storage_failed");
    s.flags.originalFail = false; s.flags.ledgerFail = true;
    assert.equal((await s.call("POST", "entries", { cookie: c, body: req, files: [{ name: "n.jpg", data: fresh }] })).status, 500);
    const { createHash } = await import("node:crypto");
    const freshSha = createHash("sha256").update(fresh).digest("hex");
    assert.equal((await s.call("GET", `originals/${freshSha}`, { cookie: c })).status, 404, "未提交进账本的图片不能被读取");
    assert.equal((await s.call("GET", "entries?limit=50", { cookie: c })).json.items.length, listBefore);
    s.flags.ledgerFail = false;
    const ok = await s.call("POST", "entries", { cookie: c, body: req, files: [{ name: "n.jpg", data: fresh }] });
    assert.equal(ok.status, 200); assert.equal((await s.call("GET", `originals/${freshSha}`, { cookie: c })).status, 200);
    assert.equal((await s.call("POST", "entries", { cookie: c, body: req, files: [{ name: "n.jpg", data: fresh }] })).json.duplicate, true);
    const files = await readdir(path.join(s.root, "originals")); assert.ok(files.every((f) => !f.endsWith(".tmp")));
  } finally { await s.cleanup(); }
});

// ============ 4 更正留前值；并发不覆盖；同请求幂等 ============
test("4 更正：前值历史、并发更正不覆盖、同请求重放不增殖", async () => {
  const s = await setup();
  try {
    const c = await s.login("mom"), d = await s.login("dad");
    const made = await s.call("POST", "entries", { cookie: c, body: noteBody({ text: "原文", symptoms: { cough: "轻微" } }) });
    const id = made.json.record.id;
    const e1 = { text: "原文", symptoms: { cough: "重度" } };
    const r1 = await s.call("POST", `entries/${id}/corrections`, { cookie: d, body: { requestId: uid(), expectedRevision: 1, reason: "爸爸听到更厉害", edit: e1 } });
    assert.equal(r1.status, 200); assert.equal(r1.json.record.revision, 2); assert.equal(r1.json.record.symptoms.cough, "重度");
    const h = r1.json.history.at(-1);
    assert.equal(h.author, "爸爸"); assert.equal(h.reason, "爸爸听到更厉害");
    assert.deepEqual(h.changes, [{ field: "symptoms.cough", before: "轻微", after: "重度" }], "前值留在历史里");
    assert.equal(r1.json.history[0].kind, "created");
    // 同时间点两个更正（同一期望版本）：只有一个能成功，另一个拿到当前值，谁都没被静默覆盖
    const [x, y] = await Promise.all([
      s.call("POST", `entries/${id}/corrections`, { cookie: c, body: { requestId: uid(), expectedRevision: 2, edit: { text: "妈妈改的文字", symptoms: { cough: "重度" } } } }),
      s.call("POST", `entries/${id}/corrections`, { cookie: d, body: { requestId: uid(), expectedRevision: 2, edit: { text: "爸爸改的文字", symptoms: { cough: "重度" } } } }),
    ]);
    const statuses = [x.status, y.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const loser = x.status === 409 ? x : y, winner = x.status === 200 ? x : y;
    assert.equal(loser.json.code, "revision_conflict");
    assert.equal(loser.json.current.record.text, winner.json.record.text, "冲突返回的是当前值（胜者的改动）");
    assert.equal(loser.json.current.record.revision, 3);
    const stillThere = (await s.call("GET", `entries/${id}`, { cookie: c })).json;
    assert.equal(stillThere.record.text, winner.json.record.text, "败者没有覆盖胜者");
    // 用户明确选择“用我的改动”：带着新的修订号再提交，追加一条更正，历史保留双方
    const loserText = loser === x ? "妈妈改的文字" : "爸爸改的文字";
    const redo = await s.call("POST", `entries/${id}/corrections`, { cookie: loser === x ? c : d, body: { requestId: uid(), expectedRevision: 3, reason: "确认用我的", edit: { text: loserText, symptoms: { cough: "重度" } } } });
    assert.equal(redo.status, 200); assert.equal(redo.json.record.text, loserText);
    const texts = redo.json.history.flatMap((e) => e.changes.filter((c2) => c2.field === "text").map((c2) => c2.after));
    assert.ok(texts.includes("妈妈改的文字") && texts.includes("爸爸改的文字"), "两个人的更正都留在历史里");
    // 同请求重放：不增殖；同 ID 不同内容：拒绝；无改动：拒绝
    const rid = uid(), body = { requestId: rid, expectedRevision: 4, edit: { text: "重放测试", symptoms: { cough: "重度" } } };
    const g1 = await s.call("POST", `entries/${id}/corrections`, { cookie: c, body });
    s.clock.now += 5 * 60_000;
    const g2 = await s.call("POST", `entries/${id}/corrections`, { cookie: c, body });
    assert.equal(g2.status, 200); assert.equal(g2.json.duplicate, true);
    assert.equal(g2.json.history.length, g1.json.history.length); assert.equal(g2.json.record.revision, g1.json.record.revision);
    assert.equal((await s.call("POST", `entries/${id}/corrections`, { cookie: c, body: { ...body, edit: { text: "换了内容", symptoms: {} } } })).json.code, "request_reused");
    assert.equal((await s.call("POST", `entries/${id}/corrections`, { cookie: c, body: { requestId: uid(), expectedRevision: 5, edit: { text: "重放测试", symptoms: { cough: "重度" } } } })).json.code, "no_change");
    // 更正发生时间：保留精度；非法时间被拒
    const t = await s.call("POST", `entries/${id}/corrections`, { cookie: c, body: { requestId: uid(), expectedRevision: 5, edit: { text: "重放测试", symptoms: { cough: "重度" }, when: { mode: "date", date: "2026-09-20", precision: "minute", time: "21:10" } } } });
    assert.deepEqual(t.json.record.occurred, { at: "2026-09-20T21:10", precision: "minute", basis: "parent_reported_date" });
    assert.equal((await s.call("POST", `entries/${id}/corrections`, { cookie: c, body: { requestId: uid(), expectedRevision: 6, edit: { text: "重放测试", symptoms: { cough: "重度" }, when: { mode: "date", date: "2026-10-30" } } } })).status, 400);
  } finally { await s.cleanup(); }
});

// ============ 5 撤销/恢复；旧字段历史保留；新表单不改写既有事实 ============
test("5 撤销与恢复；旧记录及旧字段仍在且不被改写", async () => {
  const s = await setup();
  try {
    // 先放进一条“旧样例事实”（HEALTH-02 形态：用药 + 剂量对象 + 微信来源）
    const store = new HealthFileStore(path.join(s.root, "ledger"));
    await runImport(store, { batchId: "legacy-fixture", items: [
      { kind: "source", id: "wechat:legacy-1", content: { messageIdentity: "legacy-1", layer: "wechat", recordedAt: "2026-09-10T08:00:00", speaker: "妈妈", conversation: "示例" } },
      { kind: "observation", id: "legacy-obs-1", content: { role: "medication_administered", factKind: "medication_administered", layer: "wechat", recordedAt: "2026-09-10T08:00:00", occurredAt: "2026-09-10T07:50", occurredPrecision: "minute", timeBasis: "message_time", speaker: "妈妈", text: "喂了示例退烧药", dose: { value: 5, unit: "ml" }, measure: { value: 37.6, unit: "℃", method: "耳温" }, sleepQuality: "差", mood: "一般" },
        links: [{ role: "from_source", to: { kind: "source", id: "wechat:legacy-1" } }] },
    ] }, { apply: true, now: () => "2026-09-10T09:00:00.000Z" });
    const beforeLedger = await store.read();
    const legacyBefore = JSON.stringify(beforeLedger.entities["observation:legacy-obs-1"]) + JSON.stringify(beforeLedger.entities["source:wechat:legacy-1"]);
    const c = await s.login("mom");
    const list0 = (await s.call("GET", "entries?limit=50", { cookie: c })).json.items;
    const legacy = list0.find((i) => i.id === "legacy-obs-1");
    assert.ok(legacy && legacy.kind === "legacy" && legacy.editable === false);
    assert.deepEqual(legacy.legacy.dose, { value: 5, unit: "ml" }); assert.equal(legacy.legacy.measure.method, "耳温"); assert.equal(legacy.legacy.sleepQuality, "差"); assert.equal(legacy.legacy.mood, "一般");
    // 新表单能力：新增、更正、撤销、恢复，都不改写旧事实；旧记录不能在这里更正
    const made = await s.call("POST", "entries", { cookie: c, body: noteBody({ text: "记错孩子测试", symptoms: { nose: "清鼻涕" } }) });
    const id = made.json.record.id;
    assert.equal((await s.call("POST", "entries/legacy-obs-1/corrections", { cookie: c, body: { requestId: uid(), expectedRevision: 1, edit: { text: "改" } } })).status, 403);
    assert.equal((await s.call("POST", "entries/legacy-obs-1/attribution", { cookie: c, body: { requestId: uid(), expectedRevision: 1, action: "void" } })).status, 403);
    const voided = await s.call("POST", `entries/${id}/attribution`, { cookie: c, body: { requestId: uid(), expectedRevision: 1, action: "void" } });
    assert.equal(voided.status, 200); assert.equal(voided.json.record.voided, true);
    assert.equal(voided.json.record.text, "记错孩子测试", "撤销后内容仍在");
    assert.equal(voided.json.history.at(-1).reason, "记错了孩子");
    assert.equal((await s.call("GET", "entries?limit=50", { cookie: c })).json.items.find((i) => i.id === id).voided, true, "已撤销的仍在列表里，带标记");
    assert.equal((await s.call("POST", `entries/${id}/attribution`, { cookie: c, body: { requestId: uid(), expectedRevision: 2, action: "void" } })).json.code, "no_change");
    const restored = await s.call("POST", `entries/${id}/attribution`, { cookie: c, body: { requestId: uid(), expectedRevision: 2, action: "restore" } });
    assert.equal(restored.json.record.voided, false); assert.equal(restored.json.record.revision, 3);
    assert.deepEqual(restored.json.history.filter((h) => h.kind === "corrected").map((h) => h.changes[0].after), ["not_child", "child"], "撤销和恢复都留在历史里");
    // 撤销的并发保护：旧修订号被拒
    assert.equal((await s.call("POST", `entries/${id}/attribution`, { cookie: c, body: { requestId: uid(), expectedRevision: 1, action: "void" } })).json.code, "revision_conflict");
    // 旧样例事实字节级不变
    const after = await store.read();
    assert.equal(JSON.stringify(after.entities["observation:legacy-obs-1"]) + JSON.stringify(after.entities["source:wechat:legacy-1"]), legacyBefore, "既有样例事实没有被改写");
    assert.equal(after.corrections.filter((x) => x.ref?.id === "legacy-obs-1").length, 0);
    assert.notEqual(businessDigest(after), businessDigest(beforeLedger), "新记录确实写进了账本");
    const detail = (await s.call("GET", "entries/legacy-obs-1", { cookie: c })).json;
    assert.equal(detail.record.legacy.dose.unit, "ml");
  } finally { await s.cleanup(); }
});

// ============ R1-B 私有路径：检查真实落点（符号链接 / junction） ============
test("R1-B 指向仓库的目录链接被拒；写入时也检查真实落点；正常私有目录通过", async () => {
  const repo = path.resolve(process.cwd(), "..");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "health-record-link-"));
  try {
    const link = path.join(tmp, "link-to-repo");
    await symlink(repo, link, "junction");
    for (const root of [link, path.join(link, "v2", "hr-should-not-exist"), path.join(link, "deep", "er", "still-not-there")]) {
      const r = loadHealthRecordConfig(ENV(root));
      assert.equal(r.ok, false, root); assert.match(r.reason, /inside the repository/);
    }
    assert.equal(await readdir(path.join(repo, "v2")).then((l) => l.includes("hr-should-not-exist")), false, "没有向仓库里创建任何东西");
    const good = loadHealthRecordConfig(ENV(path.join(tmp, "private-root")));
    assert.equal(good.ok, true, "正常私有目录通过");
    // 配置检查通过后，数据根目录里又出现指向仓库的链接：写入前再次检查真实落点，拒绝且不落盘
    const s = await setup({ cwd: process.cwd() });
    try {
      const c = await s.login("mom");
      await mkdir(s.root, { recursive: true });
      const victim = path.join(repo, "v2", "test");
      const before = (await readdir(victim)).sort().join(",");
      await symlink(victim, path.join(s.root, "originals"), "junction");
      const img = await jpeg();
      const r = await s.call("POST", "entries", { cookie: c, body: { type: "visit", entryId: uid(), note: "x" }, files: [{ name: "a.jpg", data: img }] });
      assert.equal(r.status, 500); assert.equal(r.json.code, "private_path");
      assert.equal((await readdir(victim)).sort().join(","), before, "仓库目录没有被写入");
      assert.equal((await s.call("GET", "entries", { cookie: c })).json.code, "private_path");
    } finally { await s.cleanup(); }
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

// ============ R1-C 原图保真：同长度损坏不能被当作有效原图 ============
test("R1-C 同长度损坏的原图：读取拒绝，重放上传用已核验字节修复；正常重试不增加副本", async () => {
  const s = await setup();
  try {
    const c = await s.login("mom");
    const img = await jpeg(90, 60, { r: 30, g: 90, b: 160 });
    const req = { type: "visit", entryId: uid(), note: "保真" };
    const first = await s.call("POST", "entries", { cookie: c, body: req, files: [{ name: "a.jpg", data: img }] });
    const sha = first.json.record.images[0].sha256;
    const file = path.join(s.root, "originals", sha + ".jpg");
    const names = async () => (await readdir(path.join(s.root, "originals"))).sort();
    // 正常重试：内容一致，不产生任何 .corrupt 副本，读回逐字节一致
    assert.equal((await s.call("POST", "entries", { cookie: c, body: req, files: [{ name: "a.jpg", data: img }] })).json.duplicate, true);
    assert.deepEqual(await names(), [sha + ".jpg"]);
    assert.ok((await s.call("GET", "originals/" + sha, { cookie: c })).buf.equals(img));
    // 同长度不同字节的损坏
    const bad = Buffer.from(img); bad[Math.floor(bad.length / 2)] ^= 0xff; assert.equal(bad.length, img.length);
    await writeFile(file, bad);
    const denied = await s.call("GET", "originals/" + sha, { cookie: c });
    assert.equal(denied.status, 500); assert.equal(denied.json.code, "original_corrupt");
    assert.ok(!denied.buf, "已知损坏的内容不作为有效原图返回");
    assert.equal((await s.call("GET", "originals/" + sha + "?thumb=1", { cookie: c })).status, 200, "缩略图仍可预览，但不代替原件");
    // 重放同一次上传：不静默成功——损坏副本被保留，原件用已核验的上传字节修复
    assert.equal((await s.call("POST", "entries", { cookie: c, body: req, files: [{ name: "a.jpg", data: img }] })).status, 200);
    const after = await names();
    assert.equal(after.length, 2); assert.ok(after.some((n) => n.includes(".corrupt-")));
    assert.ok((await readFile(file)).equals(img), "原图已恢复为逐字节一致");
    assert.ok((await s.call("GET", "originals/" + sha, { cookie: c })).buf.equals(img));
  } finally { await s.cleanup(); }
});
