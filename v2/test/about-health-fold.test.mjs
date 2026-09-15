// PAGE-0915-FULL-REMEDIATION-R1 已批准的产品决策 1、验收 C1：健康记录降为次级、默认收起的折叠区，
// 不再跟「量过的身高体重」同级摆出来。
//
// app/about/page.tsx 是读数据库的异步 server component，这个仓库里没有先例直接渲染它做测试
// （about-growth.test.mjs / about-now.test.mjs 测的都是 lib/about-view.ts 的纯函数）；这里跟
// title-emphasis.test.mjs 里核对 app/home.css 规则同一个做法，直接核对源码里的标签结构和对应样式。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pageSrc = fs.readFileSync(new URL("../app/about/page.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("健康记录是 <details className=\"about-block about-health-fold\">，标题是 <summary>，不是普通 <section>/<h2>", () => {
  const block = pageSrc.match(/\{health\.length > 0 \? <details className="about-block about-health-fold">[\s\S]*?<\/details> : null\}/);
  assert.ok(block, "找不到 health 的 <details> 折叠块");
  assert.match(block[0], /<summary className="section-mark">健康记录<\/summary>/);
  assert.doesNotMatch(block[0], /<h2[^>]*>健康记录/, "标题不该再是 <h2>，那是没有折叠语义的写法");
});

test("量过的身高体重 / 学会了什么 / 解锁的体验 仍然是普通 <section>，只有健康记录被降级折叠", () => {
  assert.match(pageSrc, /\{measures\.length > 0 \? <section className="about-block" aria-labelledby="measures-title">/);
  assert.match(pageSrc, /\{learned\.length > 0 \? <section className="about-block" aria-labelledby="learned-title">/);
  assert.match(pageSrc, /\{unlocked\.length > 0 \? <section className="about-block" aria-labelledby="unlocked-title">/);
});

test("globals.css 里 .about-health-fold 有可点击的折叠样式（原生 marker 关掉、换成可读的查看/收起）", () => {
  assert.match(css, /\.about-health-fold > summary \{[^}]*cursor: pointer/);
  assert.match(css, /\.about-health-fold > summary::-webkit-details-marker \{ display: none; \}/);
  assert.match(css, /content: "查看 ＋"/);
  assert.match(css, /\.about-health-fold\[open\] > summary::after \{ content: "收起 －"; \}/);
});
