// Prepare private evidence for Codex, then validate its file-backed editorial decisions.
// No provider/model calls, database writes, or production publishing are performed here.
// node --import tsx scripts/editor/codex-editor.mjs prepare --out <private-directory>
// node --import tsx scripts/editor/codex-editor.mjs apply --out <same-directory> --decisions <private-json>
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveEcsConnection } from "../lib/ecs-connection.mjs";
import { assertOutsideRepository } from "../lib/repo-containment.mjs";
import { validateMonthContent } from "../../lib/month-content.ts";
import { labelForSender } from "./identity-rules.mjs";
import { validateDayText } from "./validate-day.mjs";
import { addDays, shanghaiToday, isReadable, checkDecision, timeWordProblems, sensitiveHits } from "./plan.mjs";
import { appendDay } from "./append-day.mjs";

const PACK_SCHEMA = "nianlife.codex-editor.sources/1";
const RECEIPT_SCHEMA = "nianlife.codex-editor.review/1";
const MONTH_SCHEMA = "nianlife.month-content/1";
const REPO_LITERAL = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const REPO = { literal: REPO_LITERAL, real: fs.realpathSync.native(REPO_LITERAL) };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;

export class CodexEditorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CodexEditorError";
    this.code = code;
    this.details = details;
  }
}

function refuse(code, message, details) {
  throw new CodexEditorError(code, message, details);
}

function validDay(day) {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
    && !Number.isNaN(Date.parse(`${day}T00:00:00Z`))
    && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

/** Hash the actual source fields, including the untrimmed original text and resolved speaker. */
export function sourceFingerprint(source) {
  return sha256(JSON.stringify({ id: source.id, day: source.day, time: source.time, text: source.text, speaker: source.speaker ?? null }));
}

function checkedSources(sources) {
  if (!Array.isArray(sources)) refuse("INVALID_SOURCES", "Source evidence must be an array.");
  const ids = new Set();
  for (const source of sources) {
    if (!source || !nonempty(source.id) || !validDay(source.day) || !/^(?:[01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?$/.test(source.time)
      || typeof source.text !== "string" || !(source.speaker === null || nonempty(source.speaker)) || ids.has(source.id)) {
      refuse("INVALID_SOURCES", "Invalid or duplicate source evidence.");
    }
    ids.add(source.id);
    if (source.fingerprint !== sourceFingerprint(source)) refuse("SOURCE_PACK_CHANGED", "Prepared source evidence was modified.", { sourceId: source.id });
  }
  return sources;
}

function assertSourcesUnchanged(sources, currentSources) {
  checkedSources(sources);
  checkedSources(currentSources);
  const expected = sources.map((source) => `${source.id}:${source.fingerprint}`).sort();
  const actual = currentSources.map((source) => `${source.id}:${source.fingerprint}`).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    refuse("SOURCE_CHANGED", "Database evidence changed after preparation; prepare a fresh source pack.");
  }
}

/**
 * Pure candidate builder. Every existing day is immutable, regardless of its editor/source.
 * currentSources must come from a fresh read-only database query, not the prepared file.
 */
export function buildCandidate({ month, original = null, decisions, sources, currentSources, realNames = [], now }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) refuse("INVALID_MONTH", "Invalid month.");
  if (!nonempty(now) || Number.isNaN(Date.parse(now))) refuse("INVALID_TIME", "A valid review timestamp is required.");
  if (original !== null && !validateMonthContent(original, month)) refuse("INVALID_PRODUCTION", "Production snapshot failed month-content validation.");
  if (!Array.isArray(decisions)) refuse("INVALID_DECISIONS", "Decisions must be an array.");
  assertSourcesUnchanged(sources, currentSources);
  const lookup = new Map(sources.map((source) => [source.id, source]));
  const protectedDays = new Map((original?.days ?? []).map((day) => [day.day, JSON.stringify(day)]));
  let content = original === null ? { schema: MONTH_SCHEMA, month, speakerBySourceId: {}, days: [] } : structuredClone(original);
  const seen = new Set();
  const wrote = [];
  const skipped = [];

  for (const decision of decisions) {
    if (!decision || !validDay(decision.day) || !decision.day.startsWith(`${month}-`) || seen.has(decision.day)) {
      refuse("INVALID_DECISIONS", "Invalid, duplicate, or wrong-month decision date.");
    }
    seen.add(decision.day);
    if (protectedDays.has(decision.day)) refuse("EXISTING_DAY", "An already published day cannot be changed.", { day: decision.day });
    if (!sources.some((source) => source.day === decision.day)) refuse("UNPREPARED_DAY", "Decision date has no prepared source evidence.", { day: decision.day });
    if (decision.decision === "skip") {
      if (!nonempty(decision.reason)) refuse("INVALID_DECISIONS", "A skipped day requires a reason.", { day: decision.day });
      skipped.push({ day: decision.day, reason: decision.reason });
      continue;
    }

    const paragraphs = decision.paragraphs;
    if (!Array.isArray(paragraphs)) refuse("INVALID_DECISIONS", "A write decision requires cited paragraphs.", { day: decision.day });
    for (const paragraph of paragraphs) {
      if (!paragraph || !Array.isArray(paragraph.sourceIds) || paragraph.sourceIds.length === 0
        || paragraph.sourceIds.some((id) => !lookup.has(id) || lookup.get(id).day !== decision.day)) {
        refuse("UNKNOWN_SOURCE", "Each paragraph must cite prepared sources from its own day.", { day: decision.day });
      }
    }
    const shape = checkDecision({ ...decision, kind: decision.kind ?? "story", paragraphs: paragraphs.map((paragraph) => ({ text: paragraph.text, sources: paragraph.sourceIds })) }, new Set(lookup.keys()));
    if (!shape.ok) refuse("INVALID_DECISIONS", "Decision shape failed validation.", { day: decision.day, error: shape.error });

    const evidence = { quotes: [], persons: [], paragraphSources: [] };
    const errors = [];
    for (const [index, paragraph] of paragraphs.entries()) {
      const cited = paragraph.sourceIds.map((id) => lookup.get(id));
      const checked = validateDayText({ day: decision.day, title: null, paragraphs: [paragraph.text] }, cited, { realNames });
      errors.push(...checked.errors.map((error) => error.replace(/^第 1 段/, `第 ${index + 1} 段`)));
      const badTimes = timeWordProblems(paragraph.text, cited.map((source) => Number(source.time.slice(0, 2))));
      if (badTimes.length) errors.push(`第 ${index + 1} 段时间不符：${badTimes.join("、")}`);
      for (const key of ["quotes", "persons"]) evidence[key].push(...checked.evidence[key].map((entry) => ({ ...entry, where: `第 ${index + 1} 段` })));
      evidence.paragraphSources.push({ paragraph: index + 1, sources: cited.map((source) => ({ id: source.id, fingerprint: source.fingerprint })) });
    }
    const ids = [...new Set(paragraphs.flatMap((paragraph) => paragraph.sourceIds))];
    const cited = ids.map((id) => lookup.get(id));
    const titleCheck = validateDayText({ day: decision.day, title: decision.title, paragraphs: [] }, cited, { realNames });
    errors.push(...titleCheck.errors);
    const badTitleTimes = timeWordProblems(decision.title, cited.map((source) => Number(source.time.slice(0, 2))));
    if (badTitleTimes.length) errors.push(`标题时间不符：${badTitleTimes.join("、")}`);
    const hits = sensitiveHits({ title: decision.title, paragraphs: paragraphs.map((paragraph) => paragraph.text) });
    if (hits.length) errors.push(...hits.map((hit) => `敏感兜底：${hit.category}`));
    if (errors.length) refuse("TEXT_VALIDATION_FAILED", "Draft failed attribution, privacy, quote, or time checks.", { day: decision.day, errors });

    content = appendDay(content, { day: decision.day, kind: decision.kind ?? "story", title: decision.title, paragraphs: paragraphs.map((paragraph) => paragraph.text), sourceIds: ids, evidence }, {
      birthDay: "2025-01-03", now, dataCutoff: decision.day,
      speakerBySourceId: Object.fromEntries(cited.map((source) => [source.id, source.speaker ?? "未登记的人"])),
    }).content;
    content.days.find((day) => day.day === decision.day)._source = "codex";
    wrote.push({ day: decision.day, sourceIds: ids });
  }

  for (const [day, serialized] of protectedDays) {
    if (JSON.stringify(content.days.find((entry) => entry.day === day)) !== serialized) refuse("EXISTING_DAY_CHANGED", "An existing day changed while building the candidate.", { day });
  }
  if (wrote.length && !validateMonthContent(content, month)) refuse("INVALID_CANDIDATE", "Candidate failed month-content validation.");
  return { content: wrote.length ? content : original, review: { month, wrote, skipped, protectedDays: [...protectedDays].map(([day, serialized]) => ({ day, sha256: sha256(serialized) })), published: false } };
}

/** A transfer/probe failure is never evidence that a production month is missing. */
export function readProductionSnapshot(month, destination, ecs, run = spawnSync) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) refuse("INVALID_MONTH", "Invalid month.");
  assertOutsideRepository(destination, REPO);
  const remote = `/srv/nianlife-content/${month}.json`;
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-i", ecs.key];
  const command = `if test -f '${remote}'; then printf 'PRESENT '; sha256sum '${remote}'; elif test -d /srv/nianlife-content && test -r /srv/nianlife-content && test -x /srv/nianlife-content && ! test -e '${remote}' && ! test -L '${remote}'; then echo ABSENT; else exit 3; fi`;
  const options = { encoding: "utf8", timeout: 45_000, maxBuffer: 64 * 1024 };
  const probe = () => {
    const result = run("ssh", [...args, ecs.ssh, command], options);
    if (result.status !== 0) refuse("PRODUCTION_READ_FAILED", "Production content probe failed; no empty month was assumed.", { status: result.status });
    const output = (result.stdout ?? "").trim();
    if (output === "ABSENT") return "absent";
    const match = output.match(/^PRESENT ([a-f0-9]{64})\s+\/srv\/nianlife-content\/\d{4}-\d{2}\.json$/);
    if (!match) refuse("PRODUCTION_READ_FAILED", "Production content probe was ambiguous.");
    return match[1];
  };
  const revision = probe();
  if (revision === "absent") return { month, revision, content: null };
  const copied = run("scp", ["-q", ...args, `${ecs.ssh}:${remote}`, destination], options);
  if (copied.status !== 0) refuse("PRODUCTION_READ_FAILED", "Production content transfer failed; no empty month was assumed.", { status: copied.status });
  const bytes = fs.readFileSync(destination);
  if (sha256(bytes) !== revision || probe() !== revision) refuse("PRODUCTION_CHANGED", "Production content changed while its snapshot was read.");
  let content;
  try { content = JSON.parse(bytes.toString("utf8")); } catch { refuse("INVALID_PRODUCTION", "Production content is not valid JSON."); }
  if (!validateMonthContent(content, month)) refuse("INVALID_PRODUCTION", "Production snapshot failed month-content validation.");
  return { month, revision, content };
}

async function loadSources(client, from, until) {
  const result = await client.query(`select id, to_char(captured_at at time zone 'Asia/Shanghai','YYYY-MM-DD') AS "day",
    to_char(captured_at at time zone 'Asia/Shanghai','HH24:MI:SS.US') AS "time", text,
    source_label, metadata->>'senderDigest' sender_digest from raw_sources
    where source_type='wechat' and captured_at >= ($1::date::timestamp at time zone 'Asia/Shanghai')
      and captured_at < ($2::date::timestamp at time zone 'Asia/Shanghai')
      and deleted_at is null and coalesce(metadata->>'duplicateOf','')=''
    order by captured_at,id`, [from, until]);
  // Retain media placeholders as evidence that a family member shared a file.
  // A placeholder never supplies evidence of what the unseen picture/video shows.
  return result.rows.filter((row) => typeof row.text === "string" && row.text.trim()).map((row) => {
    const source = { id: row.id, day: row.day, time: row.time, text: row.text, speaker: labelForSender(row.sender_digest, row.source_label) };
    return { ...source, fingerprint: sourceFingerprint(source) };
  });
}

function privateDirectory(directory) {
  if (!nonempty(directory)) refuse("PRIVATE_OUTPUT_REQUIRED", "Specify a private directory with --out.");
  const resolved = path.resolve(directory);
  assertOutsideRepository(resolved, REPO);
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  assertOutsideRepository(resolved, REPO);
  return resolved;
}

function writePrivateJson(file, value) {
  assertOutsideRepository(file, REPO);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

async function connectReadOnly() {
  const { openRds } = await import(new URL("../../.data/night-rds.mjs", import.meta.url));
  return openRds({ readOnly: true, localPort: Number(process.env.NIANLIFE_RDS_PORT ?? (15470 + Math.floor(Math.random() * 100))) });
}

function realNames() {
  const ops = process.env.NIANLIFE_OPS_DIR ?? path.join(homedir(), "NianlifeOps", "ops-daily");
  const file = path.join(ops, "real-names.private.json");
  if (!fs.existsSync(file)) refuse("REAL_NAMES_REQUIRED", "Private real-name privacy rules are missing.");
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(value.names) || !value.names.every(nonempty)) refuse("REAL_NAMES_REQUIRED", "Private real-name privacy rules are invalid.");
  return value.names;
}

export async function prepare(out, { today = shanghaiToday() } = {}) {
  if (!validDay(today)) refuse("INVALID_TIME", "Invalid Shanghai date.");
  const directory = privateDirectory(out);
  if (fs.existsSync(path.join(directory, "source-pack.json"))) refuse("OUTPUT_EXISTS", "Source pack already exists; use a fresh private directory.");
  realNames();
  const ecs = resolveEcsConnection();
  const from = addDays(today, -14);
  const readyThrough = addDays(today, -1);
  const allDays = Array.from({ length: 14 }, (_, index) => addDays(from, index));
  const months = [...new Set(allDays.map((day) => day.slice(0, 7)))];
  const production = path.join(directory, "production");
  fs.mkdirSync(production, { recursive: true, mode: 0o700 });
  const snapshots = months.map((month) => {
    const snapshotFile = `production/${month}.json`;
    const snapshot = readProductionSnapshot(month, path.join(directory, snapshotFile), ecs);
    return { month, revision: snapshot.revision, snapshotFile: snapshot.content === null ? null : snapshotFile, content: snapshot.content };
  });
  const rds = await connectReadOnly();
  let allSources;
  try { allSources = await loadSources(rds.client, from, today); } finally { await rds.close(); }
  const covered = new Set(snapshots.flatMap((snapshot) => snapshot.content?.days.map((day) => day.day) ?? []));
  const days = allDays.filter((day) => !covered.has(day) && allSources.some((source) => source.day === day && isReadable(source.text)));
  const sources = allSources.filter((source) => days.includes(source.day));
  const pack = { schema: PACK_SCHEMA, generatedAt: new Date().toISOString(), today, from, readyThrough, days, sources, sourceFingerprint: sha256(JSON.stringify(sources)),
    months: snapshots.map(({ month, revision, snapshotFile }) => ({ month, revision, snapshotFile })),
    coveredDays: [...covered].sort(), noReadableSourceDays: allDays.filter((day) => !covered.has(day) && !days.includes(day)) };
  writePrivateJson(path.join(directory, "source-pack.json"), pack);
  return { days: days.length, sources: sources.length, sourcePack: path.join(directory, "source-pack.json") };
}

export async function apply(out, decisionsFile) {
  const directory = privateDirectory(out);
  if (!nonempty(decisionsFile)) refuse("DECISIONS_REQUIRED", "Specify the private decisions JSON with --decisions.");
  assertOutsideRepository(path.resolve(decisionsFile), REPO);
  const packFile = path.join(directory, "source-pack.json");
  const packBytes = fs.readFileSync(packFile);
  const pack = JSON.parse(packBytes.toString("utf8"));
  const decisionBytes = fs.readFileSync(decisionsFile);
  const decisions = JSON.parse(decisionBytes.toString("utf8"));
  if (pack.schema !== PACK_SCHEMA || !Array.isArray(pack.days) || !Array.isArray(pack.months)
    || !validDay(pack.today) || pack.from !== addDays(pack.today, -14) || pack.readyThrough !== addDays(pack.today, -1)
    || sha256(JSON.stringify(pack.sources)) !== pack.sourceFingerprint) refuse("INVALID_SOURCE_PACK", "Prepared source pack failed integrity checks.");
  checkedSources(pack.sources);
  if (!Array.isArray(decisions) || decisions.some((decision) => !decision || !pack.days.includes(decision.day))) refuse("UNPREPARED_DAY", "Decisions may only address prepared uncovered days.");
  const names = realNames();
  const ecs = resolveEcsConnection();
  const rds = await connectReadOnly();
  let currentSources;
  try { currentSources = (await loadSources(rds.client, pack.from, pack.today)).filter((source) => pack.days.includes(source.day)); } finally { await rds.close(); }
  assertSourcesUnchanged(pack.sources, currentSources);

  const candidateDir = path.join(directory, "candidates");
  const checkDir = path.join(directory, "apply-production");
  if (fs.existsSync(path.join(directory, "review-receipt.json"))) refuse("OUTPUT_EXISTS", "Reviewed candidates already exist; prepare a fresh source pack.");
  fs.mkdirSync(candidateDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(checkDir, { recursive: true, mode: 0o700 });
  const results = [];
  for (const month of [...new Set(decisions.map((decision) => decision.day.slice(0, 7)))]) {
    const prepared = pack.months.find((snapshot) => snapshot.month === month);
    if (!prepared || !(prepared.revision === "absent" || /^[a-f0-9]{64}$/.test(prepared.revision))) refuse("INVALID_SOURCE_PACK", "Missing production revision evidence.");
    let original = null;
    if (prepared.revision !== "absent") {
      if (prepared.snapshotFile !== `production/${month}.json`) refuse("INVALID_SOURCE_PACK", "Invalid production snapshot path.");
      const snapshotBytes = fs.readFileSync(path.join(directory, prepared.snapshotFile));
      if (sha256(snapshotBytes) !== prepared.revision) refuse("PRODUCTION_SNAPSHOT_CHANGED", "Prepared production snapshot was modified.");
      original = JSON.parse(snapshotBytes.toString("utf8"));
    }
    const fresh = readProductionSnapshot(month, path.join(checkDir, `${month}.json`), ecs);
    if (fresh.revision !== prepared.revision) refuse("PRODUCTION_CHANGED", "Production changed after preparation; prepare a fresh source pack.");
    const built = buildCandidate({ month, original, decisions: decisions.filter((decision) => decision.day.startsWith(`${month}-`)),
      sources: pack.sources.filter((source) => source.day.startsWith(`${month}-`)), currentSources: currentSources.filter((source) => source.day.startsWith(`${month}-`)), realNames: names, now: new Date().toISOString() });
    results.push({ ...built, expectedRevision: prepared.revision });
  }

  const reviews = [];
  for (const result of results) {
    const review = { ...result.review, expectedRevision: result.expectedRevision, candidateFile: null, candidateSha256: null };
    if (result.review.wrote.length) {
      review.candidateFile = `candidates/${result.review.month}.json`;
      const destination = path.join(directory, review.candidateFile);
      writePrivateJson(destination, result.content);
      review.candidateSha256 = sha256(fs.readFileSync(destination));
    }
    reviews.push(review);
  }
  const receipt = { schema: RECEIPT_SCHEMA, reviewedAt: new Date().toISOString(), sourcePackSha256: sha256(packBytes), decisionsSha256: sha256(decisionBytes),
    editor: "codex", modelCalls: 0, databaseWrites: 0, published: false, months: reviews };
  writePrivateJson(path.join(directory, "review-receipt.json"), receipt);
  return { candidates: reviews.filter((review) => review.candidateFile).length, wroteDays: reviews.reduce((count, review) => count + review.wrote.length, 0), published: false, receipt: path.join(directory, "review-receipt.json") };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : undefined; };
  const out = option("out");
  try {
    if (args[0] === "prepare") console.log(JSON.stringify(await prepare(out)));
    else if (args[0] === "apply") console.log(JSON.stringify(await apply(out, option("decisions"))));
    else refuse("INVALID_COMMAND", "Use prepare --out <private-directory> or apply --out <private-directory> --decisions <private-json>.");
  } catch (error) {
    // Detailed validation findings may contain private quotations. Save privately, never log them.
    try {
      const directory = privateDirectory(out);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      writePrivateJson(path.join(directory, `review-failed-${stamp}.json`), { schema: RECEIPT_SCHEMA, published: false, code: error.code ?? "EDITOR_FAILED", message: error.message, details: error.details ?? {} });
    } catch { /* No unsafe fallback destination. */ }
    console.error(`Codex editor refused: ${error.code ?? "EDITOR_FAILED"}. Details are in the private output directory when available.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
