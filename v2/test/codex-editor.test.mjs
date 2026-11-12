import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildCandidate, sourceFingerprint, readProductionSnapshot } from "../scripts/editor/codex-editor.mjs";

const now = "2026-10-12T03:00:00.000Z";
const source = (patch = {}) => {
  const value = { id: "source-10", day: "2026-10-10", time: "10:15:00.000000", text: "妈妈带宝宝去了公园。", speaker: "妈妈", ...patch };
  return { ...value, fingerprint: sourceFingerprint(value) };
};
const write = (patch = {}) => ({ day: "2026-10-10", decision: "write", title: "公园里的一天", paragraphs: [{ text: "妈妈带宝宝去了公园。", sourceIds: ["source-10"] }], ...patch });
const oldDay = { day: "2026-10-09", kind: "story", title: "原有记录", paragraphs: ["留着原来的每一句话。"], firstScreenMediaIds: ["photo-9"], expandedMediaIds: ["photo-9"], sourceIds: ["source-9"], _source: "machine", _evidence: { note: "old evidence" } };
const original = () => ({ schema: "nianlife.month-content/1", month: "2026-10", cardLine: "原来的月卡片", speakerBySourceId: { "source-9": "爸爸" }, days: [structuredClone(oldDay)] });
const candidate = (patch = {}) => {
  const sources = [source()];
  return buildCandidate({ month: "2026-10", original: original(), decisions: [write()], sources, currentSources: sources, realNames: [], now, ...patch });
};

test("append preserves every existing day and month framing while adding cited Codex content", () => {
  const before = original();
  const serialized = JSON.stringify(before);
  const result = candidate({ original: before });
  assert.equal(JSON.stringify(result.content.days[0]), JSON.stringify(oldDay));
  assert.equal(JSON.stringify(before), serialized, "builder must not mutate its input");
  assert.equal(result.content.cardLine, before.cardLine);
  assert.equal(result.content.speakerBySourceId["source-9"], "爸爸");
  assert.equal(result.content.speakerBySourceId["source-10"], "妈妈");
  assert.equal(result.content.days[1]._source, "codex");
  assert.deepEqual(result.content.days[1].sourceIds, ["source-10"]);
  assert.equal(result.content.days[1]._evidence.paragraphSources[0].sources[0].fingerprint, source().fingerprint);
  assert.equal(result.review.published, false);
  assert.equal(result.review.protectedDays.length, 1);
});

test("unknown source IDs and cross-day citations are rejected", () => {
  assert.throws(() => candidate({ decisions: [write({ paragraphs: [{ text: "妈妈带宝宝去了公园。", sourceIds: ["unknown"] }] })] }), { code: "UNKNOWN_SOURCE" });
  const sources = [source(), source({ id: "source-11", day: "2026-10-11" })];
  assert.throws(() => candidate({ sources, currentSources: sources, decisions: [write({ paragraphs: [{ text: "妈妈带宝宝去了公园。", sourceIds: ["source-11"] }] })] }), { code: "UNKNOWN_SOURCE" });
});

test("a media placeholder proves sharing only, alongside a separately cited family reply", () => {
  const sources = [source({ id: "shared-video", time: "20:35:00", text: "[视频]", speaker: "爸爸" }),
    source({ id: "family-reply", time: "20:38:00", text: "太好了，开始学习了。", speaker: "奶奶" })];
  const result = candidate({ sources, currentSources: sources, decisions: [write({ title: "家人群里的一段视频",
    paragraphs: [{ text: "晚上，爸爸在家人群里分享了一段视频，奶奶回复说：「太好了，开始学习了。」", sourceIds: ["shared-video", "family-reply"] }] })] });
  assert.deepEqual(result.content.days[1].sourceIds, ["shared-video", "family-reply"]);
});

test("already published machine and human records are both immutable", () => {
  for (const origin of ["machine", "human", undefined, "codex"]) {
    const existing = original();
    existing.days[0]._source = origin;
    assert.throws(() => candidate({ original: existing, decisions: [write({ day: "2026-10-09" })] }), { code: "EXISTING_DAY" });
  }
});

test("evidence changes, deletions and newly arrived messages invalidate the prepared draft", () => {
  for (const currentSources of [[source({ text: "妈妈带宝宝去了图书馆。" })], [], [source(), source({ id: "new-message" })], [source({ speaker: "爸爸" })]]) {
    assert.throws(() => candidate({ currentSources }), { code: "SOURCE_CHANGED" });
  }
  const changedPack = source();
  changedPack.text = "悄悄改过的原文。";
  assert.throws(() => candidate({ sources: [changedPack] }), { code: "SOURCE_PACK_CHANGED" });
});

test("sensitive text, incorrect quote attribution, time words and private names cannot reach a candidate", () => {
  const cases = [
    { src: source({ text: "这次花了500元。" }), text: "妈妈说「这次花了500元」。" },
    { src: source({ text: "去公园啦" }), text: "爸爸说「去公园啦」。" },
    { src: source(), text: "晚上妈妈带宝宝去了公园。" },
    { src: source({ text: "真实姓名带宝宝去了公园。" }), text: "真实姓名带宝宝去了公园。", realNames: ["真实姓名"] },
  ];
  for (const value of cases) {
    assert.throws(() => candidate({ sources: [value.src], currentSources: [value.src], realNames: value.realNames ?? [], decisions: [write({ paragraphs: [{ text: value.text, sourceIds: ["source-10"] }] })] }), { code: "TEXT_VALIDATION_FAILED" });
  }
});

test("a skip records its private reason and leaves production content unchanged", () => {
  const existing = original();
  const result = candidate({ original: existing, decisions: [{ day: "2026-10-10", decision: "skip", reason: "没有适合写进家庭记录的独立情节" }] });
  assert.equal(result.content, existing);
  assert.equal(result.review.wrote.length, 0);
  assert.equal(result.review.skipped.length, 1);
  assert.throws(() => candidate({ decisions: [{ day: "2026-10-10", decision: "skip" }] }), { code: "INVALID_DECISIONS" });
});

test("a proved absent month can receive its first day; invalid production schema is refused", () => {
  const result = candidate({ original: null });
  assert.equal(result.content.days.length, 1);
  assert.equal(result.content.schema, "nianlife.month-content/1");
  assert.throws(() => candidate({ original: { ...original(), coverFocal: { mobilePercent: 900, desktopPercent: 50 } } }), { code: "INVALID_PRODUCTION" });
});

test("duplicate decisions and wrong-month dates are rejected", () => {
  assert.throws(() => candidate({ decisions: [write(), write()] }), { code: "INVALID_DECISIONS" });
  assert.throws(() => candidate({ decisions: [write({ day: "2026-09-30" })] }), { code: "INVALID_DECISIONS" });
});

function snapshotFixture(t) {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "nianlife-codex-editor-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from(`${JSON.stringify(original(), null, 3)}\n`);
  const hash = createHash("sha256").update(bytes).digest("hex");
  return { file: path.join(directory, "2026-10.json"), bytes, hash, ecs: { ssh: "ops@fixture", key: "fixture-key.pem" } };
}

test("production presence is proved by remote SHA, exact transferred bytes and a second probe", (t) => {
  const fixture = snapshotFixture(t);
  const calls = [];
  const snapshot = readProductionSnapshot("2026-10", fixture.file, fixture.ecs, (command, args) => {
    calls.push(command);
    if (command === "ssh") return { status: 0, stdout: `PRESENT ${fixture.hash}  /srv/nianlife-content/2026-10.json\n` };
    assert.equal(command, "scp");
    fs.writeFileSync(args.at(-1), fixture.bytes);
    return { status: 0 };
  });
  assert.deepEqual(calls, ["ssh", "scp", "ssh"]);
  assert.equal(snapshot.revision, fixture.hash);
  assert.deepEqual(snapshot.content, original());
  assert.deepEqual(fs.readFileSync(fixture.file), fixture.bytes);
});

test("missing production is accepted only on explicit ABSENT evidence, never on SSH or SCP failure", (t) => {
  const fixture = snapshotFixture(t);
  const absent = readProductionSnapshot("2026-10", fixture.file, fixture.ecs, () => ({ status: 0, stdout: "ABSENT\n" }));
  assert.equal(absent.revision, "absent");
  assert.equal(absent.content, null);
  assert.throws(() => readProductionSnapshot("2026-10", fixture.file, fixture.ecs, () => ({ status: 255, stderr: "connection unavailable" })), { code: "PRODUCTION_READ_FAILED" });
  assert.throws(() => readProductionSnapshot("2026-10", fixture.file, fixture.ecs, (command) => command === "ssh"
    ? { status: 0, stdout: `PRESENT ${fixture.hash}  /srv/nianlife-content/2026-10.json\n` } : { status: 1 }), { code: "PRODUCTION_READ_FAILED" });
});

test("a production change during transfer is refused", (t) => {
  const fixture = snapshotFixture(t);
  let probes = 0;
  assert.throws(() => readProductionSnapshot("2026-10", fixture.file, fixture.ecs, (command, args) => {
    if (command === "scp") { fs.writeFileSync(args.at(-1), fixture.bytes); return { status: 0 }; }
    probes += 1;
    return { status: 0, stdout: `PRESENT ${probes === 1 ? fixture.hash : "f".repeat(64)}  /srv/nianlife-content/2026-10.json\n` };
  }), { code: "PRODUCTION_CHANGED" });
});

test("explicit allowRewriteDays archives prior version in _revisions, preserves media, and protects human days", () => {
  const src9 = source({ id: "source-9", day: "2026-10-09", text: "小年把积木一块一块摆齐了。", speaker: "爸爸" });
  const priorDoc = original();
  priorDoc.days[0].paragraphMedia = [["photo-9"]];
  priorDoc.days[0].photoCaptions = { "photo-9": "旧版积木图注" };
  priorDoc.days[0].featuredQuote = { text: "旧版原话", speaker: "爸爸", sourceId: "source-9" };

  const rebuilt = buildCandidate({
    month: "2026-10",
    original: priorDoc,
    decisions: [{
      day: "2026-10-09",
      decision: "write",
      title: "把积木摆齐",
      paragraphs: [{ text: "爸爸说「小年把积木一块一块摆齐了」。", sourceIds: ["source-9"], mediaIds: ["photo-9"] }],
      photoCaptions: { "photo-9": "蹲在地垫上把木块排成一列" },
      featuredQuote: { text: "小年把积木一块一块摆齐了", speaker: "爸爸", sourceId: "source-9" },
    }],
    sources: [src9],
    currentSources: [src9],
    realNames: [],
    now,
    allowRewriteDays: ["2026-10-09"],
    literary: true,
  });
  const day9 = rebuilt.content.days.find((d) => d.day === "2026-10-09");
  assert.equal(day9.title, "把积木摆齐");
  assert.deepEqual(day9.firstScreenMediaIds, ["photo-9"], "curated media preserved across text rewrite");
  assert.deepEqual(day9.paragraphMedia, [["photo-9"]]);
  assert.deepEqual(day9.photoCaptions, { "photo-9": "蹲在地垫上把木块排成一列" });
  assert.deepEqual(day9.featuredQuote, { text: "小年把积木一块一块摆齐了", speaker: "爸爸", sourceId: "source-9" });
  assert.equal(day9._revisions.length, 1, "prior published version archived in _revisions");
  assert.equal(day9._revisions[0].title, "原有记录");
  assert.deepEqual(day9._revisions[0].paragraphs, ["留着原来的每一句话。"]);
  assert.deepEqual(day9._revisions[0].paragraphMedia, [["photo-9"]], "_revisions preserves prior paragraphMedia");
  assert.deepEqual(day9._revisions[0].photoCaptions, { "photo-9": "旧版积木图注" }, "_revisions preserves prior photoCaptions");
  assert.deepEqual(day9._revisions[0].featuredQuote, { text: "旧版原话", speaker: "爸爸", sourceId: "source-9" }, "_revisions preserves prior featuredQuote");

  const humanDoc = original();
  humanDoc.days[0]._source = "human";
  assert.throws(() => buildCandidate({
    month: "2026-10",
    original: humanDoc,
    decisions: [{
      day: "2026-10-09",
      decision: "write",
      title: "把积木摆齐",
      paragraphs: [{ text: "爸爸说「小年把积木一块一块摆齐了」。", sourceIds: ["source-9"], mediaIds: ["photo-9"] }],
      photoCaptions: { "photo-9": "蹲在地垫上把木块排成一列" },
    }],
    sources: [src9],
    currentSources: [src9],
    realNames: [],
    now,
    allowRewriteDays: ["2026-10-09"],
  }), { code: "HUMAN_DAY_PROTECTED" });
});

test("photo anchoring, photoCaptions, featuredQuote, and homeHeroMediaId enforce hard gates", () => {
  const s1 = source({ id: "s-1", day: "2026-10-10", time: "15:10:00", text: "今天去游泳池玩水了，凉快。", speaker: "外公" });
  const s2 = source({ id: "s-2", day: "2026-10-10", time: "15:40:00", text: "小年年下水玩必须点赞", speaker: "爷爷" });
  const s3 = source({ id: "s-3", day: "2026-10-10", time: "16:05:00", text: "宝宝第一次这么喜欢水", speaker: "奶奶" });
  const sources = [s1, s2, s3];
  const dayMedia = {
    "2026-10-10": {
      firstScreenMediaIds: ["pic-a", "pic-b"],
      expandedMediaIds: ["pic-a", "pic-b", "pic-c"],
      allApprovedMediaIds: ["pic-a", "pic-b", "pic-c"],
    },
  };

  // 1) Missing mediaIds when firstScreenMediaIds is non-empty -> PHOTO_ANCHOR_REQUIRED
  assert.throws(() => buildCandidate({
    month: "2026-10",
    original: original(),
    sources,
    currentSources: sources,
    dayMedia,
    now,
    literary: true,
    decisions: [{
      day: "2026-10-10",
      decision: "write",
      title: "水总是从杯底漏走",
      paragraphs: [{ text: "下午小年站在浅水池里舀水玩。", sourceIds: ["s-1"] }],
      photoCaptions: { "pic-a": "水从杯底漏光了", "pic-b": "伸手够池边的套杯" },
    }],
  }), { code: "PHOTO_ANCHOR_REQUIRED" });

  // 2) Missing photoCaptions for any firstScreenMediaIds item -> PHOTO_CAPTION_REQUIRED
  assert.throws(() => buildCandidate({
    month: "2026-10",
    original: original(),
    sources,
    currentSources: sources,
    dayMedia,
    now,
    literary: true,
    decisions: [{
      day: "2026-10-10",
      decision: "write",
      title: "水总是从杯底漏走",
      paragraphs: [{ text: "下午小年站在浅水池里舀水玩。", sourceIds: ["s-1"], mediaIds: ["pic-a"] }],
      photoCaptions: { "pic-a": "水从杯底漏光了" },
    }],
  }), { code: "PHOTO_CAPTION_REQUIRED" });

  // 3) Unknown mediaId or duplicate anchor across paragraphs -> UNKNOWN_MEDIA / DUPLICATE_MEDIA_ANCHOR
  assert.throws(() => buildCandidate({
    month: "2026-10",
    original: original(),
    sources,
    currentSources: sources,
    dayMedia,
    now,
    literary: true,
    decisions: [{
      day: "2026-10-10",
      decision: "write",
      title: "水总是从杯底漏走",
      paragraphs: [{ text: "下午小年站在浅水池里舀水玩。", sourceIds: ["s-1"], mediaIds: ["unapproved-pic"] }],
      photoCaptions: { "pic-a": "水从杯底漏光了", "pic-b": "伸手够池边的套杯" },
    }],
  }), { code: "UNKNOWN_MEDIA" });

  assert.throws(() => buildCandidate({
    month: "2026-10",
    original: original(),
    sources,
    currentSources: sources,
    dayMedia,
    now,
    literary: true,
    decisions: [{
      day: "2026-10-10",
      decision: "write",
      title: "水总是从杯底漏走",
      paragraphs: [
        { text: "下午小年站在浅水池里舀水玩。", sourceIds: ["s-1"], mediaIds: ["pic-a"] },
        { text: "奶奶说「宝宝第一次这么喜欢水」。", sourceIds: ["s-3"], mediaIds: ["pic-a"] },
      ],
      photoCaptions: { "pic-a": "水从杯底漏光了", "pic-b": "伸手够池边的套杯" },
    }],
  }), { code: "DUPLICATE_MEDIA_ANCHOR" });

  // 4) Caption > 20 chars -> INVALID_PHOTO_CAPTION; caption with photo-speak or real name -> TEXT_VALIDATION_FAILED
  assert.throws(() => buildCandidate({
    month: "2026-10",
    original: original(),
    sources,
    currentSources: sources,
    dayMedia,
    now,
    literary: true,
    decisions: [{
      day: "2026-10-10",
      decision: "write",
      title: "水总是从杯底漏走",
      paragraphs: [{ text: "下午小年站在浅水池里舀水玩。", sourceIds: ["s-1"], mediaIds: ["pic-a"] }],
      photoCaptions: {
        "pic-a": "这是一条超过二十个汉字长度上限的照片图注内容呀",
        "pic-b": "伸手够池边的套杯",
      },
    }],
  }), { code: "INVALID_PHOTO_CAPTION" });

  assert.throws(() => buildCandidate({
    month: "2026-10",
    original: original(),
    sources,
    currentSources: sources,
    dayMedia,
    now,
    literary: true,
    decisions: [{
      day: "2026-10-10",
      decision: "write",
      title: "水总是从杯底漏走",
      paragraphs: [{ text: "下午小年站在浅水池里舀水玩。", sourceIds: ["s-1"], mediaIds: ["pic-a"] }],
      photoCaptions: {
        "pic-a": "照片里捧着漏水黄杯子",
        "pic-b": "伸手够池边的套杯",
      },
    }],
  }), { code: "TEXT_VALIDATION_FAILED" });

  // 5) featuredQuote fabricated or wrong speaker -> TEXT_VALIDATION_FAILED
  assert.throws(() => buildCandidate({
    month: "2026-10",
    original: original(),
    sources,
    currentSources: sources,
    dayMedia,
    now,
    literary: true,
    decisions: [{
      day: "2026-10-10",
      decision: "write",
      title: "水总是从杯底漏走",
      paragraphs: [{ text: "下午小年站在浅水池里舀水玩。", sourceIds: ["s-1"], mediaIds: ["pic-a"] }],
      photoCaptions: { "pic-a": "水从杯底漏光了", "pic-b": "伸手够池边的套杯" },
      featuredQuote: { text: "宝宝第一次这么喜欢水", speaker: "外公" },
    }],
  }), { code: "TEXT_VALIDATION_FAILED" });

  // 6) Valid full payload builds candidate with paragraphMedia, photoCaptions, featuredQuote, and homeHeroMediaId
  const ok = buildCandidate({
    month: "2026-10",
    original: original(),
    sources,
    currentSources: sources,
    dayMedia,
    now,
    literary: true,
    monthMeta: { homeHeroMediaId: "pic-a" },
    decisions: [{
      day: "2026-10-10",
      decision: "write",
      emphasis: "lead",
      title: "水总是从杯底漏走",
      paragraphs: [
        { text: "下午浅水区的水刚到腿上，小年伸手够池边的彩色套杯。", sourceIds: ["s-1"], mediaIds: ["pic-a", "pic-b"] },
        { text: "奶奶说「宝宝第一次这么喜欢水」，爷爷的评语最短，「必须点赞」。", sourceIds: ["s-2", "s-3"], mediaIds: ["pic-c"] },
      ],
      photoCaptions: {
        "pic-a": "水从杯底漏光了",
        "pic-b": "伸手够池边的套杯",
        "pic-c": "水花扑脸，还在笑",
      },
      featuredQuote: { text: "宝宝第一次这么喜欢水", speaker: "奶奶" },
    }],
  });
  const builtDay = ok.content.days.find((d) => d.day === "2026-10-10");
  assert.deepEqual(builtDay.paragraphMedia, [["pic-a", "pic-b"], ["pic-c"]]);
  assert.deepEqual(builtDay.photoCaptions, {
    "pic-a": "水从杯底漏光了",
    "pic-b": "伸手够池边的套杯",
    "pic-c": "水花扑脸，还在笑",
  });
  assert.deepEqual(builtDay.featuredQuote, {
    text: "宝宝第一次这么喜欢水",
    speaker: "奶奶",
    sourceId: "s-3",
  });
  assert.equal(ok.content.homeHeroMediaId, "pic-a");
});

test("the CLI writes refusal details outside the repository while logging only a safe code", (t) => {
  const fixture = snapshotFixture(t);
  const directory = path.dirname(fixture.file);
  const script = fileURLToPath(new URL("../scripts/editor/codex-editor.mjs", import.meta.url));
  const run = spawnSync(process.execPath, ["--import", "tsx", script, "unknown-command", "--out", directory], {
    encoding: "utf8", cwd: fileURLToPath(new URL("../", import.meta.url)),
  });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /Codex editor refused: INVALID_COMMAND/);
  const receipts = fs.readdirSync(directory).filter((file) => /^review-failed-.*\.json$/.test(file));
  assert.equal(receipts.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, receipts[0]), "utf8")).code, "INVALID_COMMAND");
});
