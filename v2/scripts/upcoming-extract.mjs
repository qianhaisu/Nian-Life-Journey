// 近期待办 — the one entry point. Reads WeChat material already in the archive, asks the model what
// the family has to DO about 张年, and merges the answer into upcoming_items.
//
//   node --env-file=.env.local --import tsx scripts/upcoming-extract.mjs --since=2026-08-01
//   node --env-file=.env.local --import tsx scripts/upcoming-extract.mjs --incremental
//   node --env-file=.env.local --import tsx scripts/upcoming-extract.mjs --since=2026-08-01 --dry-run
//
// --incremental      starts from the cursor of the last recorded run (the last MESSAGE it covered),
//                    so nothing between that message and now is skipped. No cursor yet → needs --since.
// --dry-run          plans the run and prints the coverage; no model call, no write.
// --out=<path>       writes the candidate detail somewhere OUTSIDE this repository. Required for a
//                    real run: the candidates quote family chat, and chat does not go into Git.
// --max-units=<n>    hard ceiling on model calls for this run.
//
// FAILURE RECOVERY. Every unit is independent and the merge is idempotent, so a run that dies
// part-way is resumed by running the same command again: units already covered produce the same
// item ids and create nothing. A run STOPS by itself after 8 consecutive failures rather than
// grinding on, and records itself as `completed_with_failures` so the read layer reports the window
// as partial instead of letting a page call the week clear.
//
// It does not start a scheduler, does not enable the Organizer, and writes no story.
import fs from "node:fs";
import path from "node:path";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb, closePool } from "../lib/db/client.ts";
import * as t from "../lib/db/schema.ts";
import { CANONICAL_PROFILE_ID } from "../lib/db/config.ts";
import { getUpcomingCursor, mergeUpcomingCandidates, recordUpcomingRun } from "../lib/db/upcoming-store.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { resolveSpeaker } from "../lib/organizer/identity.ts";
import { UPCOMING_PROMPT_VERSION, buildUnitPrompt, extractFromUnit } from "../lib/upcoming-extractor.ts";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (name) => args.includes(`--${name}`);

const dryRun = has("dry-run");
const incremental = has("incremental");
const maxUnits = Number(flag("max-units") ?? 0) || Infinity;
const outPath = flag("out");
const profileId = flag("profile") ?? CANONICAL_PROFILE_ID;

if (outPath) {
  const resolved = path.resolve(outPath);
  if (!path.relative(path.resolve(process.cwd(), ".."), resolved).startsWith("..")) {
    console.error("Refusing to write family chat inside the repository. Point --out outside it.");
    process.exit(1);
  }
}
if (!dryRun && !outPath) {
  console.error("A real run needs --out=<path outside the repo> for the candidate detail. Use --dry-run to plan without it.");
  process.exit(1);
}

const db = getDb();
const cursor = incremental ? await getUpcomingCursor({ profileId }) : null;
const since = flag("since") ?? (cursor ? cursor.slice(0, 10) : null);
if (!since) {
  console.error("No cursor recorded yet, so --incremental has nothing to resume from. Pass --since=YYYY-MM-DD.");
  await closePool();
  process.exit(1);
}
console.log(`window from ${since}${cursor ? ` (cursor: last message covered ${cursor})` : ""}${dryRun ? " — DRY RUN" : ""}`);

// ---- what material exists, and how far each conversation really reaches ----
// The day and the clock are computed in SQL, at an explicitly named zone, rather than from the
// driver's string in JavaScript. The day is what 「明天」 is resolved against, so it must not depend
// on the connection's session timezone or on how lenient Date's parser happens to be: bucketing it
// in JS gave a different number of conversation-days than the SQL the extraction actually ran on.
const rows = await db.select({
  id: t.rawSources.id, sourceLabel: t.rawSources.sourceLabel,
  capturedAt: t.rawSources.capturedAt, text: t.rawSources.text, metadata: t.rawSources.metadata,
  mediaIds: t.rawSources.mediaIds,
  day: sql`to_char(${t.rawSources.capturedAt} at time zone 'Asia/Shanghai', 'YYYY-MM-DD')`.as("day"),
  clock: sql`to_char(${t.rawSources.capturedAt} at time zone 'Asia/Shanghai', 'HH24:MI:SS')`.as("clock"),
}).from(t.rawSources).where(and(
  eq(t.rawSources.sourceType, "wechat"),
  isNull(t.rawSources.deletedAt),
  gte(t.rawSources.capturedAt, sql`(${since}::date at time zone 'Asia/Shanghai')`),
)).orderBy(t.rawSources.capturedAt, t.rawSources.sourceLabel, t.rawSources.id);
// The ordering is part of the contract, not a detail. One real message is stored under two
// conversation rows (老苏家 holds ~100 such pairs), and the dedup below keeps whichever copy it
// meets first — so the conversation a folded message is attributed to, and therefore which
// conversation-days exist at all, depends on this ORDER BY. Sorting by source_label as well as time
// makes that attribution the same on every run; without it the same window planned 114
// conversation-days one way and 116 the other, over an identical set of messages.

const speakerOf = (metadata, conversationId) => {
  const digest = String(metadata?.senderDigest ?? "");
  if (!digest) return "未命中";
  const speaker = resolveSpeaker(digest, FAMILY_REGISTRY, { conversationId });
  return speaker.known ? speaker.narrativeLabel : "未命中";
};
const norm = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// A conversation with no registry-confirmed speaker is not approved family material and is not read.
const speakersByConversation = new Map();
for (const row of rows) {
  const who = speakerOf(row.metadata, row.sourceLabel);
  const set = speakersByConversation.get(row.sourceLabel) ?? new Set();
  if (who !== "未命中") set.add(who);
  speakersByConversation.set(row.sourceLabel, set);
}
const inScope = new Set([...speakersByConversation].filter(([, set]) => set.size > 0).map(([label]) => label));

const TIME = "明天|明早|明晚|后天|大后天|今天|今晚|下午|上午|早上|晚上|周一|周二|周三|周四|周五|周六|周日|周末|星期|下周|这周|本周|月底|月初|下个月|国庆|中秋|春节|假期|放假|号那天|日那天";
const ACT = "带|准备|记得|别忘|忘记|需要|要求|麻烦|请各位|通知|交|报名|预约|约|挂号|体检|复查|复诊|打针|疫苗|接种|办|买|取|送|接回|请假|出游|旅游|出行|订|安排|提醒|登记|填|签|报到|入园|开学|面试|拍照|理发|剪";
const SIGNAL = new RegExp(`(${TIME})|(${ACT})`);

const units = new Map();
const coverageByConversation = new Map();
const seen = new Set();
let outOfScope = 0; let duplicates = 0; let lastMessageAt = null;
for (const row of rows) {
  const day = row.day;
  const clock = row.clock;
  if (!lastMessageAt || row.capturedAt > lastMessageAt) lastMessageAt = row.capturedAt;
  const entry = coverageByConversation.get(row.sourceLabel) ?? { conversationRef: String(row.sourceLabel).slice(-12), messagesInWindow: 0, lastMessageAt: null, status: inScope.has(row.sourceLabel) ? "covered" : "out_of_scope", reason: inScope.has(row.sourceLabel) ? undefined : "no registry-confirmed speaker in this conversation" };
  entry.messagesInWindow += 1;
  if (!entry.lastMessageAt || row.capturedAt > entry.lastMessageAt) entry.lastMessageAt = row.capturedAt;
  coverageByConversation.set(row.sourceLabel, entry);
  if (!inScope.has(row.sourceLabel)) { outOfScope += 1; continue; }

  const text = norm(row.text);
  // One real message stored under two conversation rows must not become two todos.
  const key = `${day}|${clock}|${text.slice(0, 60)}`;
  if (text && seen.has(key)) { duplicates += 1; continue; }
  if (text) seen.add(key);

  const unitKey = `${row.sourceLabel}|${day}`;
  const unit = units.get(unitKey) ?? { sourceLabel: row.sourceLabel, shortId: String(row.sourceLabel).slice(-12), day, messages: [], signals: 0 };
  const signal = Boolean(text) && SIGNAL.test(text);
  if (signal) unit.signals += 1;
  unit.messages.push({ id: row.id, t: clock, who: speakerOf(row.metadata, row.sourceLabel), text, media: (row.mediaIds ?? []).length, signal });
  units.set(unitKey, unit);
}

const selected = [...units.values()].filter((unit) => unit.signals > 0)
  .sort((a, b) => a.day.localeCompare(b.day) || a.shortId.localeCompare(b.shortId))
  .slice(0, maxUnits);
const conversations = [...coverageByConversation.values()];

console.log(`${rows.length} messages · ${outOfScope} out of scope · ${duplicates} duplicate rows folded`);
console.log(`${conversations.filter((c) => c.status === "covered").length} conversations covered, ${conversations.filter((c) => c.status === "out_of_scope").length} out of scope`);
console.log(`${units.size} conversation-days, ${selected.length} of them carry something worth reading`);
console.log(`last message covered: ${lastMessageAt ?? "(none)"}`);

if (dryRun) {
  console.log("\nDRY RUN — no model call, nothing written.");
  await closePool();
  process.exit(0);
}

// ---- read each unit, carrying the still-open items forward ----
const batchId = `upcoming-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
const startedAt = new Date().toISOString();
const open = new Map();
const candidates = [];
const failures = [];
let consecutive = 0; let covered = 0;

for (const unit of selected) {
  const carried = [...open.values()].filter((item) => item.status === "open" || item.status === "tentative");
  let output = null; let lastError = null;
  for (let attempt = 0; attempt < 2 && !output; attempt += 1) {
    try { output = await extractFromUnit(buildUnitPrompt(unit, carried)); }
    catch (error) { lastError = String(error?.message ?? error); }
  }
  if (!output) {
    consecutive += 1;
    failures.push({ unit: `${unit.shortId}|${unit.day}`, error: lastError });
    console.error(`FAIL ${unit.shortId} ${unit.day}: ${lastError}`);
    if (consecutive >= 8) { console.error("Stopping: 8 consecutive failures."); break; }
    continue;
  }
  consecutive = 0; covered += 1;

  const localRef = (label) => {
    const match = /^m(\d+)$/.exec(String(label ?? "").trim());
    const message = match ? unit.messages[Number(match[1]) - 1] : null;
    return message ? message.id : null;
  };
  for (const raw of output.items ?? []) {
    const anchor = localRef(raw.anchorMessageId);
    const sourceIds = (raw.sourceMessageIds ?? []).map(localRef).filter(Boolean);
    const title = String(raw.title ?? "").trim();
    if (!title || (!anchor && !sourceIds.length)) { failures.push({ unit: `${unit.shortId}|${unit.day}`, error: "item cited no message that exists" }); continue; }
    const when = raw.when?.kind === "day" || raw.when?.kind === "window" ? raw.when : { kind: "unconfirmed" };
    const item = {
      title, note: raw.note?.trim() || undefined, category: raw.category?.trim() || undefined,
      kind: raw.kind === "plan" ? "plan" : "commitment",
      when,
      whenCertainty: when.kind === "unconfirmed" ? "unconfirmed" : raw.whenBasis ? "resolved_from_message_time" : "stated",
      whenOriginalText: raw.whenOriginalText?.trim() || undefined,
      whenBasis: raw.whenBasis?.trim() || undefined,
      whoAsked: raw.whoAsked?.trim() || undefined,
      anchorSourceId: anchor ?? sourceIds[0],
      sourceIds: [...new Set([anchor, ...sourceIds].filter(Boolean))],
      firstSeenDay: unit.day,
      changes: [],
      _ref: `c${candidates.length + 1}`,
      status: raw.kind === "plan" ? "tentative" : "open",
    };
    open.set(item._ref, item);
    candidates.push(item);
  }
  for (const update of output.statusUpdates ?? []) {
    const target = open.get(update.openItemId);
    const sourceIds = (update.sourceMessageIds ?? []).map(localRef).filter(Boolean);
    if (!target) { failures.push({ unit: `${unit.shortId}|${unit.day}`, error: "status update referenced an unknown item" }); continue; }
    if (!sourceIds.length) { failures.push({ unit: `${unit.shortId}|${unit.day}`, error: "status update cited no message that exists" }); continue; }
    target.changes.push({ day: unit.day, change: update.change, newWhen: update.newWhen, note: update.note?.trim() || undefined, quote: update.quote?.trim() || undefined, sourceIds });
    if (update.change === "done" || update.change === "cancelled") target.status = update.change;
  }
  if (covered % 10 === 0) console.log(`${covered}/${selected.length} units · ${candidates.length} candidates · ${failures.length} failures`);
}

for (const candidate of candidates) { delete candidate._ref; delete candidate.status; }
fs.writeFileSync(path.resolve(outPath), JSON.stringify({ at: new Date().toISOString(), batchId, since, promptVersion: UPCOMING_PROMPT_VERSION, model: process.env.AI_MODEL, candidates, failures }, null, 2));
console.log(`\ncandidate detail written to ${outPath} (outside the repo)`);

const merged = await mergeUpcomingCandidates(candidates, batchId, { profileId });
const run = await recordUpcomingRun({
  batchId, windowFrom: since, windowToMessageAt: lastMessageAt,
  conversations, unitsTotal: selected.length, unitsCovered: covered, unitsFailed: selected.length - covered,
  itemsCreated: merged.created, itemsUpdated: merged.updated, failures,
  promptVersion: UPCOMING_PROMPT_VERSION, model: process.env.AI_MODEL,
  startedAt, finishedAt: new Date().toISOString(),
}, { profileId });

console.log(`\n${run.status}: ${merged.created} created, ${merged.updated} updated, ${merged.unchanged} unchanged, ${merged.changesRecorded} changes recorded`);
if (merged.refused.length) console.log(`refused ${merged.refused.length}:`, merged.refused.slice(0, 5));
console.log(`batch ${batchId} · cursor now ${lastMessageAt}`);
await closePool();
