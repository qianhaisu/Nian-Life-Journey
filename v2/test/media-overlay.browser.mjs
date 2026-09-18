// Run manually: node test/media-overlay.browser.mjs
// Exercise the real components and stylesheet inside a transformed, scrolled ancestor.
// Synthetic media only; no database, family photos or production writes.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const output = await fs.mkdtemp(path.join(os.tmpdir(), "nian-media-overlay-"));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000"><rect width="600" height="1000" fill="#9eab92"/><rect x="8" y="8" width="584" height="984" fill="none" stroke="white" stroke-width="16"/></svg>';
const photo = `data:image/svg+xml,${encodeURIComponent(svg)}`;
await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {PhotoGallery} from './components/photo-viewer';
    const p=${JSON.stringify(photo)};
    createRoot(document.getElementById('root')).render(<PhotoGallery dateLabel="2025 / 12 / 16" photos={[
      {id:'p1',src:p,thumbnailSrc:p,alt:'Portrait',width:600,height:1000},
      {id:'p2',src:p,thumbnailSrc:p,alt:'Landscape',width:1000,height:600},
      {id:'clip',src:p,alt:'Clip',type:'video',width:600,height:1000}
    ]}/>);`, loader: "tsx", resolveDir: root },
  bundle: true, jsx: "automatic", outfile: path.join(output, "app.js"),
  define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' },
});
const css = await fs.readFile(path.join(root, "app/globals.css"), "utf8");
const js = await fs.readFile(path.join(output, "app.js"));
const server = http.createServer((req, res) => {
  if (req.url === "/app.js") { res.setHeader("Content-Type", "text/javascript"); res.end(js); }
  else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
  else if (req.url?.startsWith("/api/media")) { res.setHeader("Content-Type", "image/svg+xml"); res.end(svg); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="/style.css"><div style="height:1000px"></div><section style="transform:translateY(0);overflow:hidden;max-width:700px;margin:auto"><div id="root"></div></section><div style="height:1000px"></div><script src="/app.js"></script>'); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
const results = [];
try {
  for (const viewport of [{ width: 390, height: 664 }, { width: 1280, height: 800 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", e => { errors.push(e.message); console.error(e.message); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const trigger = page.locator('figure[role="button"]').first();
    await trigger.scrollIntoViewIfNeeded();
    await trigger.focus();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await trigger.click();
    const modal = page.getByRole("dialog");
    await modal.waitFor();
    const metrics = await modal.evaluate(el => {
      const r = el.getBoundingClientRect();
      const close = el.querySelector('.viewer-close').getBoundingClientRect();
      const image = el.querySelector('.viewer-image').getBoundingClientRect();
      const reel = el.querySelector('.viewer-reel').getBoundingClientRect();
      return { top:r.top,left:r.left,width:r.width,height:r.height,parent:el.parentElement.tagName,
        closeVisible:close.top>=0 && close.bottom<=innerHeight,
        imageFits:image.top>=reel.top && image.bottom<=reel.bottom,
        fit:getComputedStyle(el.querySelector('.viewer-image')).objectFit };
    });
    assert.equal(metrics.parent, "BODY");
    assert.equal(metrics.top, 0); assert.equal(metrics.left, 0);
    assert.equal(metrics.width, viewport.width); assert.equal(metrics.height, viewport.height);
    assert.equal(metrics.closeVisible, true); assert.equal(metrics.imageFits, true); assert.equal(metrics.fit, "contain");
    await page.screenshot({ path: path.join(output, `viewer-${viewport.width}.png`) });
    await page.getByRole("button", { name: "下一张", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.viewer-nav span')?.textContent === '2 / 2');
    await page.locator('.viewer-slide').nth(1).dblclick();
    assert.equal(await page.locator('.viewer-image-zoomed').count(), 1);
    const closeBox = await page.getByRole('button', {name:'关闭',exact:true}).boundingBox();
    assert.ok(closeBox.y >= 0 && closeBox.y + closeBox.height <= viewport.height);
    await page.keyboard.press("Escape");
    await modal.waitFor({ state: "detached" });
    assert.ok(Math.abs(await page.evaluate(() => scrollY) - scrollBefore) < 2);
    await trigger.click();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await modal.waitFor({ state: "detached" });
    await trigger.click();
    await page.goBack();
    await modal.waitFor({ state: "detached" });

    // A local generated clip exercises real playback without downloading a personal video.
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width=160; canvas.height=120;
      const ctx=canvas.getContext('2d'); const stream=canvas.captureStream(10);
      const chunks=[]; const recorder=new MediaRecorder(stream);
      recorder.ondataavailable=e=>chunks.push(e.data);
      const done=new Promise(resolve=>recorder.onstop=resolve);
      recorder.start();
      const timer=setInterval(()=>{ctx.fillStyle='green';ctx.fillRect(0,0,160,120);},50);
      await new Promise(resolve=>setTimeout(resolve,600)); recorder.stop(); await done; clearInterval(timer);
      stream.getTracks().forEach(t=>t.stop());
      const v=document.querySelector('video'); v.src=URL.createObjectURL(new Blob(chunks,{type:recorder.mimeType}));
      v.loop=true; v.load();
      await new Promise(resolve=>v.addEventListener('canplay',resolve,{once:true}));
    });
    assert.equal(await page.locator('video').evaluate(v => v.controls), false);
    assert.equal(await page.locator('.video-play').count(), 1);
    await page.locator('.video-frame').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `video-before-${viewport.width}.png`) });
    await page.locator('.video-play').click();
    await page.waitForFunction(() => !document.querySelector('video').paused && document.querySelector('video').controls);
    assert.equal(await page.locator('.video-play').count(), 0);
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.evaluate(() => document.exitFullscreen());
    await page.locator('video').evaluate(v => v.pause());
    assert.equal(await page.locator('video').evaluate(v => v.controls), true);
    assert.equal(await page.locator('.video-play').count(), 0);
    assert.deepEqual(errors, []);
    results.push({ viewport, metrics, closeEscapeBack:true, navigation:true, singlePlayButton:true, realPlaybackFullscreen:true });
    await page.close();
  }
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ pass: true, output, results }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
