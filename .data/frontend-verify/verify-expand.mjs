// 「展开」回改后的验收：健康页正常；2025-12-04 最后一格是淡色遮罩上的「展开」，点开 12 张全部显示。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(path.resolve(here, "../../v2/package.json"))("playwright");
const browser = await chromium.launch();
let ok = true;
const say = (pass, msg) => { ok &&= pass; console.log(`${pass ? "PASS" : "FAIL"} ${msg}`); };
const settle = (page) => page.waitForFunction(() => [...document.images].filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).every((i) => i.complete), null, { timeout: 30000 }).catch(() => {});
for (const [vp, opts] of [["desktop", { viewport: { width: 1280, height: 900 } }], ["mobile390", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
  const page = await (await browser.newContext(opts)).newPage();
  const res = await page.goto("https://nianlife.cn/health", { waitUntil: "load", timeout: 90000 });
  const text = await page.textContent("main");
  const sick = text.match(/年度累计生病\s*😷?\s*(\d+)\s*天/)?.[1];
  await page.screenshot({ path: path.join(here, `${vp}-health-after-456b2d7.png`) });
  say(res.status() === 200 && Number(sick) > 0 && text.includes("资料截至") && text.includes("健康时间轴"), `[${vp}] /health 200，年度累计生病 ${sick} 天，含「资料截至」「健康时间轴」`);

  await page.goto("https://nianlife.cn/memory/2025/12", { waitUntil: "load", timeout: 90000 });
  const day = page.locator("li.month-day", { has: page.locator('time[datetime="2025-12-04"]') });
  await day.locator(".day-photos").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => { const b = document.querySelector(".pg-more"); return b && Object.keys(b).some((k) => k.startsWith("__reactProps")); }, null, { timeout: 60000 });
  const cells = await day.locator(".pg-cell").count();
  const more = day.locator("button.pg-more");
  const label = (await more.textContent())?.trim();
  const inLast = await day.locator(".pg-cell").last().locator("button.pg-more").count();
  const bg = await more.evaluate((b) => getComputedStyle(b).backgroundColor);
  const digits = /\d/.test(await day.locator(".day-photos").innerText());
  await settle(page);
  await page.screenshot({ path: path.join(here, `${vp}-grid-2025-12-04-zhankai.png`) });
  say(cells === 6 && label === "展开" && inLast === 1 && !digits, `[${vp}] 12/4 默认 ${cells} 格，最后一格文字「${label}」，遮罩 ${bg}，照片区无数字：${!digits}`);
  await more.click();
  await page.waitForFunction(() => document.querySelectorAll('li.month-day time[datetime="2025-12-04"]').length && [...document.querySelectorAll("li.month-day")].find((li) => li.querySelector('time[datetime="2025-12-04"]')).querySelectorAll(".pg-cell").length === 12, null, { timeout: 10000 }).catch(() => {});
  const after = await day.locator(".pg-cell").count();
  const moreLeft = await day.locator("button.pg-more").count();
  await day.locator(".day-photos").scrollIntoViewIfNeeded();
  await settle(page);
  await page.screenshot({ path: path.join(here, `${vp}-grid-2025-12-04-zhankai-open.png`) });
  say(after === 12 && moreLeft === 0, `[${vp}] 点「展开」后 ${after} 张全部显示`);
}
await browser.close();
console.log(ok ? "ALL PASS" : "SOME FAILED");
process.exit(ok ? 0 : 1);
