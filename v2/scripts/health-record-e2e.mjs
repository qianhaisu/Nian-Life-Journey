// HEALTH-03 group 6: one real 390x844 browser pass (note -> visit -> view/correct) plus a desktop overflow/readability look.
// Needs a production build in NEXT_DIST_DIR (default .next-hr3):  NEXT_DIST_DIR=.next-hr3 npx next build
// Run from v2/:   node scripts/health-record-e2e.mjs
// Synthetic data only, in a private directory OUTSIDE the repo; loopback server; no database, no network, no deploy.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { chromium } from "playwright";

const OUT = process.env.HR_E2E_OUT ?? "C:/Users/teddy/NianlifeOps/health-tracking/2026-09-21/health-03-implementation";
const DATA = path.join(OUT, "data");
const SHOTS = path.join(OUT, "screens");
const PORT = Number(process.env.HR_E2E_PORT ?? 3417);
const BASE = `http://127.0.0.1:${PORT}`;
const MOM = "mom-e2e-synthetic-pw", DAD = "dad-e2e-synthetic-pw";
rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true }); mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
  env: { ...process.env, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next-hr3", HEALTH_RECORD_ROOT: DATA, HEALTH_RECORD_SESSION_SECRET: "e2e-".padEnd(48, "s"), HEALTH_RECORD_MOM_PASSWORD: MOM, HEALTH_RECORD_DAD_PASSWORD: DAD, HEALTH_RECORD_COOKIE_SECURE: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = ""; server.stdout.on("data", (d) => (serverLog += d)); server.stderr.on("data", (d) => (serverLog += d));
const stop = () => { try { server.kill(); } catch { /* already gone */ } };
process.on("exit", stop);

async function waitUp() {
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/api/health-record/session`); if (r.status === 401) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("server did not start\n" + serverLog.slice(-800));
}
const img = (w, h, rgb, orientation) => { let s = sharp({ create: { width: w, height: h, channels: 3, background: rgb } }); if (orientation) s = s.withMetadata({ orientation }); return s.jpeg().toBuffer(); };

const browser = await chromium.launch();
try {
  await waitUp();
  const IMGA = path.join(OUT, "synthetic-report-A.jpg"), IMGB = path.join(OUT, "synthetic-report-B.jpg");
  writeFileSync(IMGA, await img(600, 800, { r: 214, g: 128, b: 96 }, 6)); writeFileSync(IMGB, await img(640, 480, { r: 88, g: 140, b: 200 }));

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, baseURL: BASE });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !/401|409|422|413/.test(m.text())) errors.push(m.text()); });
  const shot = async (n) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(SHOTS, `m-${n}.png`) }); };
  const overflow = () => page.evaluate(() => { const el = document.querySelector(".hr-root"); return el.scrollWidth > el.clientWidth + 1; });
  const txt = (sel) => page.locator(sel).first().innerText();

  // ---- 未登录 ----
  await page.goto("/health/record");
  check("未登录：只看到登录，看不到记录内容", (await page.locator("#hr-pw").count()) === 1 && !(await page.content()).includes("爸妈手记"));
  const anon = await page.evaluate(async () => (await fetch("/api/health-record/entries")).status);
  check("未登录：读取接口 401", anon === 401);
  await page.click('[data-who="mom"]'); await page.fill("#hr-pw", "wrong-password-x"); await page.click('button[type="submit"]');
  await page.waitForSelector(".err"); check("错误密码：提示且不进入", /密码不对/.test(await txt(".err")));
  await shotIf(page, "01-login");
  await page.fill("#hr-pw", MOM); await page.click('button[type="submit"]');
  await page.waitForSelector("nav.tabs");
  check("登录后三个入口", (await txt("nav.tabs")).replace(/[^一-龥]/g, "") === "爸妈手记就医已记录");
  check("手机无横向溢出（手记）", !(await overflow()));
  await shot("02-note-default");

  // ---- 手记 ----
  await page.fill("#hr-text", "夜里咳嗽，睡前哄了很久");
  await page.click('[data-when="now"]');
  await page.click("details.more summary");
  await page.fill("#hr-temp", "37.8");
  await page.click('.chip:has-text("浓鼻涕")'); await page.click('.chip:has-text("轻微")'); await page.click('.chip:has-text("有鼻音")');
  await page.click('.chip:has-text("哄睡困难")'); await page.click('.chip:has-text("夜醒多")');
  await page.click('.chip:has-text("夜醒多")'); // 再点取消
  check("睡眠：选两项后可取消一项", (await page.locator('.chip:has-text("哄睡困难")').getAttribute("aria-pressed")) === "true" && (await page.locator('.chip:has-text("夜醒多")').getAttribute("aria-pressed")) === "false");
  await page.click('.chip:has-text("夜醒多")');
  await shot("03-note-expanded");
  await page.click(".btn.block:visible");
  await page.waitForSelector(".card:visible .ok");
  check("手记保存成功（服务端提交后才提示）", /已保存/.test(await txt(".card:visible")) && /浓鼻涕/.test(await txt(".card:visible")) && /37.8/.test(await txt(".card:visible")));
  await shot("04-note-saved");

  // ---- 就医 ----
  await page.click('nav.tabs [data-tab="visit"]');
  await page.click('.chip:has-text("市儿童医院")'); await page.click('[aria-label="科室"] .chip:has-text("其他")');
  await page.fill("#hr-do", "中医儿科（合成）");
  await page.setInputFiles("#hr-files", [IMGA, IMGB]);
  await page.waitForFunction(() => document.querySelectorAll(".thumb img").length === 2 && [...document.querySelectorAll(".thumb img")].every((i) => i.naturalWidth > 0));
  check("上传两张图并出现预览", (await page.locator(".thumb img").count()) === 2);
  await page.click(".thumb .rm >> nth=1");
  check("可以移除未提交的图片", (await page.locator(".thumb img").count()) === 1);
  await page.setInputFiles("#hr-files", [IMGB]);
  await page.waitForFunction(() => document.querySelectorAll(".thumb img").length === 2);
  await page.fill("#hr-note", "医生说先观察两天，晚上超过 38.5 再来。");
  check("手机无横向溢出（就医）", !(await overflow()));
  await shot("05-visit-filled");
  await page.click(".btn.block:visible"); await page.waitForSelector(".card:visible .ok");
  check("就医保存成功，未填日期显示未知", /已保存/.test(await txt(".card:visible")) && /就医日期未知/.test(await txt(".card:visible")));

  // ---- 已记录：查看 / 原图 / 更正 / 历史 ----
  await page.click("nav.tabs [data-tab=hist]");
  await page.waitForSelector("[data-rec]");
  check("已记录里有刚才两条", (await page.locator("[data-rec]").count()) === 2);
  await shot("06-history-list");
  await page.click('[data-rec]:has-text("市儿童医院")');
  await page.waitForSelector(".sheet .thumb img");
  const imgsOk = await page.evaluate(async () => { const ims = [...document.querySelectorAll(".sheet .thumb img")]; await Promise.all(ims.map((i) => i.decode().catch(() => {}))); return ims.length === 2 && ims.every((i) => i.naturalWidth > 0); });
  check("详情：报告图缩略图通过授权接口显示", imgsOk);
  const origStatus = await page.evaluate(async () => { const a = document.querySelector(".sheet a.thumb"); const r = await fetch(a.href); return { s: r.status, t: r.headers.get("content-type") }; });
  check("原图可读（已登录），且是图片", origStatus.s === 200 && /^image\//.test(origStatus.t));
  const orient = await page.evaluate(async () => { const a = document.querySelector(".sheet a.thumb img"); return { w: a.naturalWidth, h: a.naturalHeight }; });
  check("EXIF 旋转图的预览方向正确（600x800 且 orientation=6 → 横向）", orient.w > orient.h, JSON.stringify(orient));
  await shot("07-visit-detail");
  await page.click('.sheet .btn:has-text("更正")');
  await page.fill("#hr-enote", "医生说先观察三天，晚上超过 38.5 再来。");
  await page.fill("#hr-reason", "听错了天数");
  await shot("08-correct-form");
  // 另一位家长在此时改了同一条：走真实 API（爸爸的会话）
  const dadCtx = await browser.newContext({ baseURL: BASE }); const dad = dadCtx.request;
  const H = { origin: BASE, "content-type": "application/json" };
  const lg = await dad.post("/api/health-record/session", { headers: H, data: { who: "dad", password: DAD } }); check("爸爸能用自己的密码登录", lg.status() === 200);
  const id = await page.evaluate(() => document.querySelector("[data-rec]") ? "" : "");
  const list = await (await dad.get("/api/health-record/entries")).json();
  const visitId = list.items.find((x) => x.kind === "visit").id;
  const other = await dad.post(`/api/health-record/entries/${visitId}/corrections`, { headers: H, data: { requestId: "dad-req-" + "d".repeat(16), expectedRevision: 1, edit: { hospital: "市儿童医院", department: "其他", departmentOther: "中医儿科（合成）", note: "爸爸改：医生说观察一周。" } } });
  check("同时另一位家长已更正同一条", other.status() === 200);
  await page.click('.sheet .btn:has-text("保存更正")');
  await page.waitForSelector('[data-conflict="1"]');
  const cf = await txt('[data-conflict="1"]');
  check("冲突：明确说“你的改动还没保存”，并给出当前值与你的草稿", /还没有保存/.test(cf) && /爸爸改：医生说观察一周/.test(cf) && /先观察三天/.test(cf) && /当前值/.test(cf) && /你的草稿/.test(cf));
  check("冲突时草稿没有被清掉", (await page.inputValue("#hr-enote")).includes("先观察三天"));
  await shot("09-conflict");
  await page.click('[data-conflict] .btn:has-text("用我的草稿")');
  await page.waitForSelector('.sheet .diff');
  const histTxt = await txt(".sheet");
  check("用户明确选择后追加更正；历史里保留双方与前值", /观察一周/.test(histTxt) && /观察三天/.test(histTxt) && /爸爸/.test(histTxt) && /妈妈/.test(histTxt));
  await shot("10-history-after");
  await page.click('.sheet .btn:has-text("这条记错孩子了")');
  await page.waitForSelector('.sheet .note');
  check("记错孩子：已撤销归属，内容与历史仍在", /已撤销归属/.test(await txt(".sheet")) && /先观察三天/.test(await txt(".sheet")));
  await page.click('.sheet .btn:has-text("恢复归属")');
  await page.waitForFunction(() => !document.querySelector(".sheet .note"));
  check("可恢复归属", true);
  await page.click('.sheet .btn:has-text("关闭")');
  check("整个手机流程无脚本错误", errors.length === 0, errors.join(" | ").slice(0, 200));
  await page.evaluate(() => fetch("/api/health-record/session", { method: "DELETE" }));
  await dadCtx.close(); await ctx.close();

  // ---- 桌面：只看溢出与可读性 ----
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, baseURL: BASE });
  const dp = await dctx.newPage();
  await dp.goto("/health/record"); await dp.click('[data-who="dad"]'); await dp.fill("#hr-pw", DAD); await dp.click('button[type="submit"]'); await dp.waitForSelector("nav.tabs");
  await dp.click("nav.tabs [data-tab=hist]"); await dp.waitForSelector("[data-rec]");
  const dOver = await dp.evaluate(() => { const el = document.querySelector(".hr-root"); return el.scrollWidth > el.clientWidth + 1; });
  const w = await dp.evaluate(() => document.querySelector(".hr-app").getBoundingClientRect().width);
  check("桌面：无横向溢出，内容区宽度合理", !dOver && w >= 400 && w <= 620, `app width ${Math.round(w)}`);
  await dp.screenshot({ path: path.join(SHOTS, "d-01-history.png") });
  await dctx.close();
} finally {
  await browser.close(); stop();
}
async function shotIf(page, n) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, `m-${n}.png`) }); }
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} 项通过`);
writeFileSync(path.join(OUT, "e2e-results.json"), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 1));
process.exit(pass === results.length ? 0 : 1);
