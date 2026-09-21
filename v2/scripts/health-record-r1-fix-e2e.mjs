// HEALTH-03-R1 fix: "结果未知 -> 重试遇到 401 -> 同身份重新登录 -> 原样重放" in a real 390x844 browser.
// One continuous chain for a NEW note and for a CORRECTION (shared status logic; void/restore use the same Sheet.send path).
// Needs the production build:  NEXT_DIST_DIR=.next-hr3 npx next build     Run from v2/:  node scripts/health-record-r1-fix-e2e.mjs
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT = process.env.HR_FIX_OUT ?? "C:/Users/teddy/NianlifeOps/health-tracking/2026-09-21/health-03-r1-fix";
const DATA = path.join(OUT, "data"), SHOTS = path.join(OUT, "screens");
const PORT = Number(process.env.HR_FIX_PORT ?? 3420), BASE = `http://127.0.0.1:${PORT}`;
const MOM = "mom-fix-synthetic-pw";
rmSync(DATA, { recursive: true, force: true }); mkdirSync(DATA, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
  env: { ...process.env, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next-hr3", HEALTH_RECORD_ROOT: DATA, HEALTH_RECORD_SESSION_SECRET: "fix-".padEnd(48, "s"), HEALTH_RECORD_MOM_PASSWORD: MOM, HEALTH_RECORD_DAD_PASSWORD: "dad-fix-synthetic-pw", HEALTH_RECORD_COOKIE_SECURE: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
const stop = () => { try { server.kill(); } catch { /* gone */ } };
process.on("exit", stop);
async function waitUp() { for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/health-record/session`)).status === 401) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error("server did not start\n" + log.slice(-600)); }

const browser = await chromium.launch();
try {
  await waitUp();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, baseURL: BASE });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !/401|409|422|Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
  await page.clock.install({ time: new Date() });
  const shot = async (n) => { await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, `m-${n}.png`) }); };
  const api = (p) => page.evaluate(async (u) => (await fetch(`/api/health-record/${u}`)).json(), p);
  const relogin = async () => { await page.waitForSelector("#hr-pw", { state: "visible" }); await page.click('[data-who="mom"]'); await page.fill("#hr-pw", MOM); await page.click('button[type="submit"]'); await page.waitForSelector("nav.tabs", { state: "visible" }); };
  const dropFirst = async (pattern) => { let n = 0; await page.route(pattern, async (route) => { if (route.request().method() === "POST" && n === 0) { n++; await route.fetch(); await route.abort("failed"); } else await route.continue(); }); };

  await page.goto("/health/record");
  await page.click('[data-who="mom"]'); await page.fill("#hr-pw", MOM); await page.click('button[type="submit"]'); await page.waitForSelector("nav.tabs", { state: "visible" });

  // ---- 新建：已提交但响应丢失 -> 重试 401 -> 同身份登录 -> 原样重放 ----
  await page.fill("#hr-text", "刚刚咳了一阵"); await page.click('[data-when="now"]');
  const nowHint = (await page.locator("p.hint:has-text('发生时间记为')").innerText()).match(/(\d\d:\d\d)/)[1];
  await dropFirst("**/api/health-record/entries");
  await page.click(".btn.block:visible");
  await page.waitForSelector(".err:has-text('结果不确定')");
  check("新建：响应丢失后页面说“结果不确定”，服务端其实已存 1 条", (await api("entries?limit=50")).items.filter((x) => x.kind === "note").length === 1);
  await ctx.clearCookies(); await page.clock.fastForward("05:00");
  await page.click(".btn.block:visible");
  await page.waitForSelector("#hr-pw", { state: "visible" });
  await relogin();
  const msg = await page.locator(".err").first().innerText();
  check("新建：重试遇到 401 后，提示仍是“结果不确定/可能已经保存”，没有说成“没有保存”", /仍然不确定/.test(msg) && !/这次没有保存/.test(msg), msg.slice(0, 60));
  check("新建：原请求仍被冻结（表单锁定，不能改正文后沿用同一 ID）", await page.locator("#hr-text").isDisabled());
  check("新建：仍提供“放弃这次，作为新记录”的明确出口", (await page.locator('.err button:has-text("作为新记录")').count()) === 1);
  await shot("01-note-401-still-unknown");
  await page.click(".btn.block:visible"); await page.waitForSelector(".card .ok");
  const notes = (await api("entries?limit=50")).items.filter((x) => x.kind === "note");
  check("新建：同身份登录后原样重放：仍只有 1 条，无 409，内容不变", notes.length === 1 && notes[0].text === "刚刚咳了一阵");
  check("新建：发生时间仍是点“刚刚”那一刻（重试晚了 5 分钟也不变）", notes[0].occurred.at.endsWith(nowHint), `${notes[0].occurred.at} vs ${nowHint}`);

  // ---- 更正：已提交但响应丢失 -> 重试 401 -> 同身份登录 -> 原样重放 ----
  await page.click('nav.tabs [data-tab="hist"]'); await page.click('[data-rec]:has-text("刚刚咳了一阵")');
  await page.click('.sheet .btn:has-text("更正")'); await page.fill("#hr-etext", "刚刚咳了一阵（更正：其实咳了两次）");
  await dropFirst("**/api/health-record/entries/*/corrections");
  await page.click('.sheet .btn:has-text("保存更正")');
  await page.waitForSelector('.sheet .err:has-text("不确定")');
  const id = notes[0].id;
  check("更正：响应丢失后页面说不确定，服务端其实已应用 1 次", (await api(`entries/${encodeURIComponent(id)}`)).record.revision === 2);
  await ctx.clearCookies();
  await page.click('.sheet .btn:has-text("保存更正")');
  await page.waitForSelector("#hr-pw", { state: "visible" });
  await relogin();
  const cmsg = await page.locator(".sheet .err").first().innerText();
  check("更正：重试遇到 401 后仍提示“结果不确定”，且编辑内容被冻结", /仍然不确定/.test(cmsg) && await page.locator("#hr-etext").isDisabled(), cmsg.slice(0, 50));
  await shot("02-correction-401-still-unknown");
  await page.click('.sheet .btn:has-text("保存更正")');
  await page.waitForFunction(() => !document.querySelector("#hr-etext"));
  const after = await api(`entries/${encodeURIComponent(id)}`);
  check("更正：原请求 ID 原样重放：只应用了 1 次（修订号 2，历史里 1 条更正）", after.record.revision === 2 && after.history.filter((h) => h.kind === "corrected").length === 1 && after.record.text.includes("咳了两次"));
  check("整个流程无脚本错误", errors.length === 0, errors.join(" | ").slice(0, 200));
  await ctx.close();
} finally { await browser.close(); stop(); }
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} 项通过`);
writeFileSync(path.join(OUT, "fix-e2e-results.json"), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 1));
process.exit(pass === results.length ? 0 : 1);
