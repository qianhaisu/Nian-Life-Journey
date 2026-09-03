#!/usr/bin/env node
// ONE bounded end-to-end Organizer canary (2026-09-03).
//
// The first time the real evidence pipeline — Evidence Builder → Memory Editor v4 → contract →
// claim grounding → V6 routing → Writer v2 → Narrative Validator — is allowed to PERSIST through
// the production repository. It is bounded by construction: it only ever touches the windows named
// on the command line by fingerprint, it refuses to run without them, and it writes nothing that
// the repository's own idempotency (organization fingerprint, deterministic ids, ON CONFLICT DO
// NOTHING links) would not absorb on a second run.
//
// Everything the canary creates is gated: a `needs_human_review` ledger row is written for every
// DailyTrace and LifeEvent, so nothing becomes visible merely because it persisted. Approval is a
// separate, human act on the ledger.
//
//   preflight (read-only, default):
//     node --import tsx -r dotenv/config scripts/organizer-canary.mjs --window=<fp> ... dotenv_config_path=.env.local
//   run (persists, once):
//     ... --mode=run --out=<abs path>.json
//   replay (re-applies the recorded payloads from a previous --out; expects zero new rows):
//     ... --mode=replay --from=<abs path>.json
//
// Modes never widen: `run` on a window that already has an organizer run for its fingerprint is a
// skip, not a rewrite.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";

process.env.REPOSITORY_BACKEND = "postgres";

const { buildEvidenceWindows } = await import("../lib/organizer/evidence/window.ts");
const { SHANGHAI_LIFE_DATE_SQL, shanghaiCalendarDate } = await import("../lib/organizer/life-date.ts");
const { createDeepSeekMemoryEditor } = await import("../lib/organizer/deepseek-editor.ts");
const { createV6RoutingPolicy } = await import("../lib/organizer/routing-policies.ts");
const { validate } = await import("../lib/organizer/validator.ts");
const { groundClaims } = await import("../lib/organizer/claim-grounding.ts");
const { validateMemoryEditorVerdict } = await import("../lib/organizer/contract.ts");
const { FAMILY_REGISTRY } = await import("../lib/organizer/family-registry.ts");
const { resolveSpeaker } = await import("../lib/organizer/identity.ts");
const { buildEvidencePackage, packageHasAssertableMaterial } = await import("../lib/organizer/writer-v2.ts");
const { WRITER_V2_SYSTEM_PROMPT, WRITER_V2_TOOL_NAME, WRITER_V2_TOOL_SCHEMA, WRITER_V2_PROMPT_VERSION, buildWriterV2Prompt } = await import("../lib/organizer/writer-v2-prompt.ts");
const { NARRATIVE_VALIDATOR_VERSION, validateNarrative } = await import("../lib/organizer/narrative-validator.ts");
const { QUALITY_REVIEW_POLICY_VERSION } = await import("../lib/organizer/quality-review.ts");
const repo = await import("../lib/db/repository.ts");

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const MODE = argOf("mode", "preflight");
const OUT = argOf("out", null);
const FROM = argOf("from", null);
const WINDOWS = args.filter((a) => a.startsWith("--window=")).map((a) => a.slice(9));
const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };
const CANARY_VERSION = "organizer-canary-2026-09-03";
const ORGANIZER_VERSION = "evidence-v6+writer-v2";
const MAX_WINDOWS = 5;
const NOW = new Date().toISOString();

if (!["preflight", "run", "replay"].includes(MODE)) { console.error(`Unknown mode ${MODE}`); process.exit(1); }
if (MODE !== "replay" && (WINDOWS.length === 0 || WINDOWS.length > MAX_WINDOWS)) { console.error(`Name 1–${MAX_WINDOWS} windows with --window=<fingerprint>.`); process.exit(1); }
if (MODE === "run" && !OUT) { console.error("--mode=run needs --out=<path>.json (it is the audit record and the replay input)."); process.exit(1); }
if (MODE === "replay" && !FROM) { console.error("--mode=replay needs --from=<run output>.json"); process.exit(1); }

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
const apiKey = process.env.DEEPSEEK_API_KEY;
const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "").replace(/\/$/, "");
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
if (MODE === "run" && !apiKey) { console.error("Need DEEPSEEK_API_KEY for --mode=run."); process.exit(1); }

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, keepAlive: true });
await client.connect();

// ---------------------------------------------------------------- production counts (BEFORE / AFTER)
async function counts() {
  const one = async (sql, params = []) => Number((await client.query(sql, params)).rows[0].n);
  const statuses = (await client.query(`select status, count(*)::int as n from raw_sources where profile_id=$1 and deleted_at is null group by status order by status`, [PROFILE_ID])).rows;
  return {
    lifeEvents: await one(`select count(*) as n from life_events where profile_id=$1`, [PROFILE_ID]),
    dailyTraces: await one(`select count(*) as n from daily_traces where profile_id=$1`, [PROFILE_ID]),
    organizerRuns: await one(`select count(*) as n from organizer_runs where profile_id=$1`, [PROFILE_ID]),
    qualityReviews: await one(`select count(*) as n from content_quality_reviews where profile_id=$1`, [PROFILE_ID]),
    sourceMemoryLinks: await one(`select count(*) as n from source_memory_links`),
    mediaLinkedToEvents: await one(`select count(*) as n from media where profile_id=$1 and life_event_id is not null`, [PROFILE_ID]),
    rawSources: await one(`select count(*) as n from raw_sources where profile_id=$1 and deleted_at is null`, [PROFILE_ID]),
    rawSourceStatus: Object.fromEntries(statuses.map((r) => [r.status, r.n])),
  };
}
const diff = (a, b) => Object.fromEntries(Object.keys(b).filter((k) => typeof b[k] === "number" && a[k] !== b[k]).map((k) => [k, b[k] - a[k]]));

// ---------------------------------------------------------------- rebuild the named windows
const fingerprintOf = (w) => createHash("sha256").update(`${w.conversationId}|${w.activityDate}|${w.items.map((i) => i.sourceId).sort().join(",")}`).digest("hex").slice(0, 32);
const lifeDateOf = (w) => shanghaiCalendarDate(w.timeRange.from);

async function rebuildWindows(wanted) {
  const COLS = "id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids, source_label, visibility, metadata";
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await client.query(`select ${COLS}, ${SHANGHAI_LIFE_DATE_SQL} as life_date from raw_sources where source_type='wechat' and deleted_at is null and profile_id=$1 order by captured_at, id limit 1000 offset ${offset}`, [PROFILE_ID]);
    rows.push(...page.rows);
    if (page.rows.length < 1000) break;
  }
  const byConversation = new Map();
  for (const row of rows) {
    if (!byConversation.has(row.source_label)) byConversation.set(row.source_label, []);
    byConversation.get(row.source_label).push({ id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types, contributorId: String(row.metadata?.senderDigest ?? row.contributor_id), capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at), text: row.text ?? "", mediaIds: row.media_ids ?? [], visibility: row.visibility, metadata: row.metadata, sourceLabel: row.source_label });
  }
  const found = new Map();
  for (const [conversation, sources] of byConversation) {
    for (const w of buildEvidenceWindows(conversation, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] })) {
      const fp = fingerprintOf(w);
      if (wanted.has(fp)) found.set(fp, w);
    }
  }
  const missing = [...wanted].filter((fp) => !found.has(fp));
  if (missing.length) throw new Error(`Windows could not be rebuilt identically (fingerprint mismatch): ${missing.join(", ")}`);
  return found;
}

async function windowState(w) {
  const ids = w.items.map((i) => i.sourceId);
  const day = lifeDateOf(w);
  const statuses = (await client.query(`select status, count(*)::int as n from raw_sources where id = any($1) group by status`, [ids])).rows;
  const runs = (await client.query(`select id, action, organization_fingerprint from organizer_runs where profile_id=$1 and source_ids ?| $2`, [PROFILE_ID, ids])).rows;
  const traces = (await client.query(`select id, organization_fingerprint, jsonb_array_length(entries) as entries from daily_traces where profile_id=$1 and to_char(occurred_at at time zone 'Asia/Shanghai','YYYY-MM-DD')=$2`, [PROFILE_ID, day])).rows;
  const tracesUtc = (await client.query(`select id from daily_traces where profile_id=$1 and to_char(occurred_at,'YYYY-MM-DD')=$2`, [PROFILE_ID, day])).rows;
  const events = (await client.query(`select id, title from life_events where profile_id=$1 and to_char(occurred_at at time zone 'Asia/Shanghai','YYYY-MM-DD')=$2`, [PROFILE_ID, day])).rows;
  const links = (await client.query(`select count(*)::int as n from source_memory_links where raw_source_id = any($1)`, [ids])).rows[0].n;
  return { lifeDate: day, messageCount: w.stats.messageCount, imageCount: w.stats.imageCount, sourceIds: ids, rawSourceStatus: Object.fromEntries(statuses.map((r) => [r.status, r.n])), organizerRunsTouchingSources: runs, dailyTracesOnDay: [...new Map([...traces, ...tracesUtc].map((t) => [t.id, t])).values()], lifeEventsOnDay: events, sourceMemoryLinks: links, strongMediaBindings: w.mediaBindings.filter((b) => b.confidence >= 0.75).length };
}

// Same day match persistDailyTrace() uses: the stored timestamp's first ten characters.
async function foreignTracesOnDay(occurredAt, runFp) {
  const day = occurredAt.slice(0, 10);
  const rows = (await client.query(`select id, organization_fingerprint, organizer_run->>'organizerType' as organizer_type from daily_traces where profile_id=$1 and left(occurred_at::text,10)=$2`, [PROFILE_ID, day])).rows;
  return rows.filter((t) => t.organization_fingerprint !== runFp).map((t) => ({ id: t.id, organizerType: t.organizer_type, organizationFingerprint: t.organization_fingerprint }));
}

// ---------------------------------------------------------------- the pipeline (identical to the fresh shadow)
const identityOf = (digest) => {
  const s = resolveSpeaker(digest, FAMILY_REGISTRY);
  return { speakerDigest: digest, known: s.known, canonicalPersonId: s.canonicalPersonId, narrativeLabel: s.narrativeLabel, relationshipToSubject: s.relationshipToSubject };
};

function judge(editor, window, raw) {
  const verdict = validateMemoryEditorVerdict(raw, window);
  const axes = editor.axesByWindowId.get(window.windowId);
  const bounded = editor.subjectResolutionByWindowId.get(window.windowId);
  if (!axes || !bounded) throw new Error("missing axes");
  const verdictWithAxis = { ...verdict, worthinessAxis: axes.worthinessAxis };
  const grounding = groundClaims(window, verdictWithAxis, SUBJECT, OPTS);
  const policy = createV6RoutingPolicy(() => ({ worthiness: axes.worthinessAxis, evidence: axes.evidenceAxis, subjectResolution: bounded.level, grounding }), () => {});
  const outcome = validate(window, verdictWithAxis, { now: NOW, existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [], routingPolicy: policy, claimGrounding: grounding });
  return { verdict, grounding, outcome, subjectResolution: bounded.level, worthinessScore: outcome.outcome.worthinessScore ?? 0 };
}

async function callWriter(model, pkg) {
  const body = JSON.stringify({
    model, max_tokens: 3000, temperature: 0, thinking: { type: "disabled" },
    system: WRITER_V2_SYSTEM_PROMPT,
    tools: [{ name: WRITER_V2_TOOL_NAME, description: "输出这一页的标题、正文和逐句依据", input_schema: WRITER_V2_TOOL_SCHEMA }],
    tool_choice: { type: "tool", name: WRITER_V2_TOOL_NAME },
    messages: [{ role: "user", content: buildWriterV2Prompt(pkg) }],
  });
  const started = Date.now();
  const res = await fetch(`${baseUrl}/v1/messages`, { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body });
  if (!res.ok) throw new Error(`writer http ${res.status}`);
  const payload = await res.json();
  const tool = payload.content?.find((b) => b.type === "tool_use" && b.name === WRITER_V2_TOOL_NAME);
  if (!tool) throw new Error("writer returned no tool_use");
  return { output: { contractVersion: "writer-v2-output-contract-v1", ...tool.input }, latencyMs: Date.now() - started, usage: payload.usage };
}

// ---------------------------------------------------------------- persistence (all through the repository, plus the ledger)
// The ledger has no repository write path yet; this mirrors scripts/deepseek-quality-audit.mjs.
// Deterministic id + ON CONFLICT DO NOTHING on the natural key keeps replays silent.
const LEDGER_SQL = `insert into content_quality_reviews
     (id, profile_id, target_kind, target_id, decision, gate_a, subject_relevance, worthiness_score,
      reason_codes, provider, model, prompt_version, policy_version, review_fingerprint, reviewed_at)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14, now())
   on conflict (target_kind, target_id, prompt_version) do nothing`;

async function gate(kind, targetId, fp, model, worthinessScore, reasonCodes) {
  const decision = "needs_human_review";
  const reviewFingerprint = createHash("sha256").update(`${kind}:${targetId}:${CANARY_VERSION}:${QUALITY_REVIEW_POLICY_VERSION}:${decision}`).digest("hex");
  const row = { id: `qr-canary-${kind}-${fp}`, profileId: PROFILE_ID, targetKind: kind, targetId, decision, worthinessScore, reasonCodes, provider: "organizer-canary", model, promptVersion: CANARY_VERSION };
  const result = await client.query(LEDGER_SQL, [row.id, PROFILE_ID, kind, targetId, decision, null, null, worthinessScore, JSON.stringify(reasonCodes), "organizer-canary", model, CANARY_VERSION, QUALITY_REVIEW_POLICY_VERSION, reviewFingerprint]);
  return { ...row, inserted: result.rowCount === 1 };
}

// One organizer_runs row per window, keyed by the run fingerprint. This is the checkpoint: a second
// `run` sees it and skips the window before calling any model.
const runFingerprintOf = (fp) => `canary:${CANARY_VERSION}:${fp}`;
const runAction = (v6) => v6 === "life_event_candidate" ? "create_memory" : v6 === "daily_trace" ? "daily_trace" : "store_only";

async function applyPersisted(p) {
  // Re-applies exactly what a `run` persisted, in the same order. Used by `run` itself and by `replay`.
  const created = {};
  if (p.dailyTrace) {
    const saved = await repo.persistDailyTrace(p.dailyTrace);
    created.dailyTraceId = saved.id;
    created.dailyTraceMergedIntoExisting = saved.id !== p.dailyTrace.id;
    created.ledger = await gate("daily_trace", saved.id, p.fingerprint, p.model, p.worthinessScore, ["organizer_canary", `v6:${p.v6Action}`]);
  }
  if (p.lifeEvent) {
    const saved = await repo.persistOrganization(p.lifeEvent.sourceIds, p.lifeEvent, p.links);
    created.lifeEventId = saved.id;
    created.ledger = await gate("life_event", saved.id, p.fingerprint, p.model, p.worthinessScore, ["organizer_canary", "writer_v2_accepted", `v6:${p.v6Action}`]);
  }
  const run = await repo.persistOrganizerRun({ ...p.run, targetId: created.dailyTraceId ?? created.lifeEventId ?? p.run.targetId });
  created.organizerRunId = run.id;
  return created;
}

// ---------------------------------------------------------------- modes
const before = await counts();
console.log(`BEFORE ${JSON.stringify(before)}`);

if (MODE === "replay") {
  const record = JSON.parse(readFileSync(FROM, "utf8"));
  if (record.canaryVersion !== CANARY_VERSION) throw new Error(`replay record is from ${record.canaryVersion}, not ${CANARY_VERSION}`);
  const replayed = [];
  for (const w of record.windows) {
    if (!w.persisted) { replayed.push({ fingerprint: w.fingerprint, skipped: "nothing was persisted" }); continue; }
    const again = await applyPersisted(w.persisted);
    const sameRows = JSON.stringify({ ...w.created, ledger: undefined }) === JSON.stringify({ ...again, ledger: undefined });
    const ledgerSilent = again.ledger ? again.ledger.inserted === false : true;
    replayed.push({ fingerprint: w.fingerprint, first: w.created, again, same: sameRows && ledgerSilent });
    console.log(`  ${w.fingerprint} ${w.lifeDate} replay → ${replayed.at(-1).same ? "IDENTICAL, no new rows" : "DIFFERENT"} ${JSON.stringify(again)}`);
  }
  const after = await counts();
  console.log(`AFTER  ${JSON.stringify(after)}\nDELTA  ${JSON.stringify(diff(before, after))}`);
  await client.end();
  process.exit(Object.keys(diff(before, after)).length === 0 && replayed.every((r) => r.skipped || r.same) ? 0 : 2);
}

const wanted = new Set(WINDOWS);
const windows = await rebuildWindows(wanted);
const states = new Map();
for (const fp of WINDOWS) {
  const w = windows.get(fp);
  const s = await windowState(w);
  states.set(fp, s);
  const existingRun = await repo.findOrganizerRun(runFingerprintOf(fp));
  console.log(`\n${fp}  ${s.lifeDate}  n=${s.messageCount} img=${s.imageCount} strongMedia=${s.strongMediaBindings}\n  raw_sources: ${JSON.stringify(s.rawSourceStatus)}  links: ${s.sourceMemoryLinks}\n  organizer_runs touching these sources: ${s.organizerRunsTouchingSources.length}  canary run for this fingerprint: ${existingRun ? existingRun.id : "none"}\n  daily_traces on ${s.lifeDate}: ${s.dailyTracesOnDay.map((t) => t.id).join(", ") || "none"}\n  life_events on ${s.lifeDate}: ${s.lifeEventsOnDay.map((e) => e.id).join(", ") || "none"}`);
}

if (MODE === "preflight") {
  console.log(`\npreflight only — nothing written. mode=run persists.`);
  await client.end();
  process.exit(0);
}

// ---------------------------------------------------------------- run
const editor = createDeepSeekMemoryEditor(process.env, SUBJECT, { variant: "v4", ...OPTS });
console.log(`\nEditor: ${editor.name} ${editor.model} ${editor.promptVersion}  Writer: ${WRITER_V2_PROMPT_VERSION}  Validator: ${NARRATIVE_VALIDATOR_VERSION}  Canary: ${CANARY_VERSION}\n`);
const results = [];
for (const fp of WINDOWS) {
  const w = windows.get(fp);
  const state = states.get(fp);
  const lifeDate = state.lifeDate;
  const sourceIds = w.items.map((i) => i.sourceId);
  const runFp = runFingerprintOf(fp);
  const entry = { fingerprint: fp, windowId: w.windowId, lifeDate, before: state };
  results.push(entry);

  const existingRun = await repo.findOrganizerRun(runFp);
  if (existingRun) { entry.skipped = `organizer run ${existingRun.id} already exists for this fingerprint`; console.log(`  ${fp} ${lifeDate} SKIP (${entry.skipped})`); continue; }

  const started = Date.now();
  let judged;
  try {
    const raw = (await editor.organize(w)).verdict;
    judged = judge(editor, w, raw);
  } catch (error) {
    // No run row on an editor failure: the window stays unprocessed and retryable, and nothing is written.
    entry.error = `editor: ${String(error?.message ?? error)}`;
    console.log(`  ${fp} ${lifeDate} EDITOR ERROR — nothing written`);
    continue;
  }
  const v6Action = judged.outcome.outcome.action;
  entry.judgment = { v6Action, reasonCodes: judged.outcome.reasonCodes, subjectResolution: judged.subjectResolution, claims: judged.grounding.claims.length, promotable: judged.grounding.promotableGroundedFactCount, worthinessScore: judged.worthinessScore, selectionReason: judged.outcome.outcome.selectionReason, editorLatencyMs: Date.now() - started };
  const runBase = { organizerType: "ai", organizerVersion: ORGANIZER_VERSION, provider: editor.name, model: editor.model, promptVersion: `${editor.promptVersion}|${WRITER_V2_PROMPT_VERSION}|${NARRATIVE_VALIDATOR_VERSION}`, processedAt: new Date().toISOString(), organizationFingerprint: runFp, sourceCount: sourceIds.length, mediaInputCount: w.stats.imageCount, latencyMs: Date.now() - started };
  const persisted = { fingerprint: fp, v6Action, model: editor.model, worthinessScore: judged.worthinessScore, run: { id: `organizer-run-canary-${fp}`, profileId: PROFILE_ID, action: runAction(v6Action), sourceIds, ...runBase } };

  if (v6Action === "daily_trace") {
    const o = judged.outcome.outcome;
    entry.traceLines = o.traceLines;
    // persistDailyTrace() falls back to a (profileId, day) match and MERGES into whatever row holds
    // that day — including a rule-derived trace the ledger has already approved. Merging canary
    // entries into an approved row would publish them without review and overwrite the legacy
    // row's provenance. Until that semantics is decided, the canary withholds the trace row on such
    // days and records only the run; the trace lines stay in the audit record.
    const foreign = await foreignTracesOnDay(o.occurredAt, runFp);
    if (foreign.length) {
      persisted.run.action = "store_only";
      persisted.run.fallbackReason = `v6:daily_trace|trace_row_withheld:legacy_trace_on_day:${foreign.map((t) => t.id).join(",")}`;
      entry.withheld = { reason: "legacy_trace_on_day", traces: foreign };
    } else {
      persisted.dailyTrace = { id: `trace-canary-${fp}`, profileId: PROFILE_ID, occurredAt: o.occurredAt, entries: o.traceLines.map((l) => l.text), sourceIds, scopes: o.scopes, visibility: w.items.some((i) => i.visibility === "private") ? "private" : "family", organizerRun: runBase, organizationFingerprint: runFp };
    }
  } else if (v6Action === "life_event_candidate") {
    const o = judged.outcome.outcome;
    const pkg = buildEvidencePackage({ window: w, windowFingerprint: fp, grounding: judged.grounding, selectedBy: { policyId: "worthiness-v6-grounded", action: v6Action, worthinessScore: judged.worthinessScore }, subject: { ...SUBJECT, narrativeLabel: "张年" }, identityOf, quotableLines: (judged.verdict.quotableLines ?? []).map((q) => ({ text: q.text, evidenceRef: q.evidenceRef, speakerRole: q.speakerRole })), longitudinal: [], lifeDate });
    entry.package = pkg;
    if (!packageHasAssertableMaterial(pkg)) {
      persisted.run.fallbackReason = "writer_v2:nothing_assertable";
      persisted.run.action = "store_only";
    } else {
      let writer;
      try { writer = await callWriter(editor.model, pkg); }
      catch (error) { entry.error = `writer: ${String(error?.message ?? error)}`; console.log(`  ${fp} ${lifeDate} WRITER ERROR — nothing written`); continue; }
      const validation = validateNarrative({ pkg, output: writer.output });
      entry.writer = { output: writer.output, validation, latencyMs: writer.latencyMs, usage: writer.usage };
      if (!validation.ok || writer.output.insufficient) {
        persisted.run.fallbackReason = writer.output.insufficient ? "writer_v2:insufficient" : `writer_v2:rejected:${validation.issues.map((i) => i.code).join(",")}`;
        persisted.run.action = "store_only";
      } else {
        // Media: only bindings the package marks confirmed / strong_contextual, and only those the
        // Writer actually used. Same-day is not a binding.
        const strong = new Set(pkg.media.filter((m) => m.tier === "confirmed" || m.tier === "strong_contextual").map((m) => m.mediaId));
        const mediaIds = (writer.output.usedMediaIds ?? []).filter((id) => strong.has(id));
        const cited = new Set((writer.output.narrativeClaims ?? []).flatMap((c) => c.supportedBySourceIds ?? []));
        const people = [...new Set(pkg.identity.people.filter((p) => p.known && p.narrativeLabel).map((p) => p.narrativeLabel))];
        persisted.lifeEvent = { id: `event-canary-${fp}`, profileId: PROFILE_ID, title: writer.output.title, story: writer.output.story, occurredAt: o.occurredAt, people, tags: [], contentTypes: o.contentTypes, mediaIds, sourceIds, growthRecordIds: [], careRecordIds: [], eventType: o.eventType, memoryWeight: "memory", scopes: ["family"], heroMediaId: mediaIds[0], visibility: w.items.some((i) => i.visibility === "private") ? "private" : "family", keptInYearbook: false, createdBy: "ai", organizerVersion: ORGANIZER_VERSION, organizerRun: { ...runBase, tokenUsage: { input: writer.usage?.input_tokens, output: writer.usage?.output_tokens } }, organizationFingerprint: runFp };
        persisted.links = sourceIds.map((id) => ({ rawSourceId: id, lifeEventId: persisted.lifeEvent.id, role: cited.has(id) ? "primary" : "supporting", createdAt: runBase.processedAt }));
      }
    }
  } else {
    // store_only / plan_marker: the run row is the whole record. raw_sources are not touched.
    persisted.run.fallbackReason = `v6:${v6Action}`;
  }

  entry.persisted = persisted;
  entry.created = await applyPersisted(persisted);
  console.log(`  ${fp} ${lifeDate} ${v6Action} → ${persisted.run.action}${persisted.run.fallbackReason ? ` (${persisted.run.fallbackReason})` : ""}  created ${JSON.stringify({ ...entry.created, ledger: entry.created.ledger ? `${entry.created.ledger.decision}${entry.created.ledger.inserted ? "" : " (existing)"}` : undefined })}`);
}

const after = await counts();
console.log(`\nAFTER  ${JSON.stringify(after)}\nDELTA  ${JSON.stringify(diff(before, after))}`);
await client.end();

writeFileSync(OUT, JSON.stringify({ canaryVersion: CANARY_VERSION, generatedAt: NOW, mode: MODE, editor: { name: editor.name, model: editor.model, promptVersion: editor.promptVersion }, writerPromptVersion: WRITER_V2_PROMPT_VERSION, validatorVersion: NARRATIVE_VALIDATOR_VERSION, before, after, delta: diff(before, after), windows: results }, null, 2), "utf8");
console.log(`\nWritten to ${OUT}  (contains family chat text — keep outside the repository)`);
