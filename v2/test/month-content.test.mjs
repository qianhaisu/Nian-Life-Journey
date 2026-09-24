// The edited-month loader (lib/month-content.ts). Two things are load-bearing and both were missing
// when this shipped: a file that is merely SHAPED like content must not be accepted (the page reads
// every field without guarding, so a bad day threw inside the render), and the in-process memo must
// not remember an answer forever (a correction, or a file appearing after the first miss, was
// invisible until restart).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MONTH_CONTENT_TTL_MS, invalidateMonthContent, loadMonthContent,
  gateMaterialMedia, resolveMonthContentMedia, validateMonthContent,
} from "../lib/month-content.ts";

const MONTH = "2026-09";
const day = (over = {}) => ({
  day: "2026-09-01", ageLabel: "1岁7个月", kind: "story", title: "英语课上跟读了单词",
  paragraphs: ["老师说他跟读了单词。"], firstScreenMediaIds: ["m1"], expandedMediaIds: ["m1", "m2"],
  storyBoundMediaIds: [], eventId: null, ...over,
});
const doc = (over = {}) => ({
  schema: "nianlife.month-content/1", month: MONTH, cardLine: "一句话", intro: "一段",
  coverMediaId: "m1", days: [day()], ...over,
});

test("a well-formed month is accepted whole", () => {
  const ok = validateMonthContent(doc(), MONTH);
  assert.ok(ok);
  assert.equal(ok.days.length, 1);
  assert.equal(ok.days[0].day, "2026-09-01");
});

test("a file that is only SHAPED like content is refused, so the month falls back", () => {
  // Each of these passed the original check (schema + month + Array.isArray(days)) and then threw
  // or mis-rendered inside the page.
  const refused = {
    "days: [null]": doc({ days: [null] }),
    "days: [] (nothing to render)": doc({ days: [] }),
    "day is an array": doc({ days: [[]] }),
    "missing expandedMediaIds": doc({ days: [{ ...day(), expandedMediaIds: undefined }] }),
    "missing paragraphs": doc({ days: [{ ...day(), paragraphs: undefined }] }),
    "paragraphs holds a non-string": doc({ days: [{ ...day(), paragraphs: ["ok", 7] }] }),
    "paragraphs holds an empty string": doc({ days: [{ ...day(), paragraphs: [" "] }] }),
    "media id is not a string": doc({ days: [{ ...day(), expandedMediaIds: ["m1", null] }] }),
    "unknown kind": doc({ days: [{ ...day(), kind: "diary" }] }),
    "title is neither text nor null": doc({ days: [{ ...day(), title: 12 }] }),
    "day is not a date": doc({ days: [{ ...day(), day: "2026-09-1" }] }),
    "day belongs to another month": doc({ days: [{ ...day(), day: "2026-08-01" }] }),
    "impossible date": doc({ days: [{ ...day(), day: "2026-09-99" }] }),
    "same day twice": doc({ days: [day(), day()] }),
    "first screen is not part of the expanded set": doc({ days: [{ ...day(), firstScreenMediaIds: ["mX"] }] }),
    "day with neither words nor pictures": doc({ days: [{ ...day(), title: null, paragraphs: [], firstScreenMediaIds: [], expandedMediaIds: [] }] }),
    "wrong schema": doc({ schema: "nianlife.month-content/2" }),
    "wrong month": doc({ month: "2026-08" }),
    "cardLine is blank": doc({ cardLine: "   " }),
    "not an object": [doc()],
    "null": null,
  };
  for (const [why, value] of Object.entries(refused)) {
    assert.equal(validateMonthContent(value, MONTH), null, `should have been refused: ${why}`);
  }
});

test("one bad day takes the whole month down to the old layout, rather than half-rendering", () => {
  const halfGood = doc({ days: [day(), { ...day({ day: "2026-09-02" }), paragraphs: undefined }] });
  assert.equal(validateMonthContent(halfGood, MONTH), null);
});

test("an absent directory, an absent file and a malformed file all read as 'no edited content'", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "month-content-"));
  const previous = process.env.MONTH_CONTENT_DIR;
  try {
    delete process.env.MONTH_CONTENT_DIR;
    invalidateMonthContent();
    assert.equal(await loadMonthContent(MONTH), null, "no directory configured");

    process.env.MONTH_CONTENT_DIR = dir;
    invalidateMonthContent();
    assert.equal(await loadMonthContent(MONTH), null, "directory exists, file does not");

    fs.writeFileSync(path.join(dir, `${MONTH}.json`), "{ not json");
    invalidateMonthContent();
    assert.equal(await loadMonthContent(MONTH), null, "unparseable file");

    fs.writeFileSync(path.join(dir, `${MONTH}.json`), JSON.stringify(doc({ days: [null] })));
    invalidateMonthContent();
    assert.equal(await loadMonthContent(MONTH), null, "parseable but invalid file");

    fs.writeFileSync(path.join(dir, `${MONTH}.json`), JSON.stringify(doc()));
    invalidateMonthContent();
    assert.ok(await loadMonthContent(MONTH), "valid file");
  } finally {
    if (previous === undefined) delete process.env.MONTH_CONTENT_DIR;
    else process.env.MONTH_CONTENT_DIR = previous;
    invalidateMonthContent();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a remembered answer expires, so a file added or corrected later is picked up", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "month-content-"));
  const previous = process.env.MONTH_CONTENT_DIR;
  const file = path.join(dir, `${MONTH}.json`);
  try {
    process.env.MONTH_CONTENT_DIR = dir;
    invalidateMonthContent();

    // A miss is remembered too — that was the bug: a month with no file yet stayed "no content"
    // for the life of the process, so adding the file changed nothing until a restart.
    const t0 = 1_000_000;
    assert.equal(await loadMonthContent(MONTH, t0), null);
    fs.writeFileSync(file, JSON.stringify(doc()));
    assert.equal(await loadMonthContent(MONTH, t0 + 1000), null, "still inside the window");
    const afterTtl = await loadMonthContent(MONTH, t0 + MONTH_CONTENT_TTL_MS);
    assert.ok(afterTtl, "the file is read once the window passes");
    assert.equal(afterTtl.cardLine, "一句话");

    // An edit to the words is visible on the next request after an explicit invalidation, which is
    // what the refresh endpoint calls — not only after the window.
    fs.writeFileSync(file, JSON.stringify(doc({ cardLine: "改过的一句话" })));
    const stillCached = await loadMonthContent(MONTH, t0 + MONTH_CONTENT_TTL_MS + 1000);
    assert.equal(stillCached.cardLine, "一句话", "cached until invalidated or expired");
    invalidateMonthContent();
    const fresh = await loadMonthContent(MONTH, t0 + MONTH_CONTENT_TTL_MS + 1001);
    assert.equal(fresh.cardLine, "改过的一句话");

    // A withdrawn edit goes back to the old layout rather than serving a file that is gone.
    fs.rmSync(file);
    invalidateMonthContent();
    assert.equal(await loadMonthContent(MONTH, t0 + MONTH_CONTENT_TTL_MS + 2000), null);
  } finally {
    if (previous === undefined) delete process.env.MONTH_CONTENT_DIR;
    else process.env.MONTH_CONTENT_DIR = previous;
    invalidateMonthContent();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a curated id list never outvotes a later store_only, and never repeats a picture", () => {
  const available = new Map([["a", { id: "a" }], ["b", { id: "b" }], ["c", { id: "c" }]]);
  const excluded = new Set(["b"]);

  // order preserved, withdrawn picture dropped, duplicate ignored, unknown id ignored
  assert.deepEqual(
    resolveMonthContentMedia(["c", "b", "a", "c", "gone"], available, excluded).map((m) => m.id),
    ["c", "a"],
  );
  // with nothing withdrawn the list is exactly the curated order
  assert.deepEqual(
    resolveMonthContentMedia(["a", "b", "c"], available).map((m) => m.id),
    ["a", "b", "c"],
  );
  // a day whose every picture was withdrawn resolves to nothing, rather than to a substitute
  assert.deepEqual(resolveMonthContentMedia(["b"], available, excluded), []);
});

test("portrait framing is opt-in and refuses unknown layout values", () => {
  for (const coverFrame of [undefined, "square", "full"]) assert.ok(validateMonthContent(doc({ coverFrame }), MONTH));
  for (const coverFrame of [null, "", "wide", "url(example)", {}, 1]) assert.equal(validateMonthContent(doc({ coverFrame }), MONTH), null);
});

test("a cover focal point is two plain percentages, or the month is refused", () => {
  // It ends up inside a CSS value on the /memory card, so it is checked like every other field.
  assert.ok(validateMonthContent(doc({ coverFocal: { mobilePercent: 30, desktopPercent: 45 } }), MONTH));
  assert.ok(validateMonthContent(doc({ coverFocal: { mobilePercent: 0, desktopPercent: 100, note: "measured" } }), MONTH));
  for (const bad of [
    { mobilePercent: "30%", desktopPercent: 45 },
    { mobilePercent: 30 },
    { mobilePercent: -1, desktopPercent: 45 },
    { mobilePercent: 30, desktopPercent: 101 },
    { mobilePercent: Number.NaN, desktopPercent: 45 },
    [30, 45],
    null,
    "50% 30%",
  ]) {
    assert.equal(validateMonthContent(doc({ coverFocal: bad }), MONTH), null, JSON.stringify(bad));
  }
});

test("the material section never draws a picture a reviewer withdrew", () => {
  // Pictures in the material arrive through the cited messages, not the curated list, so the same
  // store_only veto has to hold on that road too.
  const carried = [{ id: "m1" }, { id: "withdrawn" }, { id: "m3" }];
  assert.deepEqual(gateMaterialMedia(carried, new Set(["withdrawn"])).map((m) => m.id), ["m1", "m3"]);
  assert.deepEqual(gateMaterialMedia(carried, undefined).map((m) => m.id), ["m1", "withdrawn", "m3"]);
  assert.deepEqual(gateMaterialMedia(carried, new Set()).map((m) => m.id), ["m1", "withdrawn", "m3"]);
});
