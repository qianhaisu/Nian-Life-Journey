#!/usr/bin/env node
// Claude review entrance (2026-09-16). Teddy authorized Claude to actually review photos and stories
// and to publish what passes, without a private review page and without Teddy approving item by item.
//
// This is NOT the human entrance (scripts/story-review.mjs) and never writes a human signature. Every
// row it writes goes through recordClaudeStoryDecision / recordClaudeMediaDecision, which record
// provider "claude-review", require the authorization reason code, bind the exact content version
// that was reviewed, refuse a stale version, write idempotently, and refuse to land on top of any
// family decision (lib/organizer/story-write-guard.ts CLAUDE_REVIEW_PROVIDER).
//
// Steps — review and apply are separate on purpose; the review is Claude reading the evidence:
//
//   1) versions   fix the object ids and content versions that will be reviewed
//        photos-versions  --ids-file=<abs.txt>  --out=<abs.json>
//        stories-package  --events=<id,...>     --out=<abs.json>   (story + its source text, for reading)
//   2) apply      record the decisions Claude wrote after reading (dry run unless --commit)
//        photos-apply     --decisions=<abs.json> [--commit]
//        stories-apply    --decisions=<abs.json> [--commit]
//   3) rollback   supersede one batch with a hold (needs_human_review), through the same guarded path
//        rollback         --decisions=<abs.json> [--commit]
//
// decisions file: { batch, kind: "photos"|"stories", promptVersion, policyVersion,
//                   entries: [{ mediaId|eventId, reviewedContentVersion, decision, reasonCodes }] }
// The script adds the authorization code, `batch:<id>` and `reviewer:claude` to every row itself.
//
// Output files hold family text and live outside the repository (same containment as story-review).
// Production only: REPOSITORY_BACKEND=postgres. Prints ids, versions and outcomes — never text.
import { readFileSync, writeFileSync } from "node:fs";
import { ContainmentError, assertOutsideRepository, findRepositoryRoot } from "./lib/repo-containment.mjs";

const [command, ...args] = process.argv.slice(2);
const argOf = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const hasFlag = (name) => args.includes(`--${name}`);
const refuse = (message) => { console.error(`REFUSED: ${message}`); process.exit(1); };
const COMMANDS = ["photos-versions", "stories-package", "photos-apply", "stories-apply", "rollback"];
if (!COMMANDS.includes(command)) { console.error(`usage: claude-review.mjs ${COMMANDS.join("|")} …`); process.exit(1); }

let repo;
try { repo = findRepositoryRoot(import.meta.url); } catch (error) { refuse(`could not locate the repository root (${error instanceof ContainmentError ? error.code : String(error)})`); }
const outside = (target) => {
  try { return assertOutsideRepository(target, repo).literal; } catch (error) {
    const code = error instanceof ContainmentError ? error.code : "PATH_UNRESOLVABLE";
    refuse(`this file holds family material; it must live outside the repository (${code}).`);
  }
};
if ((process.env.REPOSITORY_BACKEND ?? "").toLowerCase() !== "postgres") refuse("set REPOSITORY_BACKEND=postgres (with DATABASE_URL).");

const repository = await import("../lib/db/repository.ts");
const { CLAUDE_AUTHORIZATION_REASON } = await import("../lib/organizer/story-write-guard.ts");

const writeNew = (file, data) => {
  outside(file);
  try { writeFileSync(file, JSON.stringify(data, null, 2), { encoding: "utf8", flag: "wx" }); }
  catch (error) { refuse(`could not create ${file} as a new file (${error?.code ?? String(error)}); nothing written.`); }
};
const stamp = (batch, codes) => [...new Set([...(codes ?? []), CLAUDE_AUTHORIZATION_REASON, `batch:${batch}`, "reviewer:claude"])];
const tally = (rows) => rows.reduce((acc, row) => { acc[row.outcome] = (acc[row.outcome] ?? 0) + 1; return acc; }, {});
const classify = (error) => {
  const code = error?.code ?? String(error?.message ?? error).match(/^([A-Z_]+)/)?.[1] ?? "ERROR";
  if (code === "STALE_REVIEW_CONTENT") return "stale";
  if (code === "HUMAN_DECISION_PRESENT") return "human-decision-kept";
  return "refused";
};

if (command === "photos-versions") {
  const idsFile = argOf("ids-file"); const out = argOf("out");
  if (!idsFile || !out) refuse("--ids-file and --out are required");
  outside(out);
  const ids = readFileSync(idsFile, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const entries = [];
  const missing = [];
  for (const id of ids) {
    const v = await repository.getMediaContentVersion(id);
    if (v) entries.push({ mediaId: id, reviewedContentVersion: v.contentVersion }); else missing.push(id);
  }
  writeNew(out, { generatedAt: new Date().toISOString(), entries });
  console.log(`versions: ${entries.length} fixed, ${missing.length} missing → ${out}`);
} else if (command === "stories-package") {
  const out = argOf("out"); const events = (argOf("events") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!out || events.length === 0) refuse("--events and --out are required");
  outside(out);
  const entries = [];
  for (const eventId of events) {
    const version = await repository.getStoryContentVersion(eventId);
    if (!version) { console.log(`${eventId}  missing`); continue; }
    const detail = await repository.getEventDetail(eventId);
    entries.push({
      eventId, reviewedContentVersion: version.contentSha256, content: version.content,
      sources: (detail?.sources ?? []).map((source) => ({ id: source.id, capturedAt: source.capturedAt, sourceLabel: source.sourceLabel, sourceType: source.sourceType, text: source.text ?? null, mediaIds: source.mediaIds ?? [] })),
    });
    console.log(`${eventId}  sha ${version.contentSha256.slice(0, 16)}  sources ${entries.at(-1).sources.length}`);
  }
  writeNew(out, { generatedAt: new Date().toISOString(), entries });
  console.log(`package: ${entries.length} stories → ${out}`);
} else {
  const file = argOf("decisions");
  if (!file) refuse("--decisions is required");
  const plan = JSON.parse(readFileSync(file, "utf8"));
  const commit = hasFlag("commit");
  if (!plan.batch || !plan.promptVersion || !plan.policyVersion || !Array.isArray(plan.entries)) refuse("decisions file needs batch, promptVersion, policyVersion and entries");
  const kind = plan.kind;
  if (kind !== "photos" && kind !== "stories") refuse('decisions file needs kind "photos" or "stories"');
  const rollback = command === "rollback";
  if (!rollback && command !== `${kind}-apply`) refuse(`this is a ${kind} decisions file; use ${kind}-apply`);

  const promptVersion = rollback ? `${plan.promptVersion}-rollback` : plan.promptVersion;
  const outcomes = [];
  for (const entry of plan.entries) {
    const id = kind === "photos" ? entry.mediaId : entry.eventId;
    const decision = rollback ? "needs_human_review" : entry.decision;
    const codes = rollback ? stamp(plan.batch, [`rollback-of:${plan.batch}`, ...(entry.reasonCodes ?? []).filter((code) => /^(kind|subject|use|sensitive):/.test(code))]) : stamp(plan.batch, entry.reasonCodes);
    if (!commit) { outcomes.push({ id, outcome: `would-${decision}` }); continue; }
    try {
      // For a rollback the reviewed version is the CURRENT one: we are not re-judging content, only
      // withdrawing this batch's decision. A changed object is still refused as stale.
      let version = entry.reviewedContentVersion;
      if (rollback) version = kind === "photos" ? (await repository.getMediaContentVersion(id))?.contentVersion : (await repository.getStoryContentVersion(id))?.contentSha256;
      const result = kind === "photos"
        ? await repository.recordClaudeMediaDecision({ mediaId: id, decision, reviewedContentVersion: version, promptVersion, policyVersion: plan.policyVersion, reasonCodes: codes })
        : await repository.recordClaudeStoryDecision({ eventId: id, decision, reviewedContentSha256: version, promptVersion, policyVersion: plan.policyVersion, reasonCodes: codes });
      outcomes.push({ id, outcome: result.idempotent ? "unchanged" : `written-${decision}` });
    } catch (error) {
      outcomes.push({ id, outcome: classify(error), detail: String(error?.message ?? error).slice(0, 140) });
    }
  }
  for (const o of outcomes) if (!/^(written|unchanged|would)/.test(o.outcome)) console.log(`${o.id}  ${o.outcome}  ${o.detail ?? ""}`);
  console.log(`${commit ? "COMMIT" : "DRY RUN — nothing written"} batch=${plan.batch} ${rollback ? "(rollback) " : ""}${JSON.stringify(tally(outcomes))}`);
  const report = argOf("report");
  if (report) writeNew(report, { batch: plan.batch, rollback, commit, at: new Date().toISOString(), outcomes });
  if (outcomes.some((o) => o.outcome === "refused")) process.exitCode = 2;
}
