import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import {
  parseExifRawDateString,
  isUtcOffset,
  resolveCaptureTime,
  itemMatchesPreWindow,
  normalizeImgStem,
  parseWallClockEpochSeconds,
  buildExistingMediaIndex,
  findExistingMediaMatch,
  loadExistingRdsMediaWindow,
  stageDownloadedItem,
  matchPreDownloadExistingStemTime,
  isValidShotMs,
  parseQuarkCliArgs,
  mapWithConcurrency,
  QuarkAuthError,
  runQuarkDailySync,
  ensureOssEnv,
} from "../scripts/editor/quark-daily-sync.mjs";
import { validateDayText, timeWordProblems, extractValidHours } from "../scripts/editor/validate-day.mjs";
import { buildCandidate, loadSources, sourceFingerprint, resolvePrepareWindow, shouldIncludeDay } from "../scripts/editor/codex-editor.mjs";
import { assertValidDateWindow, isValidDay } from "../scripts/editor/session-photo-review.mjs";

const NOW = "2026-11-15T08:00:00.000Z";

test("parseExifRawDateString keeps LA -08:00 as local wall clock and converts only UTC offsets to +08:00", () => {
  assert.equal(parseExifRawDateString("2024:12:24 17:18:55", "-08:00"), "2024-12-24 17:18:55");
  assert.equal(parseExifRawDateString("2024:12:24 23:45:10", "-08:00"), "2024-12-24 23:45:10");
  assert.equal(parseExifRawDateString("2024:12:24 17:18:55", "+08:00"), "2024-12-24 17:18:55");
  assert.equal(parseExifRawDateString("2024:12:24 17:18:55"), "2024-12-24 17:18:55");

  assert.equal(isUtcOffset("Z"), true);
  assert.equal(isUtcOffset(" +00:00 "), true);
  assert.equal(isUtcOffset("-00:00"), true);
  assert.equal(isUtcOffset("+0000"), true);
  assert.equal(isUtcOffset("-0000"), true);
  assert.equal(isUtcOffset("-08:00"), false);

  assert.equal(parseExifRawDateString("2024:12:24 09:18:55", "Z"), "2024-12-24 17:18:55");
  assert.equal(parseExifRawDateString("2024:12:24 20:00:00", "+00:00"), "2024-12-25 04:00:00");
  assert.equal(parseExifRawDateString("2024:12:24 20:00:00", "-00:00"), "2024-12-25 04:00:00");
  assert.equal(parseExifRawDateString("2024:12:24 20:00:00", "+0000"), "2024-12-25 04:00:00");
  assert.equal(parseExifRawDateString("2024:12:24 20:00:00", "-0000"), "2024-12-25 04:00:00");

  const resolved = resolveCaptureTime({
    filename: "IMG_5861.HEIC",
    exif: { DateTimeOriginal: "2024:12:24 17:18:55", OffsetTimeOriginal: "-08:00" },
    lShotAt: Date.parse("2024-12-25T01:18:55Z"),
  });
  assert.deepEqual(resolved, { text: "2024-12-24 17:18:55", reliable: true, source: "exif_datetime_original" });
});

test("itemMatchesPreWindow applies widened +/-2 day buffer around [since, until]", () => {
  const since = "2024-12-10";
  const until = "2024-12-20";
  assert.equal(itemMatchesPreWindow({ filename: "IMG_20241208_120000.jpg" }, since, until), true);
  assert.equal(itemMatchesPreWindow({ filename: "IMG_20241222_120000.jpg" }, since, until), true);
  assert.equal(itemMatchesPreWindow({ filename: "IMG_20241207_235959.jpg" }, since, until), false);
  assert.equal(itemMatchesPreWindow({ filename: "IMG_20241223_000001.jpg" }, since, until), false);
});

test("cross-encoder IMG_NNNN +/-5s RDS deduplication matches wall-clock '2024-12-24 17:18:55' regardless of runner TZ", async () => {
  assert.equal(normalizeImgStem("IMG_5861-b8055af8f6e3.jpg"), "IMG_5861");
  assert.equal(normalizeImgStem("img_0131_20240721.heic"), "IMG_0131");
  assert.equal(normalizeImgStem("random_photo.jpg"), null);

  const existingRows = [
    {
      id: "media-quark-sha-existing",
      original_filename: "IMG_5861-b8055af8f6e3.jpg",
      object_key: null,
      original_key: "media/originals/asset-quark-sha-existing.jpg",
      asset_checksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      taken_at_str: "2024-12-24 17:18:55",
    },
  ];
  const index = buildExistingMediaIndex(existingRows);

  const exactHit = findExistingMediaMatch({ filename: "IMG_5861.HEIC", captureTimeText: "2024-12-24 17:18:55" }, index);
  assert.equal(exactHit?.matchedBy, "stem_time");
  assert.equal(exactHit?.diffSeconds, 0);
  assert.equal(exactHit?.existing.id, "media-quark-sha-existing");

  const fiveSecHit = findExistingMediaMatch({ filename: "IMG_5861.HEIC", captureTimeText: "2024-12-24 17:19:00" }, index);
  assert.equal(fiveSecHit?.matchedBy, "stem_time");
  assert.equal(fiveSecHit?.diffSeconds, 5);

  const sixSecMiss = findExistingMediaMatch({ filename: "IMG_5861.HEIC", captureTimeText: "2024-12-24 17:19:01" }, index);
  assert.equal(sixSecMiss, null);

  const shaHit = findExistingMediaMatch(
    {
      filename: "DIFFERENT_NAME.jpg",
      captureTimeText: "2024-12-24 10:00:00",
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    index,
  );
  assert.equal(shaHit?.matchedBy, "sha256");

  // Verify UTC wall-clock epoch calculation stays identical when runner TZ=America/Los_Angeles
  const probe = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import { findExistingMediaMatch, buildExistingMediaIndex, parseWallClockEpochSeconds } from "./scripts/editor/quark-daily-sync.mjs";
       const idx = buildExistingMediaIndex([{ id: "m1", original_filename: "IMG_5861-abc.jpg", taken_at_str: "2024-12-24 17:18:55" }]);
       const hit = findExistingMediaMatch({ filename: "IMG_5861.HEIC", captureTimeText: "2024-12-24 17:18:55" }, idx);
       console.log(JSON.stringify({ epoch: parseWallClockEpochSeconds("2024-12-24 17:18:55"), matchedId: hit?.existing?.id, diff: hit?.diffSeconds }));`,
    ],
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: { ...process.env, TZ: "America/Los_Angeles" },
      encoding: "utf8",
    },
  );
  assert.equal(probe.status, 0, probe.stderr);
  const parsed = JSON.parse(probe.stdout.trim());
  assert.equal(parsed.epoch, parseWallClockEpochSeconds("2024-12-24 17:18:55"));
  assert.equal(parsed.matchedId, "m1");
  assert.equal(parsed.diff, 0);

  // Verify loadExistingRdsMediaWindow passes [since - 2d, until + 3d)
  const capturedSql = [];
  await loadExistingRdsMediaWindow(
    {
      query: async (sql, params) => {
        capturedSql.push({ sql, params });
        return { rows: [] };
      },
    },
    "2024-12-01",
    "2024-12-31",
  );
  assert.deepEqual(capturedSql[0].params, ["2024-11-29", "2025-01-03"]);

  // Verify stageDownloadedItem skips cross-encoder duplicate and passes non-matching +6s photo
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quark-dedupe-"));
  try {
    const imgPath = path.join(tmpRoot, "IMG_5861.jpg");
    await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 120, g: 160, b: 200 } } })
      .jpeg()
      .toFile(imgPath);

    const skippedRes = await stageDownloadedItem({
      item: {
        fid: "fid-dup",
        filename: "IMG_5861.jpg",
        l_shot_at: Date.parse("2024-12-24T17:18:55+08:00"),
        shoot_device: "iPhone 15 Pro",
      },
      localPath: imgPath,
      convertedDir: path.join(tmpRoot, "converted"),
      seenSha256: new Set(),
      existingMediaIndex: index,
      sinceDay: "2024-12-01",
      untilDay: "2024-12-31",
    });
    assert.equal(skippedRes.status, "skipped");
    assert.equal(skippedRes.category, "existing_stem_time");
    assert.equal(skippedRes.matchedMediaId, "media-quark-sha-existing");

    const readyRes = await stageDownloadedItem({
      item: {
        fid: "fid-new",
        filename: "IMG_5861.jpg",
        l_shot_at: Date.parse("2024-12-24T17:19:02+08:00"),
        shoot_device: "iPhone 15 Pro",
      },
      localPath: imgPath,
      convertedDir: path.join(tmpRoot, "converted"),
      seenSha256: new Set(),
      existingMediaIndex: index,
      sinceDay: "2024-12-01",
      untilDay: "2024-12-31",
    });
    assert.equal(readyRes.status, "ready");
    assert.equal(readyRes.captureDay, "2024-12-24");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("validateDayText allows 妈妈/爸爸 presence on pre-birth photo-backed days while strictly blocking invented quotes, speech, send, and real names", () => {
  const photoSource = [{ id: "source-quark-sha-1", speaker: null, text: "", time: "17:18:55" }];
  const entry = {
    day: "2024-12-24",
    title: "木栈道尽头的晚霞",
    paragraphs: ["傍晚风不大，妈妈和爸爸站在木栈道尽头看海浪慢慢退下去。"],
    firstScreenMediaIds: ["media-1"],
  };

  const ok = validateDayText(entry, photoSource, { realNames: ["张大宝"], literary: true });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(
    ok.evidence.persons.map((p) => [p.label, p.role, p.basis]),
    [
      ["妈妈", "presence", "prebirth-photo-presence"],
      ["爸爸", "presence", "prebirth-photo-presence"],
    ],
  );

  // Strict quote check still blocks invented quotes on photo-only days
  const badQuote = validateDayText(
    { ...entry, paragraphs: ["妈妈说「今晚风真舒服」。"] },
    photoSource,
    { realNames: ["张大宝"] },
  );
  assert.match(badQuote.errors.join(" | "), /引语找不到来源/);
  assert.match(badQuote.errors.join(" | "), /没有妈妈发的消息/);

  // Role === "send" stays blocked without WeChat sender
  const badSend = validateDayText(
    { ...entry, paragraphs: ["爸爸拍下一张夕阳。"] },
    photoSource,
    { realNames: ["张大宝"] },
  );
  assert.match(badSend.errors.join(" | "), /没有爸爸发的消息/);

  // Non-parents (e.g. 外婆) presence still requires text mention
  const badGrandma = validateDayText(
    { ...entry, paragraphs: ["外婆和妈妈在海边散步。"] },
    photoSource,
    { realNames: ["张大宝"] },
  );
  assert.match(badGrandma.errors.join(" | "), /点名了外婆在场/);

  // Real name stays strictly blocked
  const badRealName = validateDayText(
    { ...entry, paragraphs: ["张大宝站在海边看日落。"] },
    photoSource,
    { realNames: ["张大宝"] },
  );
  assert.match(badRealName.errors.join(" | "), /出现真实姓名/);

  // Post-birth boundary (>= 2025-01-03) still requires text mention for 妈妈/爸爸 presence
  const postBirth = validateDayText(
    { ...entry, day: "2025-01-03" },
    photoSource,
    { realNames: ["张大宝"] },
  );
  assert.match(postBirth.errors.join(" | "), /点名了妈妈在场/);

  // Photo-only capture hour mismatch vs absent hours behavior
  assert.deepEqual(timeWordProblems("上午出门散步。", [], { captureHours: [] }), []);
  assert.deepEqual(timeWordProblems("傍晚看太阳落山。", [17]), []);
  assert.deepEqual(timeWordProblems("早上看太阳落山。", [17]), ["早上"]);
  assert.deepEqual(extractValidHours([{ time: "" }, { time: null }, { time: "17:18:55" }]), [17]);

  const badHour = validateDayText(
    { ...entry, paragraphs: ["早上妈妈和爸爸站在木栈道尽头。"] },
    photoSource,
    { realNames: ["张大宝"] },
  );
  assert.match(badHour.errors.join(" | "), /时间不符：早上/);
});

test("codex-editor loadSources and buildCandidate support pre-birth photo-only days without writing 未登记的人", async () => {
  const queries = [];
  const mockClient = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("source_type='wechat'")) {
        return { rows: [] };
      }
      return {
        rows: [
          {
            id: "source-quark-sha-photo1",
            day: "2024-12-24",
            time: "17:18:55.000000",
            text: "",
            source_label: "Quark 照片同步",
            original_filename: "IMG_5861.jpg",
            media_ids: ["media-quark-sha-photo1"],
          },
        ],
      };
    },
  };

  const loaded = await loadSources(mockClient, "2024-12-01", "2025-01-01");
  assert.equal(queries.length, 2);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].sourceType, "family_photo");
  assert.equal(loaded[0].speaker, null);
  assert.equal(loaded[0].fingerprint, sourceFingerprint(loaded[0]));

  const wechatNull = {
    id: "source-wechat-unreg",
    day: "2024-12-24",
    time: "20:10:00.000000",
    text: "路上车不多",
    speaker: null,
    sourceType: "wechat",
  };
  wechatNull.fingerprint = sourceFingerprint(wechatNull);

  const allSources = [...loaded, wechatNull];
  const dayMedia = {
    "2024-12-24": {
      firstScreenMediaIds: ["media-quark-sha-photo1"],
      expandedMediaIds: ["media-quark-sha-photo1"],
      allApprovedMediaIds: ["media-quark-sha-photo1"],
      mediaHoursById: { "media-quark-sha-photo1": 17 },
    },
  };

  const result = buildCandidate({
    month: "2024-12",
    original: null,
    decisions: [
      {
        day: "2024-12-24",
        decision: "write",
        kind: "story",
        title: "圣莫尼卡海边的傍晚",
        paragraphs: [
          {
            text: "傍晚潮水刚退到木栈道下面，妈妈和爸爸站在栏杆边看太阳一点点落下去。",
            sourceIds: ["source-quark-sha-photo1"],
            mediaIds: ["media-quark-sha-photo1"],
          },
          {
            text: "晚上回到住处附近，路上已经安静下来。",
            sourceIds: ["source-wechat-unreg"],
          },
        ],
        photoCaptions: { "media-quark-sha-photo1": "木栈道尽头的晚霞" },
      },
    ],
    sources: allSources,
    currentSources: allSources,
    realNames: [],
    now: NOW,
    literary: true,
    dayMedia,
  });

  assert.equal(result.review.wrote.length, 1);
  assert.equal("source-quark-sha-photo1" in result.content.speakerBySourceId, false, "family_photo null speaker must NOT become 未登记的人");
  assert.equal(result.content.speakerBySourceId["source-wechat-unreg"], "未登记的人", "WeChat unregistered speaker keeps placeholder");
});

test("session-photo-review date window validation guards --since/--from/--until cleanly", () => {
  assert.equal(isValidDay("2024-12-24"), true);
  assert.equal(isValidDay("2024-02-30"), false);
  assert.doesNotThrow(() => assertValidDateWindow("2024-06-01", "2025-01-01"));
  assert.throws(() => assertValidDateWindow("2025-01-01", "2024-12-31"), /must be strictly earlier/);
  assert.throws(() => assertValidDateWindow("bad-date", "2025-01-01"), /Invalid/);
});

test("codex-editor resolvePrepareWindow bypasses 366-day ceiling when --from is passed and shouldIncludeDay admits photo-only days", () => {
  const custom = resolvePrepareWindow({ today: "2026-11-15", from: "2024-06-01", until: "2025-01-01" });
  assert.equal(custom.windowFrom, "2024-06-01");
  assert.equal(custom.effectiveUntil, "2025-01-01");
  assert.equal(custom.readyThrough, "2024-12-31");

  const longWindow = resolvePrepareWindow({ today: "2026-11-15", from: "2024-06-01" });
  assert.equal(longWindow.windowFrom, "2024-06-01");
  assert.ok(longWindow.span > 366);

  const clamped = resolvePrepareWindow({ today: "2026-11-15", lookbackDays: 999 });
  assert.equal(clamped.span, 366);

  assert.equal(
    shouldIncludeDay("2024-12-24", {
      allSources: [],
      rdsDayMedia: { "2024-12-24": { firstScreenMediaIds: ["media-1"] } },
      covered: new Set(),
      rewriteSet: new Set(),
    }),
    true,
  );
  assert.equal(
    shouldIncludeDay("2024-12-24", {
      allSources: [{ day: "2024-12-24", text: "[图片]" }],
      rdsDayMedia: {},
      covered: new Set(),
      rewriteSet: new Set(),
    }),
    false,
  );
});

test("quark-daily-sync ensureOssEnv strips R2 variables and enforces MEDIA_STORAGE_PROVIDER=oss", () => {
  const saved = { ...process.env };
  try {
    process.env.R2_BUCKET = "legacy-r2";
    process.env.R2_ACCESS_KEY_ID = "legacy-key";
    process.env.MEDIA_STORAGE_PROVIDER = "r2";
    ensureOssEnv();
    assert.equal(process.env.R2_BUCKET, undefined);
    assert.equal(process.env.R2_ACCESS_KEY_ID, undefined);
    assert.equal(process.env.MEDIA_STORAGE_PROVIDER, "oss");
  } finally {
    for (const k of Object.keys(process.env)) {
      if (!(k in saved)) delete process.env[k];
    }
    Object.assign(process.env, saved);
  }
});

test("quark-daily-sync skips IMG_NNNN + l_shot_at RDS duplicates pre-download without downloading", async () => {
  const existingRdsRows = [
    {
      id: "media-quark-sha-existing",
      original_filename: "IMG_5861-b8055af8f6e3.jpg",
      object_key: null,
      original_key: "media/originals/asset-quark-sha-existing.jpg",
      asset_checksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      taken_at_str: "2024-12-24 17:18:55",
    },
  ];
  const index = buildExistingMediaIndex(existingRdsRows);
  const validShotMs = Date.parse("2024-12-24T17:18:57+08:00");

  const hit = matchPreDownloadExistingStemTime(
    { fid: "fid-1", filename: "IMG_5861.HEIC", l_shot_at: validShotMs },
    index,
  );
  assert.equal(hit?.status, "skipped");
  assert.equal(hit?.category, "existing_stem_time");
  assert.equal(hit?.preDownload, true);
  assert.equal(hit?.matchedMediaId, "media-quark-sha-existing");
  assert.equal(hit?.diffSeconds, 2);

  assert.equal(
    matchPreDownloadExistingStemTime(
      { fid: "fid-1", filename: "IMG_5861.HEIC", l_shot_at: validShotMs },
      index,
      { forceDownload: true },
    ),
    null,
  );
  assert.equal(isValidShotMs(Date.parse("2014-12-31T23:59:59Z")), false);
  assert.equal(isValidShotMs(Date.now() + 2 * 24 * 3600 * 1000), false);
  assert.equal(
    matchPreDownloadExistingStemTime(
      { fid: "fid-2", filename: "IMG_5861.HEIC", l_shot_at: Date.parse("2014-12-31T00:00:00Z") },
      index,
    ),
    null,
  );
  assert.equal(
    matchPreDownloadExistingStemTime(
      { fid: "fid-3", filename: "IMG_5861.HEIC", l_shot_at: Date.parse("2024-12-24T17:19:02+08:00") },
      index,
    ),
    null,
  );

  // Verify runQuarkDailySync loop short-circuits BEFORE disk check / downloadQuarkItem
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "quark-predownload-skip-"));
  const saved = { ...process.env };
  try {
    process.env.MEDIA_STORAGE_PROVIDER = "oss";
    process.env.OSS_ENDPOINT = "oss-cn-hangzhou.aliyuncs.com";
    process.env.OSS_REGION = "oss-cn-hangzhou";
    process.env.OSS_ACCESS_KEY_ID = "test-placeholder-id";
    process.env.OSS_ACCESS_KEY_SECRET = "test-placeholder-secret";
    process.env.OSS_BUCKET = "test-placeholder-bucket";

    const manifestsDir = path.join(tmpOut, "manifests");
    fs.mkdirSync(manifestsDir, { recursive: true });
    fs.writeFileSync(
      path.join(manifestsDir, "discovered-candidates.json"),
      JSON.stringify({
        foldersScanned: 1,
        totalDiscoveredImages: 1,
        dedupedImages: 1,
        candidates: [
          {
            fid: "fid-nonexistent-on-disk",
            filename: "IMG_5861.HEIC",
            size: 123456,
            l_shot_at: validShotMs,
          },
        ],
      }),
      "utf8",
    );

    const summary = await runQuarkDailySync({
      outDir: tmpOut,
      sinceDay: "2024-12-01",
      untilDay: "2024-12-31",
      apply: false,
      cleanup: false,
      skipDiscover: true,
      skipDownload: false,
      forceDownload: false,
      existingRdsRows,
    });

    assert.equal(summary.staging.downloadFailureCount, 0);
    assert.equal(summary.staging.skippedExistingStemTimeCount, 1);
    assert.equal(summary.staging.plainCount, 0);
    assert.equal(summary.staging.convertedHeicCount, 0);

    const jsonlLine = fs
      .readFileSync(path.join(manifestsDir, "skipped-existing-stem-time.jsonl"), "utf8")
      .trim();
    const record = JSON.parse(jsonlLine);
    assert.equal(record.preDownload, true);
    assert.equal(record.matchedMediaId, "media-quark-sha-existing");
    assert.equal(record.fid, "fid-nonexistent-on-disk");
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
    for (const k of Object.keys(process.env)) {
      if (!(k in saved)) delete process.env[k];
    }
    Object.assign(process.env, saved);
  }
});

test("codex-editor preserves multi-day shared family_photo raw_sources per day while rejecting same-day duplicates", async () => {
  const seenSql = [];
  const mockClient = {
    query: async (sql) => {
      seenSql.push(sql);
      if (sql.includes("source_type='wechat'")) return { rows: [] };
      return {
        rows: [
          {
            id: "source-shared-album",
            day: "2024-12-20",
            time: "10:15:00.000000",
            text: "",
            source_label: "Quark 历史素材",
            original_filename: "IMG_1001.jpg",
            media_ids: ["media-day-20"],
          },
          {
            id: "source-shared-album",
            day: "2024-12-20",
            time: "10:15:00.000000",
            text: "",
            source_label: "Quark 历史素材",
            original_filename: "IMG_1001.jpg",
            media_ids: ["media-day-20"],
          },
          {
            id: "source-shared-album",
            day: "2024-12-21",
            time: "16:40:00.000000",
            text: "",
            source_label: "Quark 历史素材",
            original_filename: "IMG_1002.jpg",
            media_ids: ["media-day-21"],
          },
        ],
      };
    },
  };

  const loaded = await loadSources(mockClient, "2024-12-19", "2024-12-22");
  assert.match(seenSql[1], /group by rs\.id, to_char\(m\.taken_at, 'YYYY-MM-DD'\), rs\.text, rs\.source_label, rs\.original_filename/i);
  assert.deepEqual(
    loaded.map((s) => [s.id, s.day]),
    [
      ["source-shared-album", "2024-12-20"],
      ["source-shared-album", "2024-12-21"],
    ],
  );

  const dayMedia = {
    "2024-12-20": {
      firstScreenMediaIds: ["media-day-20"],
      expandedMediaIds: ["media-day-20"],
      allApprovedMediaIds: ["media-day-20"],
      mediaHoursById: { "media-day-20": 10 },
    },
    "2024-12-21": {
      firstScreenMediaIds: ["media-day-21"],
      expandedMediaIds: ["media-day-21"],
      allApprovedMediaIds: ["media-day-21"],
      mediaHoursById: { "media-day-21": 16 },
    },
  };

  const built = buildCandidate({
    month: "2024-12",
    original: null,
    decisions: [
      {
        day: "2024-12-20",
        decision: "write",
        kind: "story",
        title: "上午出门买日用品",
        paragraphs: [
          {
            text: "上午阳光从路口斜照过来，妈妈和爸爸推着小车慢慢走过转角。",
            sourceIds: ["source-shared-album"],
            mediaIds: ["media-day-20"],
          },
        ],
        photoCaptions: { "media-day-20": "上午转角的阳光" },
      },
      {
        day: "2024-12-21",
        decision: "write",
        kind: "story",
        title: "下午在院子里晒太阳",
        paragraphs: [
          {
            text: "下午院子里的树影拉长，妈妈和爸爸搬了两把椅子坐着吹风。",
            sourceIds: ["source-shared-album"],
            mediaIds: ["media-day-21"],
          },
        ],
        photoCaptions: { "media-day-21": "下午院子里的树影" },
      },
    ],
    sources: loaded,
    currentSources: loaded,
    realNames: [],
    now: NOW,
    literary: true,
    dayMedia,
  });

  assert.equal(built.review.wrote.length, 2);

  // Same-day duplicate family_photo sources must still be rejected by checkedSources
  const sameDayDup = [loaded[0], loaded[0]];
  assert.throws(
    () =>
      buildCandidate({
        month: "2024-12",
        original: null,
        decisions: [],
        sources: sameDayDup,
        currentSources: sameDayDup,
        realNames: [],
        now: NOW,
      }),
    /Invalid or duplicate source evidence/,
  );
});

test("quark-daily-sync parseQuarkCliArgs validates --concurrency and --downloads-dir", () => {
  const outsideOut = path.join(os.tmpdir(), "quark-cli-out");
  const outsideDl = path.join(os.tmpdir(), "quark-cli-downloads");

  const def = parseQuarkCliArgs(["--out", outsideOut, "--since", "2024-12-01", "--until", "2024-12-31"]);
  assert.equal(def.concurrency, 1);
  assert.equal(def.downloadsDir, null);

  const custom = parseQuarkCliArgs([
    "--out", outsideOut,
    "--since", "2024-12-01",
    "--until", "2024-12-31",
    "--concurrency", "6",
    "--downloads-dir", outsideDl,
  ]);
  assert.equal(custom.concurrency, 6);
  assert.equal(custom.downloadsDir, path.resolve(outsideDl));

  const eq = parseQuarkCliArgs([
    "--out", outsideOut,
    "--since", "2024-12-01",
    "--until", "2024-12-31",
    "--concurrency=12",
  ]);
  assert.equal(eq.concurrency, 12);

  for (const bad of ["0", "13", "-1", "1.5", "abc"]) {
    assert.throws(
      () => parseQuarkCliArgs(["--out", outsideOut, "--concurrency", bad]),
      /Invalid --concurrency value/,
    );
  }

  const insideRepo = path.resolve(import.meta.dirname, "..", "tmp-bad-downloads");
  assert.throws(
    () => parseQuarkCliArgs(["--out", outsideOut, "--downloads-dir", insideRepo]),
    /--downloads-dir .* must be outside the repository/,
  );
});

test("quark-daily-sync bounded concurrency pool dedupes race checksums, keeps order, and preserves shared --downloads-dir on cleanup", async () => {
  // 1. Direct bounded worker pool check: maxActive <= 3 across 8 items
  let active = 0;
  let maxActive = 0;
  const poolOut = await mapWithConcurrency(
    Array.from({ length: 8 }, (_, i) => i),
    3,
    async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, (8 - item) * 4));
      active -= 1;
      return item * 10;
    },
  );
  assert.equal(maxActive <= 3 && maxActive >= 2, true, `expected bounded active workers in [2..3], got ${maxActive}`);
  assert.deepEqual(poolOut, [0, 10, 20, 30, 40, 50, 60, 70]);

  // 2. End-to-end concurrent staging: race-safe seenSha256 + per-item sessionId + shared --downloads-dir preserved on cleanup
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "quark-concurrent-sync-"));
  const outDir = path.join(tmpBase, "run-out");
  const sharedDownloadsDir = path.join(tmpBase, "shared-downloads");
  const browseDir = path.join(outDir, "quark-browse");
  const convertedDir = path.join(outDir, "heic-converted");
  const manifestsDir = path.join(outDir, "manifests");
  const saved = { ...process.env };

  try {
    process.env.MEDIA_STORAGE_PROVIDER = "oss";
    process.env.OSS_ENDPOINT = "oss-cn-hangzhou.aliyuncs.com";
    process.env.OSS_REGION = "oss-cn-hangzhou";
    process.env.OSS_ACCESS_KEY_ID = "test-placeholder-id";
    process.env.OSS_ACCESS_KEY_SECRET = "test-placeholder-secret";
    process.env.OSS_BUCKET = "test-placeholder-bucket";

    fs.mkdirSync(manifestsDir, { recursive: true });
    fs.mkdirSync(browseDir, { recursive: true });
    fs.mkdirSync(convertedDir, { recursive: true });
    fs.mkdirSync(sharedDownloadsDir, { recursive: true });
    fs.writeFileSync(path.join(browseDir, "stale.jsonl"), "{}\n", "utf8");
    fs.writeFileSync(path.join(convertedDir, "stale.jpg"), "stale", "utf8");

    const imgBufA = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 20, g: 120, b: 220 } } })
      .jpeg()
      .toBuffer();
    const imgBufB = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 220, g: 120, b: 20 } } })
      .jpeg()
      .toBuffer();

    const bytesByFid = new Map([
      ["fid-a", imgBufA],
      ["fid-a-dup", imgBufA], // identical bytes to fid-a, arriving concurrently
      ["fid-b", imgBufB],
    ]);
    const delayByFid = new Map([
      ["fid-a", 35],
      ["fid-a-dup", 15],
      ["fid-b", 5],
    ]);

    // Simultaneous stageDownloadedItem race check: exactly 1 of 2 identical-byte calls succeeds
    const raceSeen = new Set();
    const raceSubA = path.join(tmpBase, "race-a.jpg");
    const raceSubB = path.join(tmpBase, "race-b.jpg");
    fs.writeFileSync(raceSubA, imgBufA);
    fs.writeFileSync(raceSubB, imgBufA);
    const raceResults = await Promise.all([
      stageDownloadedItem({
        item: { fid: "race-1", filename: "IMG_8881.jpg", l_shot_at: Date.parse("2024-12-24T17:18:55+08:00"), shoot_device: "iPhone 15 Pro" },
        localPath: raceSubA,
        convertedDir,
        seenSha256: raceSeen,
        sinceDay: "2024-12-01",
        untilDay: "2024-12-31",
      }),
      stageDownloadedItem({
        item: { fid: "race-2", filename: "IMG_8882.jpg", l_shot_at: Date.parse("2024-12-24T17:19:10+08:00"), shoot_device: "iPhone 15 Pro" },
        localPath: raceSubB,
        convertedDir,
        seenSha256: raceSeen,
        sinceDay: "2024-12-01",
        untilDay: "2024-12-31",
      }),
    ]);
    assert.equal(raceResults.filter((r) => r.status === "ready").length, 1);
    assert.equal(raceResults.filter((r) => r.reason === "batch_checksum_duplicate").length, 1);

    fs.writeFileSync(
      path.join(manifestsDir, "discovered-candidates.json"),
      JSON.stringify({
        foldersScanned: 1,
        totalDiscoveredImages: 3,
        dedupedImages: 3,
        candidates: [
          { fid: "fid-a", filename: "IMG_9001.jpg", size: imgBufA.byteLength, l_shot_at: Date.parse("2024-12-24T17:18:55+08:00"), shoot_device: "iPhone 15 Pro" },
          { fid: "fid-a-dup", filename: "IMG_9002.jpg", size: imgBufA.byteLength, l_shot_at: Date.parse("2024-12-24T17:19:10+08:00"), shoot_device: "iPhone 15 Pro" },
          { fid: "fid-b", filename: "IMG_9003.jpg", size: imgBufB.byteLength, l_shot_at: Date.parse("2024-12-24T17:19:30+08:00"), shoot_device: "iPhone 15 Pro" },
        ],
      }),
      "utf8",
    );

    const seenSessionIds = [];
    let inflight = 0;
    let peakInflight = 0;

    const summary = await runQuarkDailySync({
      outDir,
      downloadsDir: sharedDownloadsDir,
      sinceDay: "2024-12-01",
      untilDay: "2024-12-31",
      concurrency: 3,
      sessionId: "sess-test",
      apply: false,
      cleanup: true,
      skipDiscover: true,
      existingRdsRows: [],
      applyDeps: {
        repo: {
          async findMediaAssetByChecksum() { return null; },
        },
        hotStorage: {
          async put(input) { return { providerRef: input.key }; },
        },
      },
      downloadItem: async (item, dlDir, ctx) => {
        inflight += 1;
        peakInflight = Math.max(peakInflight, inflight);
        seenSessionIds.push(ctx.sessionId);
        await new Promise((r) => setTimeout(r, delayByFid.get(item.fid) ?? 5));
        const sub = path.join(dlDir, item.fid);
        fs.mkdirSync(sub, { recursive: true });
        const dest = path.join(sub, item.filename);
        fs.writeFileSync(dest, bytesByFid.get(item.fid));
        inflight -= 1;
        return dest;
      },
    });

    assert.equal(summary.concurrency, 3);
    assert.equal(summary.sharedDownloadsDir, true);
    assert.equal(peakInflight <= 3 && peakInflight >= 2, true, `expected peak concurrency >=2 and <=3, got ${peakInflight}`);
    assert.deepEqual(seenSessionIds.sort(), ["sess-test-0", "sess-test-1", "sess-test-2"]);

    // Exactly 1 of the two identical-byte items is staged; the duplicate is rejected as batch_checksum_duplicate
    assert.equal(summary.staging.plainCount, 2);
    assert.equal(summary.staging.skippedOtherCount, 1);
    assert.equal(summary.applySummary.newCount, 2);
    const eligibleRows = fs
      .readFileSync(path.join(manifestsDir, "eligible-items.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    // Even though fid-b (5ms, index 2) finished before fid-a-dup (15ms, index 1), slot order stays deterministic
    assert.deepEqual(eligibleRows.map((r) => r.filename), ["IMG_9002.jpg", "IMG_9003.jpg"]);
    const otherRow = JSON.parse(fs.readFileSync(path.join(manifestsDir, "skipped-other.jsonl"), "utf8").trim());
    assert.equal(otherRow.reason, "batch_checksum_duplicate");

    // Cleanup removes browseDir and convertedDir, while leaving sharedDownloadsDir and its downloaded files intact
    assert.equal(fs.existsSync(browseDir), false);
    assert.equal(fs.existsSync(convertedDir), false);
    assert.equal(fs.existsSync(sharedDownloadsDir), true);
    assert.equal(fs.existsSync(path.join(sharedDownloadsDir, "fid-b", "IMG_9003.jpg")), true);

    // QuarkAuthError aborts concurrent worker pool cleanly
    await assert.rejects(
      () =>
        mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
          if (n === 2) throw new QuarkAuthError(-1408, "expired");
          await new Promise((r) => setTimeout(r, 10));
          return n;
        }),
      QuarkAuthError,
    );
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
    for (const k of Object.keys(process.env)) {
      if (!(k in saved)) delete process.env[k];
    }
    Object.assign(process.env, saved);
  }
});



