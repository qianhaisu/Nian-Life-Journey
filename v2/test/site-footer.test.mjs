// nianlife.cn 公网上线前必须在每个页面底部展示 ICP 备案号，并链接到工信部备案查询。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
globalThis.React ??= React;
const { SiteFooter } = await import("../components/site-footer.tsx");

test("the footer shows the ICP record number linked to the MIIT filing lookup", () => {
  const html = renderToStaticMarkup(React.createElement(SiteFooter));
  assert.match(html, /<footer class="site-footer">/);
  assert.match(html, /href="https:\/\/beian\.miit\.gov\.cn\/"/);
  assert.match(html, />浙ICP备2026024416号-2<\/a>/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("the footer carries no police filing number that has not been issued", () => {
  const html = renderToStaticMarkup(React.createElement(SiteFooter));
  assert.doesNotMatch(html, /公网安备/);
});

test("the root layout renders the footer on every page", () => {
  const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /<\/main><SiteFooter \/>/);
});
