import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React ??= React;
Module.createRequire(import.meta.url).extensions[".css"] = () => {};

const { buildMonthCalendarGrid, MonthCalendar } = await import("../components/month-calendar.tsx");
const { MonthTimeline } = await import("../components/month-timeline.tsx");
const { pickMonthTextStickerTheme } = await import("../components/month-text-sticker.tsx");

test("buildMonthCalendarGrid: 2026-11 按周一到周日对齐，30 天共 6 行 42 格", () => {
  const cells = buildMonthCalendarGrid("2026", "11", [
    { day: "2026-11-10", title: "晒太阳", hasPhotos: true, isMilestone: true },
    { day: "2026-11-11", title: "抱来小汽车书", hasPhotos: false },
  ]);

  assert.equal(cells.length, 42);
  // 2026-11-01 is Sunday => 6 leading nulls (Mon..Sat)
  for (let i = 0; i < 6; i += 1) assert.equal(cells[i], null);

  const nov1 = cells[6];
  assert.ok(nov1);
  assert.equal(nov1.day, "2026-11-01");
  assert.equal(nov1.dateNumber, 1);
  assert.equal(nov1.isWeekend, true);
  assert.equal(nov1.entry, undefined);

  const nov10 = cells[6 + 9];
  assert.ok(nov10?.entry);
  assert.equal(nov10.day, "2026-11-10");
  assert.equal(nov10.entry.isMilestone, true);

  // Trailing slots after 2026-11-30 (Monday) => 6 trailing nulls
  assert.equal(cells[6 + 29]?.day, "2026-11-30");
  for (let i = 36; i < cells.length; i += 1) assert.equal(cells[i], null);
});

test("buildMonthCalendarGrid: 2025-02 平年 28 天", () => {
  const cells = buildMonthCalendarGrid("2025", "02", []);
  const nonNull = cells.filter(Boolean);
  assert.equal(nonNull.length, 28);
  assert.equal(nonNull[0].day, "2025-02-01");
  assert.equal(nonNull[27].day, "2025-02-28");
});

test("MonthCalendar 与 MonthTimeline: 渲染月历卡片并去掉周跳转胶囊和周标题", () => {
  const calHtml = renderToStaticMarkup(
    React.createElement(MonthCalendar, {
      year: "2026",
      month: "11",
      days: [
        { day: "2026-11-10", title: "晒太阳", hasPhotos: true, isMilestone: true },
        { day: "2026-11-11", title: "看绘本", hasPhotos: false },
      ],
      activeDay: "2026-11-11",
      onSelectDay: () => {},
    }),
  );
  assert.match(calHtml, /11 月手账日历/);
  assert.match(calHtml, /href="#day-2026-11-10"/);
  assert.match(calHtml, /href="#day-2026-11-11"/);
  assert.match(calHtml, /aria-current="date"/);

  const timelineHtml = renderToStaticMarkup(
    React.createElement(MonthTimeline, {
      year: "2026",
      month: "11",
      weeks: [
        { id: "week-1", label: "第 1 周", days: ["2026-11-11"] },
        { id: "week-2", label: "第 2 周", days: ["2026-11-02"] },
      ],
      entries: [
        [
          {
            day: "2026-11-11",
            dateLabel: "11 月 11 日",
            title: "看绘本",
            paragraphs: ["抱来蓝色小汽车书。"],
            stories: [],
            eventIds: [],
            photos: [],
            href: "/memory/2026/11/11",
            lead: false,
            milestone: null,
          },
        ],
        [
          {
            day: "2026-11-02",
            dateLabel: "11 月 2 日",
            title: "出门散步",
            paragraphs: ["在小区里走了一圈。"],
            stories: [],
            eventIds: [],
            photos: [],
            href: "/memory/2026/11/02",
            lead: false,
            milestone: null,
          },
        ],
      ],
    }),
  );

  assert.match(timelineHtml, /class="month-timeline-shell has-calendar"/);
  assert.match(timelineHtml, /class="month-calendar-rail"/);
  assert.match(timelineHtml, /class="month-calendar"/);
  assert.match(timelineHtml, /class="month-text-sticker month-text-sticker--reading"/);
  assert.match(timelineHtml, /class="month-text-sticker month-text-sticker--walk"/);
  assert.match(timelineHtml, /id="day-2026-11-11"/);
  assert.match(timelineHtml, /id="day-2026-11-02"/);
  assert.doesNotMatch(timelineHtml, /class="month-jump"/);
  assert.doesNotMatch(timelineHtml, /class="week-mark"/);
  assert.doesNotMatch(timelineHtml, /第 1 周/);
  assert.doesNotMatch(timelineHtml, /值得再读/);
  assert.doesNotMatch(timelineHtml, /month-highlights/);
});

test("pickMonthTextStickerTheme: 按标题与摘要语义匹配手账贴纸主题并兜底", () => {
  assert.equal(pickMonthTextStickerTheme("抱来小汽车书", ""), "reading");
  assert.equal(pickMonthTextStickerTheme("公园滑梯晒太阳", ""), "outdoor");
  assert.equal(pickMonthTextStickerTheme("午睡小床", ""), "sleep");
  assert.equal(pickMonthTextStickerTheme("普通的一天", "记录一些日常小事"), "journal");
});
