// The order 「这个月的照片」 is left in once a reader opens it (components/archive-expander.tsx).
//
// The first screen shows a SELECTION of the month's photographed days — the recent ones and the
// ones that already carry words (lib/publication-moments.ts) — not the first few. So rendering the
// rest after it made the album run 9 月 12 日, 15 日, 18 日, 21 日 and then double back to 9 月 2 日.
// Measured on a fixture of eight photographed days before this fix, and the same shape the running
// site's 2026-09 has.
import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
globalThis.React ??= React;
const { orderedArchiveDays } = await import("../components/archive-expander.tsx");

const day = (d, photos = 1) => ({
  day: `2026-09-${String(d).padStart(2, "0")}`,
  dateLabel: `2026 年 9 月 ${d} 日`,
  ageLabel: "1 岁 8 个月",
  photos: Array.from({ length: photos }, (_, n) => ({ id: `${d}-${n}`, src: `/api/media/${d}-${n}`, alt: "", width: 1600, height: 1200 })),
});
const days = (list) => list.map((d) => d.day.slice(-2)).map(Number);

test("the month reads in the order it happened, not selection first and leftovers after", () => {
  const visible = [day(12), day(15), day(18), day(21)];
  const hidden = [day(2), day(4), day(6), day(9)];
  assert.deepEqual(days(orderedArchiveDays(visible, hidden)), [2, 4, 6, 9, 12, 15, 18, 21]);
});

test("the order does not depend on the order either side arrives in", () => {
  const visible = [day(21), day(12)];
  const hidden = [day(9), day(2), day(15)];
  assert.deepEqual(days(orderedArchiveDays(visible, hidden)), [2, 9, 12, 15, 21]);
});

test("nothing folded means the visible days stand as they are", () => {
  assert.deepEqual(days(orderedArchiveDays([day(2), day(9)], [])), [2, 9]);
});

test("a day that arrives from both sides appears once, and keeps what the page already rendered", () => {
  const rendered = day(12, 5);
  const fetchedAgain = { ...day(12, 1), dateLabel: "从服务端再取一次" };
  const merged = orderedArchiveDays([rendered], [fetchedAgain, day(4)]);
  assert.deepEqual(days(merged), [4, 12]);
  const twelfth = merged.find((d) => d.day === "2026-09-12");
  assert.equal(twelfth.photos.length, 5, "the copy already on screen wins, so nothing the reader can see is swapped out");
  assert.equal(twelfth.dateLabel, "2026 年 9 月 12 日");
});
