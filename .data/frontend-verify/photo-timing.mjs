// 手机宽度下打开月页，量「第一个照片网格里的图全部显示出来」要多久（毫秒），以及这些图的总字节。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(path.resolve(here, "../../v2/package.json"))("playwright");
const browser = await chromium.launch();
const out = [];
for (const url of ["/memory/2026/09", "/memory/2025/12"]) {
  for (let run = 0; run < 2; run++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
    const page = await ctx.newPage();
    let bytes = 0;
    page.on("response", async (r) => { if (r.request().resourceType() === "image") { const l = Number(r.headers()["content-length"] ?? 0); bytes += l; } });
    const t0 = Date.now();
    await page.goto("https://nianlife.cn" + url, { waitUntil: "domcontentloaded" });
    await page.locator(".day-photos").first().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => { const imgs = [...document.querySelectorAll(".day-photos")][0]?.querySelectorAll("img") ?? []; return imgs.length > 0 && [...imgs].every((i) => i.complete && i.naturalWidth > 0); }, null, { timeout: 60000 });
    const ms = Date.now() - t0;
    const srcs = await page.$$eval(".day-photos img", (els) => els.slice(0, 3).map((e) => e.currentSrc.split("/").slice(-2).join("/")));
    out.push({ url, run, firstGridMs: ms, imageKB: Math.round(bytes / 1024), sample: srcs });
    await ctx.close();
  }
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
