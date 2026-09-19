// Local synthetic fixtures only: no app server, credentials or family data.
// Run from v2: node --test test/shadcn.browser.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

test("shadcn styles, portals and keyboard behaviour coexist with legacy pages", async () => {
  const cssPath = resolve("app/shadcn.css");
  const { css } = await postcss([tailwind()]).process(await readFile(cssPath, "utf8"), { from: cssPath });
  const legacy = await readFile("app/globals.css", "utf8") + await readFile("app/mom-reports.css", "utf8");
  const bundle = await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { Button } from '@/components/ui/button';
      import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
      import { Input } from '@/components/ui/input';
      import { Label } from '@/components/ui/label';
      import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
      import { cn } from '@/lib/utils';
      window.mergedClasses = cn('ui:px-3 ui:hover:bg-primary', false, 'ui:px-6 ui:hover:bg-secondary');
      createRoot(document.getElementById('root')).render(<Card>
        <CardHeader><CardTitle>组件验证</CardTitle></CardHeader>
        <CardContent>
          <Button id="primary">保存</Button>
          <Button disabled>不可用</Button>
          <Button asChild variant="link"><a href="#example">查看</a></Button>
          <Label htmlFor="name">称呼</Label><Input id="name" />
          <Dialog><DialogTrigger asChild><Button variant="outline">打开对话框</Button></DialogTrigger>
            <DialogContent><DialogTitle>编辑称呼</DialogTitle><DialogDescription>仅用于本地验证。</DialogDescription>
              <Label htmlFor="dialog-name">新称呼</Label><Input id="dialog-name" /><Button>确认</Button>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>);
    `, resolveDir: process.cwd(), sourcefile: "shadcn-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.setContent(`<!doctype html><html lang="zh-CN"><body><div class="mr-page"><div class="mr-card"><div class="mr-aspect"><h3>月报样例</h3><p class="mr-aspect-detail">说明文字</p></div><ul class="mr-sleep-labels"><li>标签</li></ul><button>原有按钮</button></div></div><div id="root"></div></body></html>`);
      await page.addStyleTag({ content: legacy });
      await page.waitForFunction(() => getComputedStyle(document.querySelector(".mr-page")).backgroundColor === "rgb(245, 243, 236)");
      const legacySignature = () => page.locator(".mr-page, .mr-page *").evaluateAll(elements => elements.map(e => {
        const s = getComputedStyle(e), r = e.getBoundingClientRect();
        return [r.x,r.y,r.width,r.height,s.color,s.backgroundColor,s.fontFamily,s.fontSize,s.fontWeight,s.border,s.borderRadius,s.padding,s.margin];
      }));
      const before = await legacySignature();
      await page.addStyleTag({ content: css });
      assert.deepEqual(await legacySignature(), before, "new stylesheet must not change month report styles/layout");
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const primary = page.locator("#primary");
      await primary.waitFor();
      assert.equal(await page.evaluate(() => window.mergedClasses), "ui:px-6 ui:hover:bg-secondary");
      const appearance = await primary.evaluate(e => {
        const s = getComputedStyle(e); return { bg:s.backgroundColor,color:s.color,height:e.getBoundingClientRect().height,radius:s.borderRadius };
      });
      assert.equal(appearance.bg, "rgb(168, 93, 67)");
      assert.equal(appearance.color, "rgb(255, 255, 255)");
      assert.equal(appearance.radius, "12px");
      assert.ok(appearance.height >= 44);
      assert.equal(await page.getByRole("button", { name: "不可用" }).isDisabled(), true);
      assert.equal(await page.getByRole("link", { name: "查看" }).getAttribute("href"), "#example");
      await page.getByText("称呼", { exact: true }).click();
      assert.equal(await page.locator("#name").evaluate(e => e === document.activeElement), true);
      assert.equal(await page.locator("#name").evaluate(e => getComputedStyle(e).fontSize), "16px");
      await primary.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      assert.notEqual(await primary.evaluate(e => getComputedStyle(e).boxShadow), "none", "keyboard focus is visible");
      await page.getByRole("button", { name: "打开对话框" }).click();
      const dialog = page.getByRole("dialog", { name: "编辑称呼" });
      await dialog.waitFor();
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, "portal fits viewport");
      assert.equal(await dialog.evaluate(e => getComputedStyle(e).backgroundColor), "rgb(249, 246, 240)");
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Tab");
        assert.equal(await dialog.evaluate(e => e.contains(document.activeElement)), true, "focus stays in dialog");
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.equal(await page.getByRole("button", { name: "打开对话框" }).evaluate(e => e === document.activeElement), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
