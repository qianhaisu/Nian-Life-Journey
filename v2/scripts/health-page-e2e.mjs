// HEALTH-04 health page, real browser (390x844 phone + 1440 desktop) against a local production build.
// Build first:  NEXT_DIST_DIR=.next-hr4 npx next build        Run from v2/:  node scripts/health-page-e2e.mjs
// Inputs are private and read-only (a COPY of the HEALTH-02 ledger, the reviewed interval / materials files, hospital originals);
// the record root is a fresh private verification directory. Credentials are synthetic and exist only for this run.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT = process.env.HP_OUT ?? "C:/Users/teddy/NianlifeOps/health-tracking/2026-09-21/health-04-implementation";
const DATA = path.join(OUT, "data"), SHOTS = path.join(OUT, "screens"), REC = path.join(DATA, "record-root");
const PORT = Number(process.env.HP_PORT ?? 3430), BASE = `http://127.0.0.1:${PORT}`;
const MOM = `mom-${randomUUID()}`;
rmSync(REC, { recursive: true, force: true }); mkdirSync(REC, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

// ---- read-only inputs: hash before ----
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const HIST = path.join(DATA, "history-ledger", "ledger.json");
const ledger = JSON.parse(readFileSync(HIST, "utf8"));
const last = (e) => e.versions[e.versions.length - 1].content;
const originals = Object.values(ledger.entities).filter((e) => e.kind === "source" && last(e).layer === "hospital_document").map((e) => ({ id: e.id, file: path.join(last(e).root, last(e).relPath), want: last(e).sha256 }));
const inputFiles = [HIST, path.join(DATA, "intervals.json"), path.join(DATA, "materials.json"), "C:/Users/teddy/NianlifeOps/health-tracking/2026-09-21/health-02-binding-fix/ledger-full/ledger.json"];
const before = Object.fromEntries([...inputFiles, ...originals.map((o) => o.file)].map((f) => [f, sha(f)]));
check("开始时：医院原件都与账本记录的 SHA-256 一致", originals.every((o) => before[o.file] === o.want), `${originals.length} 份`);

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
  env: { ...process.env, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next-hr4", HEALTH_RECORD_ROOT: REC, HEALTH_RECORD_SESSION_SECRET: randomUUID() + randomUUID(), HEALTH_RECORD_MOM_PASSWORD: MOM, HEALTH_RECORD_DAD_PASSWORD: `dad-${randomUUID()}`, HEALTH_RECORD_COOKIE_SECURE: "0",
    HEALTH_HISTORY_LEDGER: path.join(DATA, "history-ledger"), HEALTH_HISTORY_ORIGINAL_ROOTS: "C:\\Users\\teddy\\Pictures", HEALTH_PAGE_INTERVALS: path.join(DATA, "intervals.json"), HEALTH_PAGE_MATERIALS: path.join(DATA, "materials.json") },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
const stop = () => { try { server.kill(); } catch { /* gone */ } };
process.on("exit", stop);
async function waitUp() { for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/api/health-record/session`)).status === 401) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error("server did not start\n" + log.slice(-800)); }

const SENSITIVE = ["鼻窦炎", "支气管", "发展经过", "病程总结", "克拉霉素", "history-originals"];
const browser = await chromium.launch();
try {
  await waitUp();
  // ================= 1 未登录：不泄露 =================
  {
    const raw = await (await fetch(`${BASE}/health`)).text();
    check("未登录：/health 只给登录入口，HTML 不含病程、诊断、处方或原件链接", /只给妈妈和爸爸看/.test(raw) && SENSITIVE.every((w) => !raw.includes(w)));
    const r1 = await fetch(`${BASE}/api/health-record/reminders`), r2 = await fetch(`${BASE}/api/health-record/history-originals/${encodeURIComponent(originals[0].id)}`);
    check("未登录：健康提醒接口与医院原件接口都是 401", r1.status === 401 && r2.status === 401, `${r1.status}/${r2.status}`);
    const hc = (await fetch(`${BASE}/health`)).headers.get("cache-control") ?? "";
    check("/health 响应不可被共享缓存", /private|no-store|no-cache/.test(hc), hc);
    const home = await fetch(`${BASE}/`);
    const homeHtml = await home.text();
    check("首页 HTML 不含任何健康正文或就诊详情", SENSITIVE.every((w) => !homeHtml.includes(w)) && !/预约 ·/.test(homeHtml), `status ${home.status}`);
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, baseURL: BASE });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !/401|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const shot = async (n, sel) => { await page.waitForTimeout(250); await (sel ? page.locator(sel) : page).screenshot({ path: path.join(SHOTS, `${n}.png`) }); };
  const top = (sel, off = 60) => page.evaluate(([s, o]) => { const el = document.querySelector(s); scrollTo({ top: el.getBoundingClientRect().top + scrollY - o, behavior: "instant" }); }, [sel, off]);

  await page.goto("/");
  await page.waitForTimeout(800);
  const navs = await page.locator(".bottom-nav a").allInnerTexts();
  check("主菜单：首页 / 记忆 / 健康 / 妈妈月报，一排", JSON.stringify(navs.map((s) => s.trim())) === JSON.stringify(["首页", "记忆", "健康", "妈妈月报"]));
  const lifeTags = await page.locator(".weekly-kind--life").count(), loginRow = await page.locator(".weekly-health-login").count();
  check("首页提醒区：未登录时健康只有通用登录入口（生活提醒另标“生活”；本机每周提醒数据不可用时那一块按原规则不画）", loginRow === 1 && (await page.locator(".weekly-list--health").count()) === 0, `生活标签 ${lifeTags} 个`);
  await shot("m1-home-logged-out");

  // ================= 2 登录后健康页 =================
  await page.goto("/health/record");
  await page.click('[data-who="mom"]'); await page.fill("#hr-pw", MOM); await page.click('button[type="submit"]'); await page.waitForSelector("nav.tabs", { state: "visible" });
  await page.goto("/health");
  await page.waitForSelector("#hp-tl");
  await page.waitForTimeout(400);
  await shot("m2-health-first-screen");
  const tl = await page.evaluate(() => {
    const cs = (el) => getComputedStyle(el);
    const months = [...document.querySelectorAll(".hp-mon")].map((m) => m.textContent);
    const isGreen = (s) => [...s.matchAll(/rgba?\((\d+), (\d+), (\d+)/g)].some(([, r, g, b]) => +g > +r + 30 && +g > +b + 30);
    const greens = [...document.querySelectorAll(".hp-track *, .hp-legend i")].filter((e) => isGreen(cs(e).backgroundColor + " " + cs(e).backgroundImage)).length;
    return { year: document.querySelector("[data-year][aria-pressed=true]")?.textContent, years: [...document.querySelectorAll("[data-year]")].map((b) => b.textContent), months, overview: document.querySelectorAll("#ov, .ovw, .ov-wrap").length, range: /全部|近3个月|近1个月/.test(document.querySelector("#hp-tl").textContent),
      bands: [...document.querySelectorAll(".hp-bp[data-band]")].map((b) => b.dataset.kind + ":" + b.dataset.status), greens, detailHidden: !document.querySelector(".hp-detail"), labels: document.querySelectorAll(".hp-track .dt, .hp-track .lb").length, legend: document.querySelector(".hp-legend").textContent, rt: !!document.querySelector(".hp-rt") };
  });
  check("时间轴：默认 2026 全年 1–12 月，有 2025 / 2026 切换；没有缩略图、没有旧范围按钮", tl.year === "2026" && tl.years.join() === "2025,2026" && tl.months.length === 12 && !tl.overview && !tl.range, JSON.stringify({ y: tl.years, m: tl.months.length }));
  check("时间轴：没有绿色；图例写“未标出问题区间（不代表健康）”，区分原文写明 / 疑似持续 / 只知开始", tl.greens === 0 && /未标出问题区间（不代表健康）/.test(tl.legend) && /疑似持续/.test(tl.legend) && !/未记录问题|确认健康/.test(tl.legend));
  check("时间轴：2026 年色带全部来自核查区间且都通过依据校验", tl.bands.length >= 10 && tl.bands.every((b) => /^(recorded|suspected):ok$/.test(b)), tl.bands.join(" "));
  check("时间轴：节点日期/标签/详情默认收起；入托是单独标记", tl.detailHidden && tl.labels === 0 && tl.rt);
  // node -> detail with attachment -> opens -> collapse
  await top("#hp-tl", 50);
  const node = page.locator('.hp-nd:has(svg)').last();
  await node.scrollIntoViewIfNeeded(); await node.click();
  await page.waitForSelector(".hp-detail");
  const det = await page.locator(".hp-detail").innerText();
  const att = page.locator(".hp-detail a.hp-att").first();
  const hasAtt = (await att.count()) > 0;
  check("点击节点后才显示日期、内容和附件入口", /月\d+日/.test(det) && hasAtt, det.split("\n")[0]);
  await shot("m3-node-open", "#hp-tl");
  if (hasAtt) {
    const href = await att.getAttribute("href");
    const res = await page.evaluate(async (u) => { const r = await fetch(u); return { s: r.status, t: r.headers.get("content-type"), n: (await r.arrayBuffer()).byteLength }; }, href);
    check("附件：登录后原件可打开（原始字节，图片类型）", res.s === 200 && /^image\//.test(res.t) && res.n > 1000, JSON.stringify(res));
  }
  await page.click(".hp-detail [data-act=close]");
  check("“收起”后详情隐藏", (await page.locator(".hp-detail").count()) === 0);
  // band -> suspected explanation
  const sb = page.locator('.hp-bp[data-kind="suspected"]').first();
  await sb.scrollIntoViewIfNeeded(); await sb.click();
  const bd = await page.locator(".hp-detail").innerText();
  check("点疑似区间：写明“疑似”、时间说明和依据记录", /疑似持续/.test(bd) && /依据的记录/.test(bd), bd.split("\n")[0]);
  await shot("m4-suspected-band", "#hp-tl");
  // swipe + arrows (keep the track clear of the sticky jump bar)
  await top(".hp-scroll", 220); await page.waitForTimeout(150);
  const s0 =await page.evaluate(() => document.querySelector(".hp-scroll").scrollLeft);
  const cdp = await ctx.newCDPSession(page);
  const box = await page.locator(".hp-scroll").boundingBox(); const sx = box.x + 60, sy = box.y + 40;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy }] });
  for (let i = 1; i <= 12; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: sx + i * 20, y: sy }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.waitForTimeout(400);
  const s1 = await page.evaluate(() => document.querySelector(".hp-scroll").scrollLeft);
  await page.click("[data-arr='1']"); await page.waitForTimeout(700);
  const s2 = await page.evaluate(() => document.querySelector(".hp-scroll").scrollLeft);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("手机：主时间轴手指可左右滑动，左右箭头可用；整页不横滚", s1 < s0 - 100 && s2 > s1 + 100 && ov <= 0, `${s0}→${s1}→${s2}，溢出 ${ov}`);
  // year switch
  await page.click("[data-year='2026']");
  const n0 = await page.locator(".hp-nd").first(); await n0.scrollIntoViewIfNeeded(); await n0.click();
  await page.click("[data-year='2025']"); await page.waitForTimeout(300);
  const y25 = await page.evaluate(() => ({ hidden: !document.querySelector(".hp-detail"), sub: document.querySelector(".hp-sub").textContent, nodes: document.querySelectorAll(".hp-nd").length, bands: document.querySelectorAll(".hp-bp[data-band]").length }));
  check("切换到 2025：详细轴同步显示 2025 的节点和区间，详情自动收起", y25.hidden && /2025年/.test(y25.sub) && y25.nodes > 0 && y25.bands >= 2, JSON.stringify(y25));
  await top("#hp-tl", 50); await shot("m5-year-2025", "#hp-tl");
  await page.click("[data-year='2026']");

  // ================= 3 病程与就医记录 =================
  const collapsed = await page.evaluate(() => [...document.querySelectorAll("details.hp-cat, details.hp-epi, details.hp-grp")].every((d) => !d.open));
  check("病程类别、具体病程、后续措施两组都默认折叠", collapsed);
  await page.evaluate(() => { const e = document.getElementById("ep-EP-E"); e.closest("details.hp-cat").open = true; e.open = true; });
  await top("#ep-EP-E", 70);
  const epi = await page.evaluate(() => { const e = document.getElementById("ep-EP-E"); return { h4: [...e.querySelectorAll("h4")].map((h) => h.textContent), visits: [...e.querySelectorAll(".hp-visit")].map((v) => ({ rows: [...v.querySelectorAll(".vrow .k")].map((k) => k.textContent), att: v.querySelectorAll("a.hp-att").length, head: v.querySelector(".vh").textContent })), txt: e.textContent }; });
  check("病程展开只有：发展经过 / 病程总结 / 就医记录", epi.h4.join() === "发展经过,病程总结,就医记录", epi.h4.join());
  check("就医记录显示日期、医院·科室、处方、报告附件；没有“家长确认用了”或替代行", epi.visits.length === 3 && epi.visits.every((v) => v.rows.includes("处方") && v.rows.includes("报告") && /月\d+日/.test(v.head)) && epi.visits.some((v) => v.att > 0) && !/家长确认用了|实际用药|实际使用/.test(epi.txt), JSON.stringify(epi.visits.map((v) => v.rows.join("/") + ":" + v.att)));
  check("病程总结：医学解释缺材料时写“待补”，不编造", /待补/.test(epi.txt));
  await shot("m6-episode");
  const rep = page.locator("#ep-EP-E a.hp-att").first();
  const rs = await page.evaluate(async (u) => (await fetch(u)).status, await rep.getAttribute("href"));
  check("就医记录里的报告附件可打开", rs === 200);
  // ================= 4 后续措施 =================
  await top("#hp-s3", 60);
  await page.click("#g-care > summary"); await page.click("#g-visit > summary"); await page.waitForTimeout(200);
  const fu = await page.evaluate(() => ({ care: document.querySelectorAll("#g-care .hp-it").length, visit: document.querySelectorAll("#g-visit .hp-it").length, cond: document.querySelector("#g-visit .hp-it")?.classList.contains("urgent"), xp: getComputedStyle(document.querySelector("#g-care .hp-xp em"), "::after").content, groups: document.querySelectorAll("details.hp-grp").length, noBasis: !/查看依据|依据按钮/.test(document.querySelector("#hp-s3").textContent) }));
  check("后续措施只有观察与护理、就医安排两组；点标题展开；条件性就医放首位；无依据入口", fu.groups === 2 && fu.care > 0 && fu.visit > 0 && fu.cond && /收起/.test(fu.xp) && fu.noBasis, JSON.stringify(fu));
  await shot("m7-follow-up");

  // ================= 6 桌面（在新增合成记录之前截图，保持画面是核查后的状态） =================
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: BASE });
  const dp = await dctx.newPage();
  const derr = []; dp.on("pageerror", (e) => derr.push(String(e)));
  await dp.goto("/health/record");
  await dp.click('[data-who="mom"]'); await dp.fill("#hr-pw", MOM); await dp.click('button[type="submit"]'); await dp.waitForSelector("nav.tabs", { state: "visible" });
  await dp.goto("/health"); await dp.waitForSelector("#hp-tl"); await dp.waitForTimeout(400);
  const dd = await dp.evaluate(() => { const s = document.querySelector(".hp-scroll"); const l = document.querySelector(".hp-legend").getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(document.querySelector(".hp-tl-title h2")); const t = rg.getBoundingClientRect(); return { fit: s.scrollWidth <= s.clientWidth + 1, ov: document.documentElement.scrollWidth - document.documentElement.clientWidth, legendRight: l.left > t.right, nav: [...document.querySelectorAll(".desktop-nav a")].map((a) => a.textContent) }; });
  check("桌面：全年一屏无需横滑，图例在右上，无整页溢出；顶部菜单四项", dd.fit && dd.ov <= 0 && dd.legendRight && dd.nav.join() === "首页,记忆,健康,妈妈月报", JSON.stringify(dd));
  await dp.locator("#hp-tl").screenshot({ path: path.join(SHOTS, "d1-timeline-2026.png") });
  await dp.click("[data-year='2025']"); await dp.waitForTimeout(300);
  await dp.locator("#hp-tl").screenshot({ path: path.join(SHOTS, "d2-timeline-2025.png") });
  await dp.click("[data-year='2026']");
  await dp.evaluate(() => { document.querySelector("#cat-resp").open = true; document.getElementById("ep-EP-E").open = true; });
  await dp.screenshot({ path: path.join(SHOTS, "d3-health-desktop.png"), fullPage: true });
  await dp.goto("/"); await dp.waitForTimeout(1200);
  const hr = await dp.evaluate(() => ({ health: document.querySelectorAll(".weekly-list--health .weekly-item").length, login: document.querySelectorAll(".weekly-health-login").length, weekly: !!document.querySelector("#weekly-heading") }));
  check("登录后首页：不再显示登录入口；只有明确的将来预约才出现健康提醒（当前资料没有）", hr.login === 0 && hr.health === 0, JSON.stringify(hr));
  await dp.screenshot({ path: path.join(SHOTS, "d4-home-logged-in.png") });
  check("桌面：没有脚本错误", !derr.length, derr.slice(0, 3).join(" | "));
  await dctx.close();

  // ================= 5 新增 / 更正后刷新；重放不重复 =================
  const api = (method, p, body) => page.evaluate(async ([m, u, b]) => { const r = await fetch(`/api/health-record/${u}`, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; }, [method, p, body]);
  const entryId = `e2e${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const body = { type: "note", entryId, text: "（验证用合成记录）今天咳了几声", when: { mode: "date", date: "2026-09-20", precision: "day" }, symptoms: {} };
  const made = await api("POST", "entries", body);
  const again = await api("POST", "entries", body);
  await page.reload(); await page.waitForSelector("#hp-tl");
  const after = await page.evaluate(() => ({ stale: document.querySelector("#hp-s3 .hp-warn")?.textContent ?? "", asof: document.querySelector(".hp-sub").textContent }));
  check("新增记录后：时间轴资料截止日前移，后续措施标出“之后有新记录，还没有重新审核”", made.s === 200 && /9月20日/.test(after.asof) && /还没有重新审核/.test(after.stale), after.asof);
  check("原样重放同一条：不重复（duplicate）", again.s === 200 && again.j.duplicate === true);
  const id = made.j.record.id;
  await api("POST", `entries/${id}/corrections`, { requestId: `rq${randomUUID().replace(/-/g, "").slice(0, 20)}`, expectedRevision: 1, edit: { text: "（验证用合成记录）今天没有咳", symptoms: {} } });
  await page.reload(); await page.waitForSelector("#hp-tl");
  const nd = page.locator(".hp-nd").last(); await nd.scrollIntoViewIfNeeded(); await nd.click();
  const t2 = await page.locator(".hp-detail").innerText();
  check("更正后：时间轴显示更正后的有效内容", /今天没有咳/.test(t2) && !/今天咳了几声/.test(t2));
  const cnt = (t2.match(/验证用合成记录/g) ?? []).length;
  check("时间轴上这条只出现一次", cnt === 1, `${cnt}`);
  await page.locator("#hp-tl").screenshot({ path: path.join(SHOTS, "m8-after-new-record.png") });
  const pend = await page.evaluate(() => [...document.querySelectorAll('.hp-bp[data-status="needs_review"]')].map((b) => b.dataset.band));
  check("新记录落在已核查区间附近：该区间改为“待重新核对”（虚线框，不画红）", pend.includes("IV-2026-09b"), pend.join());
  check("手机：没有脚本错误", !errors.length, errors.slice(0, 3).join(" | "));
  await ctx.close();
} finally {
  await browser.close(); stop();
  const after = Object.fromEntries(Object.keys(before).map((f) => [f, sha(f)]));
  check("结束时：只读输入（历史账本原件与副本、核查文件、材料、医院原件）哈希全部不变", Object.keys(before).every((f) => before[f] === after[f]), `${Object.keys(before).length} 个文件`);
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} passed`);
  writeFileSync(path.join(OUT, "e2e-results.json"), JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 1));
  if (/Error|error/.test(log)) writeFileSync(path.join(OUT, "server.log"), log.slice(-20000));
  process.exit(pass === results.length ? 0 : 1);
}
