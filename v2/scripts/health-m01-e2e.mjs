// HEALTH-M01-A phone check: the episode reading and the two kinds of measures really appear on /health, folds and access stay as before.
// Build first:  NEXT_DIST_DIR=.next-hm1 npx next build        Run from v2/:  HM_DATA=<dir> node scripts/health-m01-e2e.mjs
// HM_DATA holds read-only copies: history-ledger/, intervals.json, materials.json, derived.json, analyses-preview.json (a PREVIEW adoption on a copy,
// not a review). The record root is a fresh empty directory; credentials are synthetic and exist only for this run.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const DATA = process.env.HM_DATA, OUT = process.env.HM_OUT ?? path.join(DATA, "..", "screens");
if (!DATA) throw new Error("HM_DATA is required");
const REC = path.join(OUT, "record-root-empty"), PORT = Number(process.env.HM_PORT ?? 3431), BASE = `http://127.0.0.1:${PORT}`;
const MATROOT = process.env.HM_MATERIAL_ROOT ?? "C:/Users/teddy/NianlifeOps/health-tracking/2026-09-20";
const MOM = `mom-${randomUUID()}`;
rmSync(REC, { recursive: true, force: true }); mkdirSync(REC, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const files = ["history-ledger/ledger.json", "intervals.json", "materials.json", "derived.json", "analyses-preview.json"].map((f) => path.join(DATA, f));
const before = Object.fromEntries(files.map((f) => [f, sha(f)]));

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
  env: { ...process.env, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next-hm1", HEALTH_RECORD_ROOT: REC, HEALTH_RECORD_SESSION_SECRET: randomUUID() + randomUUID(), HEALTH_RECORD_MOM_PASSWORD: MOM, HEALTH_RECORD_DAD_PASSWORD: `dad-${randomUUID()}`, HEALTH_RECORD_COOKIE_SECURE: "0",
    HEALTH_HISTORY_LEDGER: path.join(DATA, "history-ledger"), HEALTH_PAGE_INTERVALS: path.join(DATA, "intervals.json"), HEALTH_PAGE_MATERIALS: path.join(DATA, "materials.json"), HEALTH_PAGE_DERIVED: path.join(DATA, "derived.json"), HEALTH_PAGE_ANALYSES: path.join(DATA, "analyses-preview.json"), HEALTH_PAGE_EVIDENCE: path.join(DATA, "evidence", "register.json"), HEALTH_PAGE_MATERIAL_ROOT: MATROOT },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
const stop = () => { try { server.kill(); } catch { /* gone */ } };
process.on("exit", stop);
async function waitUp() { for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/api/health-record/session`)).status === 401) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error("server did not start\n" + log.slice(-800)); }

const browser = await chromium.launch();
try {
  await waitUp();
  const raw = await (await fetch(`${BASE}/health`)).text();
  check("未登录：/health 不含病程分析正文", !/病程总结|辅助分析|支气管炎|观察与护理/.test(raw));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, baseURL: BASE });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/health/record");
  await page.click('[data-who="mom"]'); await page.fill("#hr-pw", MOM); await page.click('button[type="submit"]'); await page.waitForSelector("nav.tabs", { state: "visible" });
  await page.goto("/health");
  await page.waitForSelector("#hp-tl");
  const folds = await page.evaluate(() => ({ epOpen: [...document.querySelectorAll("details.hp-epi")].filter((d) => d.open).length, grpOpen: [...document.querySelectorAll("details.hp-grp")].filter((d) => d.open).length, reads: document.querySelectorAll(".hp-read").length }));
  check("默认折叠：病程、后续措施两组都没有展开（分析在折叠的病程里）", folds.epOpen === 0 && folds.grpOpen === 0, JSON.stringify(folds));
  // open the newest respiratory episode on the phone and read it
  await page.evaluate(() => { for (const d of document.querySelectorAll("details.hp-cat")) d.open = true; });
  const ep = page.locator("#ep-EP-E"); await ep.scrollIntoViewIfNeeded(); await ep.locator("summary").first().click();
  await page.waitForSelector("#ep-EP-E .hp-read");
  const txt = await ep.locator(".hp-sum").innerText();
  check("手机：最近病程展开后出现病程总结、四层来源（医生/家长/汇总稿转述/辅助推断）和不确定项", /急性喘息性支气管炎/.test(txt) && /医生诊断\/病历：/.test(txt) && /家长报告：/.test(txt) && /汇总稿转述：/.test(txt) && /辅助推断：/.test(txt) && /不能确定：/.test(txt));
  check("手机：写明截至资料日期，历史状态不冒充今天；标明不是医生意见与采用记录", /截至 9月20日 的资料/.test(txt) && /今天（9 月 21 日）的状态没有记录/.test(txt) && /不是医生的诊断或意见/.test(txt) && /已采用：预览副本/.test(txt));
  await ep.locator(".hp-sum").screenshot({ path: path.join(OUT, "m01-ep-e-phone.png") });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check("手机：没有横向溢出", !overflow);
  // the two kinds of measures
  await page.evaluate(() => { for (const d of document.querySelectorAll("details.hp-grp")) d.open = true; });
  const care = await page.locator("#g-care .hp-it").allInnerTexts(), visit = await page.locator("#g-visit .hp-it").allInnerTexts();
  check("手机：「观察与护理」出现本病程的措施，带适用前提", care.some((t) => /随访期内每天留意咳嗽/.test(t) && /适用前提/.test(t)) && care.some((t) => /安静状态下数满 1 分钟/.test(t)), `${care.length} 项`);
  check("手机：「就医安排」出现条件性警示与下次问医生的问题，且没有剂量", visit.some((t) => /^立即行动/.test(t.trim()) && /呼吸明显费力/.test(t)) && visit.some((t) => /当天联系医生/.test(t)) && !visit.some((t) => /当天去看医生或急诊/.test(t)) && visit.some((t) => /下次见医生时问/.test(t)) && !visit.concat(care).some((t) => /\d+(\.\d+)?\s*(mg|毫克|ml|毫升)/.test(t)));
  check("措施逐条带病程标签；没有出现预约或吃药提醒", (await page.locator("#g-visit .hp-it .chip.ep").count()) >= 5);
  await page.locator("#g-care").scrollIntoViewIfNeeded(); await page.locator("#g-care").screenshot({ path: path.join(OUT, "m01-measures-phone.png") });
  const cats = await page.evaluate(() => ({ cat: [...document.querySelectorAll("details.hp-cat > summary")].map((s) => s.innerText.replace(/\s+/g, " ").trim()) }));
  check("分类：发热+呼吸道感染（与烫伤重叠）只在呼吸道类，烫伤类只有烫伤", cats.cat.some((c) => /烫/.test(c)) && (await page.locator("details.hp-cat:has(#ep-EP-C) > summary").innerText()).indexOf("烫") < 0, cats.cat.join(" | "));
  check("没有页面错误", errors.length === 0, errors.join("|").slice(0, 200));
  await ctx.close();
} finally { await browser.close(); stop(); }
const after = Object.fromEntries(files.map((f) => [f, sha(f)]));
check("只读输入哈希前后一致", files.every((f) => before[f] === after[f]));
writeFileSync(path.join(OUT, "m01-e2e-results.json"), JSON.stringify({ results, inputs: after }, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
