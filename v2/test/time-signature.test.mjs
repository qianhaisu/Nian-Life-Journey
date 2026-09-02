import test from "node:test";
import assert from "node:assert/strict";
import { ageBetween, formatAge, formatDay, formatMonth, ageAtMonth, ageSpan, timeSignatureFor, currentAge } from "../lib/time-signature.ts";

const BIRTH = "2025-01-03";

test("formatDay and formatMonth print family-facing Chinese dates", () => {
  assert.equal(formatDay("2026-08-14"), "2026 年 8 月 14 日");
  assert.equal(formatMonth("2026-08"), "2026 年 8 月");
  assert.equal(formatDay("garbage"), "garbage");
});

test("ageBetween borrows a month until the birthday-of-month is reached", () => {
  assert.deepEqual(ageBetween(BIRTH, "2026-08-02"), { years: 1, months: 6, days: 30 });
  assert.deepEqual(ageBetween(BIRTH, "2026-08-03"), { years: 1, months: 7, days: 0 });
  assert.deepEqual(ageBetween(BIRTH, "2026-08-14"), { years: 1, months: 7, days: 11 });
  assert.equal(ageBetween(BIRTH, "2024-12-31"), undefined);
});

test("formatAge reads like a parent counts", () => {
  assert.equal(formatAge(ageBetween(BIRTH, "2025-01-03")), "出生的那天");
  assert.equal(formatAge(ageBetween(BIRTH, "2025-01-20")), "17 天");
  assert.equal(formatAge(ageBetween(BIRTH, "2025-08-11")), "7 个月");
  assert.equal(formatAge(ageBetween(BIRTH, "2026-01-03")), "1 岁");
  assert.equal(formatAge(ageBetween(BIRTH, "2026-08-14")), "1 岁 7 个月");
});

test("timeSignatureFor handles the three stored date shapes without leaking raw strings", () => {
  const tz = timeSignatureFor("2025-08-11 00:00:00+00", BIRTH);
  assert.equal(tz.day, "2025-08-11");
  assert.equal(tz.dateLabel, "2025 年 8 月 11 日");
  assert.equal(tz.ageLabel, "7 个月");
  assert.equal(timeSignatureFor("2026-08-28 00:00:00", BIRTH).dateLabel, "2026 年 8 月 28 日");
  // 01:25 UTC on the 31st is still the 31st in Shanghai.
  assert.equal(timeSignatureFor("2026-08-31 01:25:00+00", BIRTH).day, "2026-08-31");
  // 18:00 UTC is the next day in Shanghai.
  assert.equal(timeSignatureFor("2026-08-31T18:00:00Z", BIRTH).day, "2026-09-01");
  assert.equal(timeSignatureFor(undefined, BIRTH), undefined);
  assert.equal(timeSignatureFor("2026-08-14").ageLabel, undefined);
});

test("month and year anchors", () => {
  assert.equal(ageAtMonth(BIRTH, "2026-08"), "1 岁 6 个月");
  assert.equal(ageSpan(BIRTH, ["2026-08", "2026-01", "2026-11"]), "11 个月 到 1 岁 9 个月");
  assert.equal(ageSpan(BIRTH, ["2026-08"]), "1 岁 6 个月");
  assert.equal(ageSpan(undefined, ["2026-08"]), undefined);
});

test("currentAge uses today's calendar day in the profile timezone", () => {
  assert.equal(currentAge(BIRTH, new Date("2026-09-02T00:00:00Z")), "1 岁 7 个月");
  assert.equal(currentAge(undefined), undefined);
});
