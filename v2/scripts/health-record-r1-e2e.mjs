// HEALTH-03-R1 group A: draft survival and exact-replay retries in a real 390x844 browser.
//   1 图文草稿：切标签返回不丢   2 会话过期(401)后同身份恢复，异身份不带走   3 提交成功但响应丢失 -> 锁定并原样重试，不重复、时间不漂移
//   4 其他 -> 固定医院/科室后可保存   5 显式退出丢弃草稿
// Needs the production build:  NEXT_DIST_DIR=.next-hr3 npx next build      Run from v2/:  node scripts/health-record-r1-e2e.mjs
// Synthetic data only, private directory outside the repo, loopback server.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { chromium } from "playwright";

const OUT = process.env.HR_R1_OUT ?? "C:/Users/teddy/NianlifeOps/health-tracking/2026-09-21/health-03-r1";
const DATA = path.join(OUT, "data"), SHOTS = path.join(OUT, "screens");
const PORT = Number(process.env.HR_R1_PORT ?? 3418), BASE = `http://127.0.0.1:${PORT}`;
const MOM = "mom-r1-synthetic-pw", DAD = "dad-r1-synthetic-pw";
rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
  env: { ...process.env, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next-hr3", HEALTH_RECORD_ROOT: DATA, HEALTH_RECORD_SESSION_SECRET: "r1-".padEnd(48, "s"), HEALTH_RECORD_MOM_PASSWORD: MOM, HEALTH_RECORD_DAD_PASSWORD: DAD, HEALTH_RECORD_COOKIE_SECURE: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
const stop = () => { try { server.kill(); } catch { /* gone */ } };
process.on("exit", stop);
async function waitUp() { for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/health-record/session`)).status === 401) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error("server did not start\n" + log.slice(-600)); }

const browser = await chromium.launch();
try {
  await waitUp();
  const IMG = path.join(OUT, "synthetic-A.jpg");
  writeFileSync(IMG, await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: 200, g: 120, b: 90 } } }).jpeg().toBuffer());

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, baseURL: BASE });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !/401|409|422|Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.clock.install({ time: new Date() });
  const shot = async (n) => { await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, `m-${n}.png`) }); };
  const login = async (who, pw) => { await page.click(`[data-who="${who}"]`); await page.fill("#hr-pw", pw); await page.click('button[type="submit"]'); await page.waitForSelector("nav.tabs", { state: "visible" }); };
  const tab = (t) => page.click(`nav.tabs [data-tab="${t}"]`);
  const api = async (p) => page.evaluate(async (u) => (await fetch(`/api/health-record/${u}`)).json(), p);

  await page.goto("/health/record"); await login("mom", MOM);

  // ---- 1 图文草稿：切标签返回不丢 ----
  await tab("visit");
  await page.click('[aria-label="医院"] .chip:has-text("其他")'); await page.fill("#hr-ho", "社区门诊（合成）");
  await page.click('[aria-label="科室"] .chip:has-text("其他")'); await page.fill("#hr-do", "中医儿科（合成）");
  await page.setInputFiles("#hr-files", [IMG]); await page.waitForSelector(".thumb img");
  await page.fill("#hr-note", "医生说先观察");
  await tab("note"); await page.fill("#hr-text", "夜里咳嗽"); await page.click('[data-when="today"]');
  await tab("hist"); await tab("visit");
  check("1 切到别的标签再回来：就医的图片、医院/科室文字、备注都还在", (await page.locator(".thumb img").count()) === 1 && (await page.inputValue("#hr-ho")) === "社区门诊（合成）" && (await page.inputValue("#hr-do")) === "中医儿科（合成）" && (await page.inputValue("#hr-note")) === "医生说先观察");
  await tab("note");
  check("1 手记的文字和所选发生时间也还在", (await page.inputValue("#hr-text")) === "夜里咳嗽" && (await page.locator('[data-when="today"]').getAttribute("aria-pressed")) === "true");
  await shot("01-drafts-kept");

  // ---- 4 其他 -> 固定选项：隐藏的其他文字不再发出 ----
  await tab("visit");
  await page.click('[aria-label="医院"] .chip:has-text("浙一")'); await page.click('[aria-label="科室"] .chip:has-text("外科")');
  check("4 改选固定医院/科室后，其他文字框收起", (await page.locator("#hr-ho, #hr-do").count()) === 0);

  // ---- 2 会话过期：图文不丢；同身份恢复；异身份不带走 ----
  await ctx.clearCookies();
  await page.click(".btn.block:visible");
  await page.waitForSelector("#hr-pw", { state: "visible" });
  check("2 会话过期后回到登录，且没有假装保存成功", (await page.locator(".card .ok").count()) === 0 && (await api("entries")).code === "unauthenticated");
  await page.click('[data-who="dad"]');
  check("2 换成爸爸登录：提示妈妈的草稿不会带给他", /不会带给你/.test(await page.locator(".login .note").innerText()));
  await shot("02-login-draft-notice");
  await page.click('[data-who="mom"]'); await page.fill("#hr-pw", MOM); await page.click('button[type="submit"]'); await page.waitForSelector("nav.tabs", { state: "visible" });
  await tab("visit");
  check("2 同一位妈妈重新登录：图片和备注恢复", (await page.locator(".thumb img").count()) === 1 && (await page.inputValue("#hr-note")) === "医生说先观察");
  await page.click(".btn.block:visible"); await page.waitForSelector(".card .ok");
  const list1 = await api("entries?limit=50");
  const visit = list1.items.find((x) => x.kind === "visit");
  check("4 保存成功：医院=浙一、科室=外科，隐藏的其他文字没有被发出（否则会被拒）", visit && visit.hospital === "浙一" && visit.department === "外科" && !visit.hospitalOther && !visit.departmentOther && visit.images.length === 1);

  // ---- 3 提交成功但响应丢失：锁定并原样重试 ----
  await tab("note"); await page.click('[data-act], .card .btn.sec:has-text("再记一条")').catch(() => {});
  await page.waitForSelector("#hr-text");
  await page.fill("#hr-text", "刚刚咳了一阵"); await page.click('[data-when="now"]');
  const nowHint = (await page.locator("p.hint:has-text('发生时间记为')").innerText()).match(/(\d\d:\d\d)/)[1];
  let dropped = 0;
  await page.route("**/api/health-record/entries", async (route) => {
    if (route.request().method() === "POST" && dropped === 0) { dropped++; await route.fetch(); await route.abort("failed"); } else await route.continue();
  });
  await page.click(".btn.block:visible");
  await page.waitForSelector(".err:has-text('结果不确定')");
  const noteCount = () => api("entries?limit=50").then((j) => j.items.filter((x) => x.kind === "note").length);
  check("3 响应丢了：页面说“结果不确定”，而服务端其实已保存 1 条", (await noteCount()) === 1);
  check("3 此时表单被锁定，不能再改内容", await page.locator("#hr-text").isDisabled());
  await shot("03-uncertain-locked");
  await page.clock.fastForward("05:00");
  await page.click(".btn.block:visible"); await page.waitForSelector(".card .ok");
  const notes = (await api("entries?limit=50")).items.filter((x) => x.kind === "note");
  check("3 原样重试：仍然只有 1 条（没有重复，也没有 409）", notes.length === 1);
  check("3 发生时间是点“刚刚”那一刻，重试晚了 5 分钟也不变", notes[0].occurred.at.endsWith(nowHint), `${notes[0].occurred.at} vs ${nowHint}`);

  // ---- 5 显式退出丢弃草稿，不给下一位 ----
  await page.click('.card .btn.sec:has-text("再记一条")'); await page.fill("#hr-text", "妈妈没写完");
  await page.click('button:has-text("退出")'); await page.waitForSelector("#hr-pw", { state: "visible" });
  check("5 显式退出后登录页没有“草稿保留”的提示", (await page.locator(".login .note").count()) === 0);
  await login("dad", DAD);
  check("5 爸爸登录后手记是空白的，没有拿到妈妈的草稿", (await page.inputValue("#hr-text")) === "");
  check("整个流程无脚本错误", errors.length === 0, errors.join(" | ").slice(0, 200));
  await ctx.close();
} finally { await browser.close(); stop(); }
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} 项通过`);
writeFileSync(path.join(OUT, "r1-e2e-results.json"), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 1));
process.exit(pass === results.length ? 0 : 1);
