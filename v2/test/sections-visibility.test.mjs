import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React ??= React;

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { SECTIONS, hasMemoryReadingModeSwitch } = await import("../lib/features.ts");
const { ON_DEMAND_ARCHIVE_PATHS } = await import("../lib/render-on-demand.ts");
const { SiteHeader } = await import("../components/site-header.tsx");
const { MemoryReadingMode } = await import("../components/memory-reading-mode.tsx");
const { HomeHealthReminders } = await import("../components/home-health-reminders.tsx");
const { YearBookReading } = await import("../components/year-book.tsx");
const healthRecordRoute = await import("../app/api/health-record/[...path]/route.ts");

test("SECTIONS constants default growth, people, and health to false", () => {
  assert.deepEqual(SECTIONS, {
    growth: false,
    people: false,
    health: false,
  });
});

test("SiteHeader hides 健康 in both desktop and mobile nav when SECTIONS.health is false", () => {
  const html = renderToStaticMarkup(React.createElement(SiteHeader));
  assert.doesNotMatch(html, /href="\/health"/);
  assert.doesNotMatch(html, />健康</);
  for (const label of ["首页", "记忆", "旅行", "妈妈月报"]) {
    const count = (html.match(new RegExp(`>${label}<`, "g")) ?? []).length;
    assert.equal(count, 2, `${label} must appear in both desktop and mobile primary nav`);
  }
});

test("MemoryReadingMode renders nothing when only 按时间 remains enabled", () => {
  assert.equal(hasMemoryReadingModeSwitch, false);
  const html = renderToStaticMarkup(React.createElement(MemoryReadingMode));
  assert.equal(html, "");
});

test("HomeHealthReminders and YearBookReading emit no hidden section links", () => {
  assert.equal(renderToStaticMarkup(React.createElement(HomeHealthReminders, { standalone: true })), "");
  const sampleEntry = {
    day: "2026-09-10",
    month: "2026-09",
    year: "2026",
    dateLabel: "2026 年 9 月 10 日",
    ageLabel: "1 岁 8 个月",
    href: "/memory/2026/09/10",
    title: "自己吃饭",
    paragraphs: ["今天自己拿勺子把饭吃完了。"],
    photos: [],
  };
  const book = {
    year: "2026",
    ongoing: true,
    ageLabel: "1 岁",
    intro: "这一年的记录。",
    changes: [
      {
        id: "eating",
        category: "action",
        title: "自己吃饭",
        matches: [
          { entry: sampleEntry, excerpt: "今天自己拿勺子把饭吃完了。" },
          { entry: { ...sampleEntry, day: "2026-10-10", href: "/memory/2026/10/10" }, excerpt: "吃饭越来越稳。" },
        ],
        anchors: [],
      },
    ],
    chapters: [],
  };
  const bookHtml = renderToStaticMarkup(React.createElement(YearBookReading, { book }));
  assert.doesNotMatch(bookHtml, /\/memory\/growth/);
});

test("/api/health-record/* returns 404 JSON across HTTP methods when SECTIONS.health is false", async () => {
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    const handler = healthRecordRoute[method];
    assert.equal(typeof handler, "function", `${method} handler should be exported`);
    const res = await handler(
      new Request("http://localhost/api/health-record/entries", { method }),
      { params: Promise.resolve({ path: ["entries"] }) },
    );
    assert.equal(res.status, 404, `${method} must return 404 when health section is disabled`);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, "disabled");
  }
});

test("hidden route pages enforce SECTIONS redirect and noindex while /api/health probe stays intact", () => {
  const routeChecks = [
    { file: "app/memory/growth/page.tsx", flag: "SECTIONS.growth", target: '"/memory"' },
    { file: "app/memory/people/page.tsx", flag: "SECTIONS.people", target: '"/memory"' },
    { file: "app/memory/people/[person]/page.tsx", flag: "SECTIONS.people", target: '"/memory"' },
    { file: "app/health/page.tsx", flag: "SECTIONS.health", target: '"/"' },
    { file: "app/health/record/page.tsx", flag: "SECTIONS.health", target: '"/"' },
  ];
  for (const item of routeChecks) {
    const src = readFileSync(path.join(rootDir, item.file), "utf8");
    assert.ok(src.includes(`!${item.flag}`), `${item.file} must check !${item.flag}`);
    assert.ok(src.includes(`redirect(${item.target})`), `${item.file} must redirect to ${item.target}`);
    assert.match(src, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/, `${item.file} must export noindex robots`);
  }

  const probeSrc = readFileSync(path.join(rootDir, "app/api/health/route.ts"), "utf8");
  assert.ok(!probeSrc.includes("SECTIONS"), "/api/health liveness probe must not be gated by SECTIONS");

  assert.ok(!ON_DEMAND_ARCHIVE_PATHS.includes("/memory/growth"));
  assert.ok(!ON_DEMAND_ARCHIVE_PATHS.includes("/memory/people"));

  const homeSrc = readFileSync(path.join(rootDir, "app/page.tsx"), "utf8");
  assert.doesNotMatch(homeSrc, /HomeReminders|HomeHealthReminders|UpcomingTasks/);
});
