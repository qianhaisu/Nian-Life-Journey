#!/usr/bin/env node
// Writer v2 SHADOW. Read-only against production, and it writes nothing anywhere:
// no LifeEvent update, no DailyTrace update, no publication ledger, no quality review row.
//
// It draws real cases from EXISTING production LifeEvents. That is deliberate: those rows already
// carry a Writer v1 title and story, so every case comes with a free v1 baseline written from the
// same day's evidence, which is exactly the comparison the Fable handoff needs. It does NOT mean
// the Writer is re-deciding worthiness — selection here is "windows that are already Memories",
// and the Writer's own judgement about worthiness is never consulted.
import { writeFileSync } from "node:fs";
import pg from "pg";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { shanghaiCalendarDate } from "../lib/organizer/life-date.ts";
import { createDeepSeekMemoryEditor } from "../lib/organizer/deepseek-editor.ts";
import { validateMemoryEditorVerdict } from "../lib/organizer/contract.ts";
import { groundClaims } from "../lib/organizer/claim-grounding.ts";
import { buildEvidencePackage, packageHasAssertableMaterial } from "../lib/organizer/writer-v2.ts";
import { WRITER_V2_SYSTEM_PROMPT, WRITER_V2_TOOL_NAME, WRITER_V2_TOOL_SCHEMA, WRITER_V2_PROMPT_VERSION, buildWriterV2Prompt } from "../lib/organizer/writer-v2-prompt.ts";
import { validateNarrative } from "../lib/organizer/narrative-validator.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { resolveSpeaker } from "../lib/organizer/identity.ts";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const OUT = argOf("out", null);
const LIMIT = Number(argOf("limit", "14"));
const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const NOW = new Date().toISOString();
const COLS = "id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids, source_label, visibility, metadata";

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
const apiKey = process.env.DEEPSEEK_API_KEY;
const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "").replace(/\/$/, "");
if (!dbUrl || !apiKey) { console.error("Need DATABASE_URL and DEEPSEEK_API_KEY."); process.exit(1); }

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, keepAlive: true });
await client.connect();

// Existing Memories with a v1 story and real WeChat sources behind them.
const { rows: events } = await client.query(`
  select id, title, story, occurred_at, source_ids, organizer_version
  from life_events
  where profile_id = $1 and story is not null and jsonb_array_length(source_ids::jsonb) > 0
  order by occurred_at desc`, [PROFILE_ID]);
console.log(`${events.length} production LifeEvents with a v1 story and sources.`);

// One conversation load, reused.
const conversations = new Map();
async function windowsFor(conversation) {
  if (conversations.has(conversation)) return conversations.get(conversation);
  const rows = []; const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const page = await client.query(
      `select ${COLS} from raw_sources where source_type='wechat' and deleted_at is null
        and profile_id=$1 and source_label=$2 order by captured_at, id limit ${PAGE} offset ${offset}`,
      [PROFILE_ID, conversation]);
    rows.push(...page.rows);
    if (page.rows.length < PAGE) break;
  }
  const sources = rows.map((row) => ({
    id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types,
    contributorId: String(row.metadata?.senderDigest ?? row.contributor_id),
    capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at),
    text: row.text ?? "", mediaIds: row.media_ids ?? [], visibility: row.visibility,
    metadata: row.metadata, sourceLabel: row.source_label, contributorRole: undefined,
  }));
  const built = buildEvidenceWindows(conversation, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] });
  conversations.set(conversation, built);
  return built;
}

const editor = createDeepSeekMemoryEditor(process.env, SUBJECT, { variant: "v4", registry: FAMILY_REGISTRY, singleChildHousehold: true });
const identityOf = (digest) => {
  const s = resolveSpeaker(digest, FAMILY_REGISTRY);
  return { speakerDigest: digest, known: s.known, canonicalPersonId: s.canonicalPersonId, narrativeLabel: s.narrativeLabel, relationshipToSubject: s.relationshipToSubject };
};

async function callWriter(pkg) {
  const body = JSON.stringify({
    model: editor.model, max_tokens: 3000, temperature: 0, thinking: { type: "disabled" },
    system: WRITER_V2_SYSTEM_PROMPT,
    tools: [{ name: WRITER_V2_TOOL_NAME, description: "输出这一页的标题、正文和逐句依据", input_schema: WRITER_V2_TOOL_SCHEMA }],
    tool_choice: { type: "tool", name: WRITER_V2_TOOL_NAME },
    messages: [{ role: "user", content: buildWriterV2Prompt(pkg) }],
  });
  const started = Date.now();
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body,
  });
  if (!res.ok) throw new Error(`writer http ${res.status}`);
  const payload = await res.json();
  const tool = payload.content?.find((b) => b.type === "tool_use" && b.name === WRITER_V2_TOOL_NAME);
  if (!tool) throw new Error("writer returned no tool_use");
  return { output: { contractVersion: "writer-v2-output-contract-v1", ...tool.input }, latencyMs: Date.now() - started, usage: payload.usage };
}

const cases = [];
let attempted = 0;
for (const ev of events) {
  if (cases.length >= LIMIT) break;
  attempted += 1;
  const sourceIds = Array.isArray(ev.source_ids) ? ev.source_ids : JSON.parse(ev.source_ids ?? "[]");
  const { rows: labelRows } = await client.query(`select distinct source_label from raw_sources where id = any($1)`, [sourceIds]);
  const conversation = labelRows[0]?.source_label;
  if (!conversation) continue;

  const all = await windowsFor(conversation);
  const window = all.find((w) => w.items.some((i) => sourceIds.includes(i.sourceId)));
  if (!window || window.stats.messageCount < 3) continue;

  let verdict, axes, bounded;
  try {
    verdict = validateMemoryEditorVerdict((await editor.organize(window)).verdict, window);
    axes = editor.axesByWindowId.get(window.windowId);
    bounded = editor.subjectResolutionByWindowId.get(window.windowId);
    if (!axes || !bounded) throw new Error("missing axes");
  } catch (error) {
    console.log(`  ${ev.id.slice(0, 18)} SKIP editor: ${String(error?.message ?? error).slice(0, 70)}`);
    continue;
  }

  const verdictWithAxis = { ...verdict, worthinessAxis: axes.worthinessAxis };
  const grounding = groundClaims(window, verdictWithAxis, SUBJECT, { registry: FAMILY_REGISTRY, singleChildHousehold: true });
  const lifeDate = shanghaiCalendarDate(window.timeRange.from);
  const pkg = buildEvidencePackage({
    window, windowFingerprint: window.windowId, grounding,
    selectedBy: { policyId: "production-v1-existing-memory", action: "life_event_candidate", worthinessScore: 0 },
    subject: { ...SUBJECT, narrativeLabel: "张年" },
    identityOf,
    quotableLines: (verdict.quotableLines ?? []).map((q) => ({ text: q.text, evidenceRef: q.evidenceRef, speakerRole: q.speakerRole })),
    longitudinal: [], lifeDate,
  });

  if (!packageHasAssertableMaterial(pkg)) {
    console.log(`  ${ev.id.slice(0, 18)} ${lifeDate} SKIP nothing assertable (${grounding.claims.length} claims, all refused)`);
    cases.push({ eventId: ev.id, lifeDate, skipped: "nothing_assertable", pkgSummary: summarize(pkg), v1: { title: ev.title, story: ev.story } });
    continue;
  }

  let writer;
  try { writer = await callWriter(pkg); }
  catch (error) { console.log(`  ${ev.id.slice(0, 18)} SKIP writer: ${String(error?.message ?? error).slice(0, 70)}`); continue; }

  const validation = validateNarrative({ pkg, output: writer.output });
  console.log(`  ${ev.id.slice(0, 18)} ${lifeDate} ${validation.ok ? "ACCEPT" : "REJECT"} ${writer.output.insufficient ? "(insufficient)" : `「${writer.output.title ?? ""}」`} ${validation.ok ? "" : validation.issues.map((i) => i.code).join(",")}`);

  cases.push({
    eventId: ev.id, lifeDate, windowId: window.windowId, stats: window.stats,
    v1: { title: ev.title, story: ev.story, organizerVersion: ev.organizer_version },
    package: pkg,
    v2: writer.output,
    validation: { ok: validation.ok, issues: validation.issues },
    latencyMs: writer.latencyMs, usage: writer.usage,
    pkgSummary: summarize(pkg),
  });
}
await client.end();

function summarize(pkg) {
  return {
    claims: pkg.claims.length,
    assertable: pkg.claims.filter((c) => c.assertable).length,
    questions: pkg.claims.filter((c) => c.assertionStatus === "question").length,
    plans: pkg.claims.filter((c) => c.assertionStatus === "plan_or_hypothetical").length,
    unresolved: pkg.claims.filter((c) => !c.subjectResolved).length,
    quotes: pkg.quotes.length,
    storyMedia: pkg.media.filter((m) => m.tier === "confirmed" || m.tier === "strong_contextual").length,
    weakMedia: pkg.media.filter((m) => m.tier === "day_level" || m.tier === "month_level" || m.tier === "unbound").length,
    people: pkg.identity.people.map((p) => p.narrativeLabel ?? "unknown"),
  };
}

const written = cases.filter((c) => c.v2);
const accepted = written.filter((c) => c.validation.ok);
const insufficient = written.filter((c) => c.v2.insufficient);
console.log(`\n${"=".repeat(70)}\nWRITER V2 SHADOW\n${"=".repeat(70)}`);
console.log(`events considered      : ${attempted}`);
console.log(`cases built            : ${cases.length}`);
console.log(`skipped (nothing assertable): ${cases.filter((c) => c.skipped).length}`);
console.log(`writer runs            : ${written.length}`);
console.log(`  accepted by validator: ${accepted.length}`);
console.log(`  rejected             : ${written.length - accepted.length}`);
console.log(`  declined (insufficient): ${insufficient.length}`);
const issues = {};
for (const c of written) for (const i of c.validation.issues) issues[i.code] = (issues[i.code] ?? 0) + 1;
console.log(`\nfailure taxonomy:`);
for (const [k, v] of Object.entries(issues).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log(`\nprompt=${WRITER_V2_PROMPT_VERSION} model=${editor.model} persist=false`);

if (OUT) { writeFileSync(OUT, JSON.stringify({ generatedAt: NOW, promptVersion: WRITER_V2_PROMPT_VERSION, model: editor.model, persist: false, cases }, null, 2), "utf8"); console.log(`\nWritten to ${OUT}  (contains family chat text — keep outside the repository)`); }
