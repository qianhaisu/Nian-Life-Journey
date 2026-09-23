import { test } from "node:test";
import assert from "node:assert/strict";

const { cutWeeks } = await import("../lib/month-timeline.ts");
const { resolveDaySpeakers } = await import("../lib/day-speakers.ts");
const { senderDigestForDisplayName } = await import("../lib/organizer/identity.ts");

const days = (month, list) => list.map((d) => `${month}-${String(d).padStart(2, "0")}`);

test("an older month reads 1–7, 8–14 … in date order", () => {
  const weeks = cutWeeks(days("2025-12", [31, 1, 3, 7, 8, 15, 22, 29]), "asc");
  assert.deepEqual(weeks.map((w) => w.label), ["12 月 1–7 日", "12 月 8–14 日", "12 月 15–21 日", "12 月 22–28 日", "12 月 29–31 日"]);
  assert.deepEqual(weeks[0].days, ["2025-12-01", "2025-12-03", "2025-12-07"]);
  assert.deepEqual(weeks.flatMap((w) => w.days), [...weeks.flatMap((w) => w.days)].sort());
});

test("the newest month counts back from its latest day, newest first", () => {
  const weeks = cutWeeks(days("2026-09", [1, 2, 9, 15, 16, 20, 22]), "desc");
  assert.deepEqual(weeks.map((w) => w.label), ["9 月 16–22 日", "9 月 9–15 日", "9 月 2–8 日", "9 月 1 日"]);
  assert.deepEqual(weeks[0].days, ["2026-09-22", "2026-09-20", "2026-09-16"]);
  assert.equal(weeks.at(-1).days.at(-1), "2026-09-01");
});

test("empty weeks do not exist", () => {
  const weeks = cutWeeks(days("2025-12", [1, 30]), "asc");
  assert.deepEqual(weeks.map((w) => w.id), ["week-1", "week-5"]);
});

test("speaker names come from the registry before the content file's table", () => {
  const mom = { id: "s1", senderDigest: senderDigestForDisplayName("阿静"), sourceLabel: "any" };
  const stranger = { id: "s2", senderDigest: "f".repeat(64), sourceLabel: "any" };
  const noDigest = { id: "s3", sourceLabel: "any" };
  const guess = { id: "s4", senderDigest: "e".repeat(64), sourceLabel: "any" };
  const out = resolveDaySpeakers([mom, stranger, noDigest, guess], { s1: "发言人E", s2: "发言人F", s3: "妈妈", s4: "小年小姨" });
  assert.equal(out.s1, "妈妈", "registry wins over a stale anonymous label");
  assert.equal(out.s2, "发言人F", "someone the registry cannot name keeps the placeholder");
  assert.equal(out.s3, "妈妈", "a registered label in the table is kept when there is no digest");
  assert.equal(out.s4, "小年小姨", "without a registry answer the file's label stands as written");
});
