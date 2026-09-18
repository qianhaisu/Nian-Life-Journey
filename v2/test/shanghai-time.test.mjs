// Two kinds of stored time, two different rules (lib/shanghai-time.ts). Getting these confused is
// how 6,738 media rows ended up eight hours early, and separately how a message sent at 10:00 in
// Shanghai printed as 02:00 on a page served from a UTC server.
import test from "node:test";
import assert from "node:assert/strict";
import { shanghaiClock, shanghaiDay, wallClockTime } from "../lib/shanghai-time.ts";

test("a real instant is rendered in Shanghai, whatever the server's own zone is", () => {
  // 2026-09-07T07:17:17Z is 15:17 in Shanghai — the 「他会说cold」 message.
  assert.equal(shanghaiClock("2026-09-07T07:17:17.000Z"), "15:17");
  assert.equal(shanghaiDay("2026-09-07T07:17:17.000Z"), "2026-09-07");
});

test("the 00:00-08:00 window lands on the right Shanghai day, not the UTC one", () => {
  // The whole window is the previous UTC day. A UTC-based render put these on 9/12 at 16:xx-23:xx.
  const cases = [
    { instant: "2026-09-12T16:00:00.000Z", day: "2026-09-13", clock: "00:00" },
    { instant: "2026-09-12T16:30:00.000Z", day: "2026-09-13", clock: "00:30" },
    { instant: "2026-09-12T19:05:00.000Z", day: "2026-09-13", clock: "03:05" },
    { instant: "2026-09-12T23:59:00.000Z", day: "2026-09-13", clock: "07:59" },
    // and the first instant that is no longer in the window
    { instant: "2026-09-13T00:00:00.000Z", day: "2026-09-13", clock: "08:00" },
  ];
  for (const { instant, day, clock } of cases) {
    assert.equal(shanghaiDay(instant), day, `${instant} should fall on ${day}`);
    assert.equal(shanghaiClock(instant), clock, `${instant} should read ${clock}`);
  }
});

test("midnight exactly is 00:00 of the new day, not 24:00 of the old one", () => {
  assert.equal(shanghaiClock("2026-09-30T16:00:00.000Z"), "00:00");
  assert.equal(shanghaiDay("2026-09-30T16:00:00.000Z"), "2026-10-01");
});

test("a zone-less wall clock is read, never converted", () => {
  // media.taken_at is a plain timestamp whose digits already ARE Shanghai local. Converting it
  // would move it; adding eight hours would move it twice.
  assert.equal(wallClockTime("2026-09-13 23:45:00"), "23:45");
  assert.equal(wallClockTime("2026-09-13T00:30:00"), "00:30");
  assert.equal(wallClockTime("not a time"), "");
});

test("an unparseable instant yields nothing rather than 'Invalid Date'", () => {
  assert.equal(shanghaiClock("nonsense"), "");
  assert.equal(shanghaiDay(""), "");
});
