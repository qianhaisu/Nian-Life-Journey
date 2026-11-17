import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRefreshRequest } from "../lib/archive-refresh.ts";
import {
  WEEKEND_CONTENT_TTL_MS,
  invalidateWeekendContent,
  isWithin30Days,
  readCurrentWeekendBundle,
  readWeekendById,
  validateWeekendSnapshot,
} from "../lib/weekend/content.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures", "weekend-2026-11-21.json");
const fixtureJson = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function makeTempContentDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "weekend-content-test-"));
}

function withContentDir(dir, fn) {
  const prev = process.env.WEEKEND_CONTENT_DIR;
  process.env.WEEKEND_CONTENT_DIR = dir;
  invalidateWeekendContent();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prev === undefined) delete process.env.WEEKEND_CONTENT_DIR;
      else process.env.WEEKEND_CONTENT_DIR = prev;
      invalidateWeekendContent();
      fs.rmSync(dir, { recursive: true, force: true });
    });
}

test("types.ts does not define removed voting or share-template structures", () => {
  const typesSource = fs.readFileSync(path.join(__dirname, "..", "lib", "weekend", "types.ts"), "utf8");
  for (const forbidden of ["actors", "votes", "consensus", "wechatShareTemplates"]) {
    assert.equal(new RegExp(`\\b${forbidden}\\b`).test(typesSource), false, `types.ts must not include ${forbidden}`);
  }
});

test("real fixture weekend-2026-11-21.json validates cleanly and has no forbidden fields", () => {
  const validated = validateWeekendSnapshot(fixtureJson);
  assert.ok(validated);
  assert.equal(validated.weekId, "2026-11-21");
  assert.equal(validated.proposals.length, 3);
  assert.equal(validated.inspirationPool.length, 4);
  for (const key of ["actors", "votes", "consensus", "wechatShareTemplates"]) {
    assert.equal(key in validated, false);
  }
});

test("missing or malformed current.json resolves to unavailable without throwing, and falls back to weeks/ archive", async () => {
  const dir = makeTempContentDir();
  await withContentDir(dir, async () => {
    const emptyBundle = await readCurrentWeekendBundle(new Date("2026-11-18T10:00:00+08:00"));
    assert.equal(emptyBundle.effectiveStatus, "unavailable");
    assert.equal(emptyBundle.snapshot, null);
    assert.equal(emptyBundle.historicalSnapshot, null);
    assert.equal(emptyBundle.statusHeadline, "本周推荐暂未更新");

    // Malformed current.json + valid weeks/2026-11-21.json fallback
    fs.writeFileSync(path.join(dir, "current.json"), "{ invalid json");
    fs.mkdirSync(path.join(dir, "weeks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "weeks", "2026-11-21.json"), JSON.stringify(fixtureJson));
    invalidateWeekendContent();

    const fallbackBundle = await readCurrentWeekendBundle(new Date("2026-11-25T10:00:00+08:00"));
    assert.equal(fallbackBundle.effectiveStatus, "unavailable");
    assert.equal(fallbackBundle.snapshot, null);
    assert.ok(fallbackBundle.historicalSnapshot);
    assert.equal(fallbackBundle.historicalSnapshot.weekId, "2026-11-21");
    assert.equal(fallbackBundle.historicalSnapshot.weekendRange.label, "2026 年 11 月 21 日 – 22 日");
    assert.equal(fallbackBundle.historicalSnapshot.status, "expired");
  });
});

test("cross-week expiration downgrades current.json to unavailable with historicalSnapshot and marks readWeekendById expired", async () => {
  const dir = makeTempContentDir();
  await withContentDir(dir, async () => {
    fs.writeFileSync(path.join(dir, "current.json"), JSON.stringify(fixtureJson));
    fs.mkdirSync(path.join(dir, "weeks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "weeks", "2026-11-21.json"), JSON.stringify(fixtureJson));

    // Active before/during weekend (2026-11-22 23:00 Shanghai)
    const active = await readCurrentWeekendBundle(new Date("2026-11-22T15:00:00Z"));
    assert.equal(active.effectiveStatus, "published");
    assert.equal(active.statusHeadline, "本周推荐已就绪");
    assert.equal(active.isExpired, false);
    assert.ok(active.snapshot);
    assert.equal(active.historicalSnapshot, null);

    // Just crossed midnight into Monday 2026-11-23 00:05 Shanghai (2026-11-22T16:05:00Z)
    const expiredCurrent = await readCurrentWeekendBundle(new Date("2026-11-22T16:05:00Z"));
    assert.equal(expiredCurrent.effectiveStatus, "unavailable");
    assert.equal(expiredCurrent.isExpired, true);
    assert.equal(expiredCurrent.weekId, null);
    assert.equal(expiredCurrent.snapshot, null);
    assert.equal(expiredCurrent.statusHeadline, "本周推荐暂未更新");
    assert.ok(expiredCurrent.historicalSnapshot);
    assert.equal(expiredCurrent.historicalSnapshot.weekendRange.label, "2026 年 11 月 21 日 – 22 日");
    assert.equal(expiredCurrent.historicalSnapshot.status, "expired");

    // Direct week lookup on or before 2026-11-22 -> published; after 2026-11-22 -> expired
    const onTimeWeek = await readWeekendById("2026-11-21", new Date("2026-11-21T09:00:00+08:00"));
    assert.ok(onTimeWeek);
    assert.equal(onTimeWeek.effectiveStatus, "published");
    assert.equal(onTimeWeek.isExpired, false);

    const expiredWeek = await readWeekendById("2026-11-21", new Date("2026-11-23T09:00:00+08:00"));
    assert.ok(expiredWeek);
    assert.equal(expiredWeek.effectiveStatus, "expired");
    assert.equal(expiredWeek.isExpired, true);
    assert.equal(expiredWeek.snapshot.weekendRange.label, "2026 年 11 月 21 日 – 22 日");

    // Invalid weekId or traversal is rejected cleanly
    assert.equal(await readWeekendById("../2026-11-21"), null);
    assert.equal(await readWeekendById("2026-02-30"), null);
  });
});

test("ageOn and dynamic 30-day within30Days are recomputed strictly relative to snapshot.weekendRange.from", async () => {
  const dir = makeTempContentDir();
  await withContentDir(dir, async () => {
    const modified = structuredClone(fixtureJson);
    // Deliberately put stale age text in JSON to prove dynamic ageOn overrides it
    modified.childProfile.ageOnSaturday = "STALE";
    modified.childProfile.ageLabel = "STALE";
    // Boundary notes relative to weekendRange.from ("2026-11-21")
    modified.proposals[0].xhsEvidence.notes[0].publishedAt = "2026-10-22"; // exactly 30 days before 2026-11-21 -> true
    modified.proposals[0].xhsEvidence.notes[1].publishedAt = "2026-10-21"; // 31 days before 2026-11-21 -> false
    modified.inspirationPool[0].xhsEvidence[0].publishedAt = "2026-11-21"; // 0 days before 2026-11-21 -> true
    modified.inspirationPool[1].xhsEvidence[0].publishedAt = "2026-11-22"; // after weekend start (-1 day) -> false

    fs.writeFileSync(path.join(dir, "current.json"), JSON.stringify(modified));
    // 2026-11-17T20:00:00Z == 2026-11-18 04:00:00 Asia/Shanghai
    const bundleEarly = await readCurrentWeekendBundle(new Date("2026-11-17T20:00:00Z"));
    assert.equal(bundleEarly.today, "2026-11-18");
    assert.ok(bundleEarly.snapshot);
    assert.equal(bundleEarly.snapshot.childProfile.ageOnSaturday, "1 岁 10 个月");
    assert.equal(bundleEarly.snapshot.childProfile.ageLabel, "1 岁 10 个月");
    assert.equal(bundleEarly.snapshot.proposals[0].xhsEvidence.notes[0].within30Days, true);
    assert.equal(bundleEarly.snapshot.proposals[0].xhsEvidence.notes[1].within30Days, false);
    assert.equal(bundleEarly.snapshot.inspirationPool[0].xhsEvidence[0].within30Days, true);
    assert.equal(bundleEarly.snapshot.inspirationPool[1].xhsEvidence[0].within30Days, false);

    // Reaching weekend start (2026-11-21) keeps the exact same within30Days verdict (no contradiction)
    const bundleOnWeekend = await readCurrentWeekendBundle(new Date("2026-11-21T10:00:00+08:00"));
    assert.equal(bundleOnWeekend.snapshot?.proposals[0].xhsEvidence.notes[0].within30Days, true);
    assert.equal(bundleOnWeekend.snapshot?.proposals[0].xhsEvidence.notes[1].within30Days, false);

    assert.equal(isWithin30Days("2026-10-22", "2026-11-21"), true);
    assert.equal(isWithin30Days("2026-10-21", "2026-11-21"), false);
    assert.equal(isWithin30Days("2026-11-22", "2026-11-21"), false);

    // Also test a later month weekend for ageOn ("1 岁 11 个月" on 2026-12-05)
    const dec = structuredClone(fixtureJson);
    dec.weekId = "2026-12-05";
    dec.weekendRange = {
      from: "2026-12-05",
      to: "2026-12-06",
      label: "2026 年 12 月 5 日 – 6 日",
      satLabel: "周六 12.05",
      sunLabel: "周日 12.06",
    };
    fs.mkdirSync(path.join(dir, "weeks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "weeks", "2026-12-05.json"), JSON.stringify(dec));
    const decBundle = await readWeekendById("2026-12-05", new Date("2026-12-03T12:00:00+08:00"));
    assert.ok(decBundle);
    assert.equal(decBundle.snapshot.childProfile.ageOnSaturday, "1 岁 11 个月");
  });
});

test("300_000 ms TTL cache serves cached read until TTL expires or invalidateWeekendContent() is called", async () => {
  const dir = makeTempContentDir();
  await withContentDir(dir, async () => {
    const file = path.join(dir, "current.json");
    const first = structuredClone(fixtureJson);
    first.verificationSummaryNote = "version-1";
    fs.writeFileSync(file, JSON.stringify(first));

    const t0 = new Date("2026-11-18T10:00:00+08:00");
    const r1 = await readCurrentWeekendBundle(t0);
    assert.equal(r1.snapshot?.verificationSummaryNote, "version-1");

    const second = structuredClone(fixtureJson);
    second.verificationSummaryNote = "version-2";
    fs.writeFileSync(file, JSON.stringify(second));

    // Inside TTL window -> still cached
    const insideTtl = await readCurrentWeekendBundle(new Date(t0.getTime() + 1000));
    assert.equal(insideTtl.snapshot?.verificationSummaryNote, "version-1");

    // At TTL boundary -> expires and re-reads
    const afterTtl = await readCurrentWeekendBundle(new Date(t0.getTime() + WEEKEND_CONTENT_TTL_MS));
    assert.equal(afterTtl.snapshot?.verificationSummaryNote, "version-2");

    // Explicit invalidation clears cache immediately
    const third = structuredClone(fixtureJson);
    third.verificationSummaryNote = "version-3";
    fs.writeFileSync(file, JSON.stringify(third));
    const stillCached = await readCurrentWeekendBundle(new Date(t0.getTime() + WEEKEND_CONTENT_TTL_MS + 1000));
    assert.equal(stillCached.snapshot?.verificationSummaryNote, "version-2");

    invalidateWeekendContent();
    const afterInvalidate = await readCurrentWeekendBundle(new Date(t0.getTime() + WEEKEND_CONTENT_TTL_MS + 2000));
    assert.equal(afterInvalidate.snapshot?.verificationSummaryNote, "version-3");
  });
});

test("archive-refresh and revalidate route support scope weekend without breaking archive scope", () => {
  const weekendReq = parseRefreshRequest({ scope: "weekend" });
  assert.equal(weekendReq.ok, true);
  assert.equal(weekendReq.scope, "weekend");
  assert.equal(weekendReq.clearsWeekendContent, true);
  assert.equal(weekendReq.clearsArchiveMemo, false);
  assert.deepEqual(weekendReq.targets, [
    { path: "/" },
    { path: "/travel" },
    { path: "/travel/weekend/[weekId]", type: "page" },
  ]);

  const travelPathReq = parseRefreshRequest({ paths: ["/travel"] });
  assert.equal(travelPathReq.ok, true);
  assert.equal(travelPathReq.clearsWeekendContent, true);
  assert.equal(travelPathReq.clearsArchiveMemo, false);

  const routeSource = fs.readFileSync(
    path.join(__dirname, "..", "app", "api", "internal", "revalidate", "route.ts"),
    "utf8",
  );
  assert.match(routeSource, /invalidateWeekendContent\(\)/);
  assert.match(routeSource, /parsed\.clearsWeekendContent/);
});

test("explicit unavailable, collecting, and rest_recommended statuses preserve fallback archive and strip forbidden legacy keys", async () => {
  const dir = makeTempContentDir();
  await withContentDir(dir, async () => {
    fs.mkdirSync(path.join(dir, "weeks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "weeks", "2026-11-21.json"), JSON.stringify(fixtureJson));

    // Explicit unavailable for 2026-11-28 with fallbackArchiveWeekId -> historicalSnapshot points to 2026-11-21
    const unavail = structuredClone(fixtureJson);
    unavail.weekId = "2026-11-28";
    unavail.weekendRange = {
      from: "2026-11-28",
      to: "2026-11-29",
      label: "2026 年 11 月 28 日 – 29 日",
      satLabel: "周六 11.28",
      sunLabel: "周日 11.29",
    };
    unavail.status = "unavailable";
    unavail.proposals = [];
    unavail.unavailableNotice = {
      reason: "xhs_auth_expired",
      headline: "本周推荐暂未更新",
      summary: "小红书登录态过期，请先扫码重登。",
      detectedAt: "2026-11-25T12:00:00Z",
      actionForTeddy: "双击 relogin.cmd 扫码",
      fallbackArchiveWeekId: "2026-11-21",
    };
    // Inject forbidden keys to confirm reader strips them
    unavail.actors = ["teddy"];
    unavail.wechatShareTemplates = { family: "x" };
    fs.writeFileSync(path.join(dir, "current.json"), JSON.stringify(unavail));

    const b1 = await readCurrentWeekendBundle(new Date("2026-11-26T10:00:00+08:00"));
    assert.equal(b1.effectiveStatus, "unavailable");
    assert.ok(b1.snapshot);
    assert.equal("actors" in b1.snapshot, false);
    assert.equal("wechatShareTemplates" in b1.snapshot, false);
    assert.ok(b1.historicalSnapshot);
    assert.equal(b1.historicalSnapshot.weekId, "2026-11-21");
    assert.equal(b1.historicalSnapshot.status, "expired");

    // Explicit collecting status
    const collecting = structuredClone(unavail);
    collecting.status = "collecting";
    delete collecting.unavailableNotice;
    fs.writeFileSync(path.join(dir, "current.json"), JSON.stringify(collecting));
    invalidateWeekendContent();
    const b2 = await readCurrentWeekendBundle(new Date("2026-11-26T10:00:00+08:00"));
    assert.equal(b2.effectiveStatus, "collecting");
    assert.equal(b2.statusHeadline, "本周出行想法整理中");
    assert.ok(b2.historicalSnapshot);
    assert.equal(b2.historicalSnapshot.weekId, "2026-11-21");

    // Explicit rest_recommended status
    const rest = structuredClone(collecting);
    rest.status = "rest_recommended";
    rest.restRecommendation = {
      reason: "全城大风降雨，适合在家附近轻松过。",
      weatherOrCrowdTrigger: "周六阵雨降温",
      microActivities: [{ title: "小区旁面包店买热可可", driveMinutes: "步行 8 分钟", indoor: true, note: "随时回家" }],
    };
    fs.writeFileSync(path.join(dir, "current.json"), JSON.stringify(rest));
    invalidateWeekendContent();
    const b3 = await readCurrentWeekendBundle(new Date("2026-11-26T10:00:00+08:00"));
    assert.equal(b3.effectiveStatus, "rest_recommended");
    assert.equal(b3.snapshot?.restRecommendation?.microActivities.length, 1);
  });
});
