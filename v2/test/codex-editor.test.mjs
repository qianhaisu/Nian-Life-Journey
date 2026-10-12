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
