import test from "node:test";
import assert from "node:assert/strict";
import { ageBetween, ageInMonth, ageOn, birthDayOf, formatAge, formatDay, formatMonth, ageAtMonth, ageSpan, timeSignatureFor, currentAge } from "../lib/time-signature.ts";
import { profile } from "../lib/mock-data.ts";
import { CANONICAL_PROFILE_ID } from "../lib/db/config.ts";

// Product truth: 张年 was born on 2025-01-03, a calendar day in the family's timezone.
const BIRTH = "2025-01-03";

test("the seed profile is 张年 with the canonical birth day", () => {
  assert.equal(profile.id, CANONICAL_PROFILE_ID);
  assert.equal(profile.birthDate, BIRTH);
  assert.equal(birthDayOf(profile), BIRTH);
});

test("birthDayOf takes the stored birth date as a calendar day, never through a timezone", () => {
  assert.equal(birthDayOf({ birthDate: "2025-01-03" }), "2025-01-03");
  // A midnight-UTC instant would be 2025-01-02 in America and 2025-01-03 in Shanghai — the day as
  // written wins, so no conversion can shift it.
  assert.equal(birthDayOf({ birthDate: "2025-01-03T00:00:00Z" }), "2025-01-03");
  assert.equal(birthDayOf({ birthDate: "" }), undefined);
  assert.equal(birthDayOf({ birthDate: "unknown" }), undefined);
  assert.equal(birthDayOf(null), undefined);
});

test("formatDay and formatMonth print family-facing Chinese dates", () => {
  assert.equal(formatDay("2026-08-14"), "2026 年 8 月 14 日");
  assert.equal(formatMonth("2026-08"), "2026 年 8 月");
  assert.equal(formatDay("garbage"), "garbage");
});

test("calendar age boundaries: years, months and days — never ms/365 or days/30", () => {
  const cases = [
    ["2025-01-03", { years: 0, months: 0, days: 0 }, "出生的那天"],
    ["2025-02-02", { years: 0, months: 0, days: 30 }, "30 天"],
    ["2025-02-03", { years: 0, months: 1, days: 0 }, "1 个月"],
    ["2026-01-02", { years: 0, months: 11, days: 30 }, "11 个月"],
    ["2026-01-03", { years: 1, months: 0, days: 0 }, "1 岁"],
    ["2026-09-02", { years: 1, months: 7, days: 30 }, "1 岁 7 个月"],
    ["2026-09-03", { years: 1, months: 8, days: 0 }, "1 岁 8 个月"],
  ];
  for (const [day, parts, label] of cases) {
    assert.deepEqual(ageBetween(BIRTH, day), parts, day);
    assert.equal(ageOn(BIRTH, day), label, day);
  }
  assert.equal(ageBetween(BIRTH, "2025-01-02"), undefined, "the day before birth has no age");
  assert.equal(ageOn(undefined, "2026-09-02"), undefined);
});

test("calendar age across month ends, February and leap years", () => {
  // Born on the 31st: February has no 31st, so the month completes on February's last day.
  assert.deepEqual(ageBetween("2025-01-31", "2025-02-27"), { years: 0, months: 0, days: 27 });
  assert.deepEqual(ageBetween("2025-01-31", "2025-02-28"), { years: 0, months: 1, days: 0 });
  assert.deepEqual(ageBetween("2025-01-31", "2025-03-01"), { years: 0, months: 1, days: 1 });
  assert.deepEqual(ageBetween("2025-01-31", "2025-03-31"), { years: 0, months: 2, days: 0 });
  // Leap day birthday: the anniversary is 28 February in a common year, 29 February when it exists.
  assert.deepEqual(ageBetween("2024-02-29", "2025-02-27"), { years: 0, months: 11, days: 29 });
  assert.deepEqual(ageBetween("2024-02-29", "2025-02-28"), { years: 1, months: 0, days: 0 });
  assert.deepEqual(ageBetween("2024-02-29", "2025-03-01"), { years: 1, months: 0, days: 1 });
  assert.deepEqual(ageBetween("2024-02-29", "2028-02-28"), { years: 3, months: 11, days: 30 });
  assert.deepEqual(ageBetween("2024-02-29", "2028-02-29"), { years: 4, months: 0, days: 0 });
  // Borrowing across a leap February counts 29 days.
  assert.deepEqual(ageBetween("2028-01-15", "2028-03-01"), { years: 0, months: 1, days: 15 });
  // Borrowing across a common February counts 28 days.
  assert.deepEqual(ageBetween("2025-01-15", "2025-03-01"), { years: 0, months: 1, days: 14 });
  // Year boundary.
  assert.deepEqual(ageBetween("2025-12-31", "2026-01-01"), { years: 0, months: 0, days: 1 });
});

test("formatAge reads like a parent counts", () => {
  assert.equal(formatAge(ageBetween(BIRTH, "2025-01-20")), "17 天");
  assert.equal(formatAge(ageBetween(BIRTH, "2025-08-11")), "7 个月");
  assert.equal(formatAge(ageBetween(BIRTH, "2026-08-14")), "1 岁 7 个月");
  assert.equal(formatAge(undefined), undefined);
});

test("timeSignatureFor gives a memory its historical age from the day it happened", () => {
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
  // A 2025 memory and a 2026 memory carry different ages of the same child.
  assert.equal(timeSignatureFor("2025-06-15T04:00:00Z", BIRTH).ageLabel, "5 个月");
  assert.equal(timeSignatureFor("2026-09-02T04:00:00Z", BIRTH).ageLabel, "1 岁 7 个月");
});

test("a month chapter carries the age reached in that month, without a day count", () => {
  assert.deepEqual(ageInMonth(BIRTH, "2026-08"), { years: 1, months: 7, days: 0 });
  assert.equal(ageAtMonth(BIRTH, "2026-08"), "1 岁 7 个月");
  assert.equal(ageAtMonth(BIRTH, "2026-09"), "1 岁 8 个月");
  assert.equal(ageAtMonth(BIRTH, "2026-01"), "1 岁");
  assert.equal(ageAtMonth(BIRTH, "2025-02"), "1 个月");
  assert.equal(ageAtMonth(BIRTH, "2025-01"), "出生的那个月");
  assert.equal(ageAtMonth(BIRTH, "2024-12"), undefined);
  assert.equal(ageAtMonth(undefined, "2026-08"), undefined);
});

test("a year chapter shows the range its months cover, not a single point", () => {
  assert.equal(ageSpan(BIRTH, ["2026-08", "2026-01", "2026-11"]), "1 岁 到 1 岁 10 个月");
  assert.equal(ageSpan(BIRTH, ["2025-01", "2025-12"]), "出生的那个月 到 11 个月");
  assert.equal(ageSpan(BIRTH, ["2026-08"]), "1 岁 7 个月");
  assert.equal(ageSpan(undefined, ["2026-08"]), undefined);
  assert.equal(ageSpan(BIRTH, []), undefined);
});

test("currentAge is today's age in the family's calendar, not UTC's", () => {
  assert.equal(currentAge(BIRTH, new Date("2026-09-02T00:00:00Z")), "1 岁 7 个月");
  // 15:59 UTC is still 2 September in Shanghai; 16:00 UTC is already the 3rd — his 20-month day.
  assert.equal(currentAge(BIRTH, new Date("2026-09-02T15:59:00Z")), "1 岁 7 个月");
  assert.equal(currentAge(BIRTH, new Date("2026-09-02T16:00:00Z")), "1 岁 8 个月");
  assert.equal(currentAge(undefined), undefined);
});
