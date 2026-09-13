// 近期待办 — the only place todo rows are written, merged and read.
//
// Deliberately NOT on the Repository facade. This is a new, narrow path with one reader
// (the front page) and one writer (the extractor), and routing it through the facade would mean
// widening the interface and the JSON backend for a feature neither of them has. The JSON backend
// (credential-less local dev) simply has no upcoming data, and the read below reports that as
// `not_extracted`, which is the truthful answer rather than a missing method.
//
// THREE RULES LIVE IN CODE HERE, not in a doc:
//
//   1. A re-run of the same window creates nothing new. The id is derived from the message the
//      item was first recognised in, so the same commitment extracted twice is the same row
//      (`upcomingItemId`). Second-guessing that with fuzzy title matching would merge two real
//      trips discussed on the same day; `mergeKeyOf` is deliberately narrow — see its comment.
//   2. A strikethrough cannot come from silence. `done`, `rescheduled` and `cancelled` are refused
//      unless the caller supplies the message that proves the change (`statusNeedsEvidence`).
//      A date that has passed writes nothing here.
//   3. "No rows" is four different answers. `readUpcomingFeed` never collapses them — see
//      lib/upcoming-contract.ts.
import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "./client";
import * as t from "./schema";
import { CANONICAL_PROFILE_ID } from "./config";
import {
  isUpcomingDay,
  statusNeedsEvidence,
  type UpcomingChange,
  type UpcomingFeedResult,
  type UpcomingItemRecord,
  type UpcomingKind,
  type UpcomingSourceCoverage,
  type UpcomingStatus,
  type UpcomingWhen,
  type UpcomingWhenCertainty,
} from "@/lib/upcoming-contract";
// The rules themselves live next door, with no database in them, so each one is a test.
import {
  assertFamilySafeProvenance,
  buildUpcomingProvenance,
  type CuratedProvenance,
  type UpcomingProvenance,
} from "@/lib/upcoming-provenance";
import {
  familyFeedFrom,
  mergeKeyOf,
  resolveUpcomingStatus,
  upcomingFeedFrom,
  upcomingItemId,
  type UpcomingCandidate,
} from "@/lib/upcoming-merge";

export type { UpcomingCandidate } from "@/lib/upcoming-merge";
export { mergeKeyOf, upcomingItemId } from "@/lib/upcoming-merge";

/** A caller may pass its own connection — a drizzle transaction, for instance. The validation
 *  harness uses this to exercise the whole chain inside a transaction it then rolls back, so the
 *  SQL is proven without a migration ever being run on the live database. */
export type UpcomingDb = Pick<ReturnType<typeof getDb>, "select" | "insert" | "update">;
const dbFor = (options: { db?: UpcomingDb; env?: NodeJS.ProcessEnv }) => options.db ?? getDb(options.env);

/** Postgres says 42P01 when a relation does not exist. That is "the migration has not been run
 *  here yet" — a different answer from "the read broke", and a very different one from
 *  "the family has nothing to do".
 *
 *  It walks the cause chain because the query builder wraps the driver's error: checking only the
 *  top-level `code` reported a missing table as `read_failed`, which is exactly the confusion this
 *  whole feed exists to prevent. Caught by the validation harness on 2026-09-12. */
const isMissingTable = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === "object" && (current as { code?: string }).code === "42P01") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

const whenToColumns = (when: UpcomingWhen) => ({
  whenKind: when.kind,
  whenFrom: when.kind === "day" ? when.day : when.kind === "window" ? when.fromDay : null,
  whenTo: when.kind === "window" ? when.toDay : null,
});

const whenFromColumns = (row: { whenKind: string; whenFrom: string | null; whenTo: string | null }): UpcomingWhen => {
  if (row.whenKind === "day" && isUpcomingDay(row.whenFrom)) return { kind: "day", day: row.whenFrom };
  if (row.whenKind === "window" && isUpcomingDay(row.whenFrom) && isUpcomingDay(row.whenTo)) return { kind: "window", fromDay: row.whenFrom, toDay: row.whenTo };
  return { kind: "unconfirmed" };
};

const STATUS_FOR_CHANGE: Record<string, UpcomingStatus> = {
  restated: "open", rescheduled: "rescheduled", cancelled: "cancelled", done: "done",
};

export type UpcomingMergeResult = {
  created: number;
  updated: number;
  unchanged: number;
  changesRecorded: number;
  /** Candidates refused, with the reason. A refusal is never silent. */
  refused: Array<{ title: string; reason: string }>;
  itemIds: string[];
};

/**
 * Merge a batch of candidates into the store. Idempotent: running the same batch twice produces
 * `created: 0` the second time and the same item ids.
 */
export async function mergeUpcomingCandidates(
  candidates: UpcomingCandidate[],
  batchId: string,
  options: { profileId?: string; now?: string; env?: NodeJS.ProcessEnv; db?: UpcomingDb } = {},
): Promise<UpcomingMergeResult> {
  const db = dbFor(options);
  const profileId = options.profileId ?? CANONICAL_PROFILE_ID;
  const now = options.now ?? new Date().toISOString();
  const result: UpcomingMergeResult = { created: 0, updated: 0, unchanged: 0, changesRecorded: 0, refused: [], itemIds: [] };

  // One read of everything this profile already has. The table holds tens of rows, not tens of
  // thousands, so this is a small query and not a getStore()-shaped one.
  const existingRows = await db.select().from(t.upcomingItems).where(eq(t.upcomingItems.profileId, profileId));
  const byId = new Map(existingRows.map((row) => [row.id, row]));
  const byMergeKey = new Map<string, typeof existingRows[number]>();
  for (const row of existingRows) {
    const key = mergeKeyOf(profileId, row.title, whenFromColumns(row));
    if (key && !byMergeKey.has(key)) byMergeKey.set(key, row);
  }

  for (const candidate of candidates) {
    const title = candidate.title.trim();
    if (!title) { result.refused.push({ title: candidate.title, reason: "empty title" }); continue; }
    if (!candidate.anchorSourceId) { result.refused.push({ title, reason: "no anchor message" }); continue; }

    const id = upcomingItemId(profileId, candidate.anchorSourceId, title);
    const mergeKey = mergeKeyOf(profileId, title, candidate.when);
    const existing = byId.get(id) ?? (mergeKey ? byMergeKey.get(mergeKey) : undefined);

    // Every rule about what the evidence supports lives in lib/upcoming-merge.ts, with no database
    // in it, so it can be tested directly. This layer only stores what it decides.
    const resolved = resolveUpcomingStatus(candidate);
    const { status, when, statusNote, statusEvidenceDay } = resolved;
    const changes: UpcomingChange[] = resolved.changes.map((change) => ({ ...change, at: now, batchId }));
    for (const refusal of resolved.refusals) result.refused.push({ title, reason: refusal.reason });

    const sourceIds = [...new Set([candidate.anchorSourceId, ...candidate.sourceIds])];
    const row = {
      id: existing?.id ?? id,
      profileId,
      title,
      note: candidate.note ?? null,
      category: candidate.category ?? null,
      kind: candidate.kind,
      status,
      ...whenToColumns(when),
      whenCertainty: candidate.whenCertainty,
      whenOriginalText: candidate.whenOriginalText ?? null,
      whenBasis: candidate.whenBasis ?? null,
      whoAsked: candidate.whoAsked ?? null,
      anchorSourceId: candidate.anchorSourceId,
      sourceIds,
      statusNote: statusNote ?? null,
      // What a reader can open: the month the commitment was made in. Never chat text, and never a
      // raw message id — those stay in `sourceIds`, which no page projection reads.
      evidence: { day: candidate.firstSeenDay },
      statusEvidence: statusEvidenceDay ? { day: statusEvidenceDay } : null,
      supersedes: existing ? (existing.supersedes ?? []) : [],
      extractionBatchId: batchId,
      updatedAt: now,
    };

    if (!existing) {
      await db.insert(t.upcomingItems).values({ ...row, firstSeenAt: now });
      result.created += 1;
      // Register it immediately, or a second candidate for the SAME commitment later in this very
      // batch will not find it and will insert a duplicate. The daycare group and the小群 both
      // carried 「带尿不湿」 for 2026-09-09 on 2026-09-08, and the first version of this loop — which
      // only indexed rows that existed before the batch started — stored both.
      const inserted = { ...row, firstSeenAt: now, supersedes: row.supersedes ?? [] } as unknown as typeof existingRows[number];
      byId.set(row.id, inserted);
      if (mergeKey) byMergeKey.set(mergeKey, inserted);
    } else {
      // A second sighting of the same commitment from a different message folds in rather than
      // duplicating, and `supersedes` remembers it so the page can show 「说了三次」 without printing
      // it three times.
      //
      // It stores the ITEM ID the folded sighting would have had — never the raw message id.
      // The first version stored the anchor message id, and since `supersedes` is one of the fields
      // that crosses to the page, that put `wechat-message:canonical:…` into the front-page payload.
      // Caught by the validation harness on 2026-09-12.
      const foldedId = existing.anchorSourceId !== candidate.anchorSourceId ? id : null;
      const supersedes = [...new Set([...(existing.supersedes ?? []), ...(foldedId && foldedId !== existing.id ? [foldedId] : [])])];
      const mergedSources = [...new Set([...(existing.sourceIds ?? []), ...sourceIds])];
      // A row already read and approved by a human keeps its decision; the extractor never
      // upgrades or downgrades a review.
      await db.update(t.upcomingItems).set({
        ...row,
        id: existing.id,
        anchorSourceId: existing.anchorSourceId,
        sourceIds: mergedSources,
        supersedes,
        // Never regress a status that already has evidence back to open just because this batch
        // re-saw the original request.
        status: statusNeedsEvidence(existing.status as UpcomingStatus) && !statusEvidenceDay ? existing.status : row.status,
        statusNote: statusNeedsEvidence(existing.status as UpcomingStatus) && !statusEvidenceDay ? existing.statusNote : row.statusNote,
        statusEvidence: statusNeedsEvidence(existing.status as UpcomingStatus) && !statusEvidenceDay ? existing.statusEvidence : row.statusEvidence,
      }).where(eq(t.upcomingItems.id, existing.id));
      const same = existing.title === row.title && existing.status === row.status
        && existing.whenKind === row.whenKind && existing.whenFrom === row.whenFrom && existing.whenTo === row.whenTo
        && (existing.sourceIds ?? []).length === mergedSources.length;
      if (same) result.unchanged += 1; else result.updated += 1;
    }

    const itemId = existing?.id ?? id;
    result.itemIds.push(itemId);
    for (const change of changes) {
      // The same change seen again in a re-run is the same row (unique on item+day+change).
      await db.insert(t.upcomingItemChanges).values({
        id: `upchg-${sha(`${itemId}|${change.day}|${change.change}`).slice(0, 20)}`,
        itemId, day: change.day, change: change.change,
        fromStatus: change.fromStatus ?? null, toStatus: change.toStatus,
        fromWhen: change.fromWhen as unknown as Record<string, string>,
        toWhen: change.toWhen as unknown as Record<string, string>,
        note: change.note ?? null, quote: change.quote ?? null,
        sourceIds: change.sourceIds, batchId,
      }).onConflictDoNothing();
      result.changesRecorded += 1;
    }
  }
  return result;
}

export type UpcomingRunInput = {
  batchId: string;
  windowFrom: string;
  /** The newest MESSAGE covered. Never a run clock. */
  windowToMessageAt: string | null;
  conversations: UpcomingSourceCoverage[];
  unitsTotal: number;
  unitsCovered: number;
  unitsFailed: number;
  itemsCreated: number;
  itemsUpdated: number;
  failures: Array<Record<string, unknown>>;
  promptVersion: string;
  model?: string;
  startedAt: string;
  finishedAt: string;
};

export async function recordUpcomingRun(input: UpcomingRunInput, options: { profileId?: string; env?: NodeJS.ProcessEnv; db?: UpcomingDb } = {}) {
  const db = dbFor(options);
  const status = input.unitsFailed === 0 ? "completed" : input.unitsCovered === 0 ? "failed" : "completed_with_failures";
  await db.insert(t.upcomingExtractionRuns).values({
    id: input.batchId,
    profileId: options.profileId ?? CANONICAL_PROFILE_ID,
    windowFrom: input.windowFrom,
    windowToMessageAt: input.windowToMessageAt,
    // Where an incremental run picks up: the last message covered, so nothing between that message
    // and the next run is skipped.
    cursorLastMessageAt: input.windowToMessageAt,
    status,
    conversations: input.conversations as unknown as Array<Record<string, unknown>>,
    unitsTotal: input.unitsTotal, unitsCovered: input.unitsCovered, unitsFailed: input.unitsFailed,
    itemsCreated: input.itemsCreated, itemsUpdated: input.itemsUpdated,
    failures: input.failures,
    promptVersion: input.promptVersion, model: input.model ?? null,
    startedAt: input.startedAt, finishedAt: input.finishedAt,
  }).onConflictDoNothing();
  return { batchId: input.batchId, status };
}

/** Where the next incremental run should start reading, or null if nothing has run.
 *
 *  A missing table is null, not an exception: before the migration is applied there is simply no
 *  cursor, and an incremental run should start from its configured window rather than crash. */
export async function getUpcomingCursor(options: { profileId?: string; env?: NodeJS.ProcessEnv; db?: UpcomingDb } = {}): Promise<string | null> {
  const db = dbFor(options);
  try {
    const rows = await db.select({ cursor: t.upcomingExtractionRuns.cursorLastMessageAt })
      .from(t.upcomingExtractionRuns)
      .where(eq(t.upcomingExtractionRuns.profileId, options.profileId ?? CANONICAL_PROFILE_ID))
      .orderBy(asc(t.upcomingExtractionRuns.startedAt));
    const done = rows.map((row) => row.cursor).filter((value): value is string => Boolean(value));
    return done.length ? done[done.length - 1] : null;
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

function recordOf(row: typeof t.upcomingItems.$inferSelect, changes: UpcomingChange[]): UpcomingItemRecord {
  return {
    id: row.id,
    title: row.title,
    note: row.note ?? undefined,
    when: whenFromColumns(row),
    status: row.status as UpcomingStatus,
    evidence: (row.evidence as { eventId?: string; day?: string } | null) ?? undefined,
    statusNote: row.statusNote ?? undefined,
    statusEvidence: (row.statusEvidence as { eventId?: string; day?: string } | null) ?? undefined,
    supersedes: row.supersedes ?? [],
    profileId: row.profileId,
    kind: row.kind as UpcomingKind,
    category: row.category ?? undefined,
    whenCertainty: row.whenCertainty as UpcomingWhenCertainty,
    whenOriginalText: row.whenOriginalText ?? undefined,
    whenBasis: row.whenBasis ?? undefined,
    whoAsked: row.whoAsked ?? undefined,
    anchorSourceId: row.anchorSourceId,
    sourceIds: row.sourceIds ?? [],
    changes,
    extractionBatchId: row.extractionBatchId,
    firstSeenAt: row.firstSeenAt,
    updatedAt: row.updatedAt,
    reviewDecision: row.reviewDecision as UpcomingItemRecord["reviewDecision"],
    visibility: row.visibility as UpcomingItemRecord["visibility"],
  };
}

export type ReadUpcomingOptions = {
  profileId?: string;
  env?: NodeJS.ProcessEnv;
  db?: UpcomingDb;
  /** Which review decisions may reach the caller. Defaults to everything, because hiding
   *  unreviewed rows by default would make a working feed indistinguishable from a broken one —
   *  the caller is told how many are unreviewed instead. */
  decisions?: Array<UpcomingItemRecord["reviewDecision"]>;
  includePrivate?: boolean;
};

/** The four-state read. See lib/upcoming-contract.ts for why it is four and not two. */
export async function readUpcomingFeed(options: ReadUpcomingOptions = {}): Promise<UpcomingFeedResult> {
  const profileId = options.profileId ?? CANONICAL_PROFILE_ID;
  let db: UpcomingDb;
  try { db = dbFor(options); }
  catch (error) { return { state: "read_failed", reason: "no database connection is configured", error: String((error as Error)?.message ?? error) }; }

  let runRows: Array<typeof t.upcomingExtractionRuns.$inferSelect>;
  try {
    runRows = await db.select().from(t.upcomingExtractionRuns)
      .where(eq(t.upcomingExtractionRuns.profileId, profileId))
      .orderBy(asc(t.upcomingExtractionRuns.startedAt));
  } catch (error) {
    if (isMissingTable(error)) return { state: "not_extracted", reason: "the upcoming tables do not exist in this database yet" };
    return { state: "read_failed", reason: "could not read the extraction runs", error: String((error as Error)?.message ?? error) };
  }
  if (!runRows.length) return { state: "not_extracted", reason: "no extraction run has been recorded for this profile" };

  let itemRows: Array<typeof t.upcomingItems.$inferSelect>;
  try {
    const decisions = options.decisions ?? ["needs_human_review", "approved"];
    itemRows = await db.select().from(t.upcomingItems)
      .where(and(eq(t.upcomingItems.profileId, profileId), inArray(t.upcomingItems.reviewDecision, decisions)));
  } catch (error) {
    if (isMissingTable(error)) return { state: "not_extracted", reason: "the upcoming tables do not exist in this database yet" };
    return { state: "read_failed", reason: "could not read the upcoming items", error: String((error as Error)?.message ?? error) };
  }

  let changeRows: Array<typeof t.upcomingItemChanges.$inferSelect> = [];
  if (itemRows.length) {
    try {
      changeRows = await db.select().from(t.upcomingItemChanges)
        .where(inArray(t.upcomingItemChanges.itemId, itemRows.map((row) => row.id)))
        .orderBy(asc(t.upcomingItemChanges.day));
    } catch (error) {
      if (!isMissingTable(error)) return { state: "read_failed", reason: "could not read the status-change evidence", error: String((error as Error)?.message ?? error) };
    }
  }

  const changesByItem = new Map<string, UpcomingChange[]>();
  for (const row of changeRows) {
    const list = changesByItem.get(row.itemId) ?? [];
    list.push({
      at: row.createdAt, day: row.day, change: row.change as UpcomingChange["change"],
      fromStatus: (row.fromStatus ?? undefined) as UpcomingStatus | undefined,
      toStatus: row.toStatus as UpcomingStatus,
      fromWhen: row.fromWhen as unknown as UpcomingWhen | undefined,
      toWhen: row.toWhen as unknown as UpcomingWhen | undefined,
      note: row.note ?? undefined, quote: row.quote ?? undefined,
      sourceIds: row.sourceIds ?? [], batchId: row.batchId,
    });
    changesByItem.set(row.itemId, list);
  }

  // Which of the four answers this is, and the sort, are decided in lib/upcoming-merge.ts.
  return upcomingFeedFrom({
    runs: runRows.map((row) => ({
      id: row.id, windowFrom: row.windowFrom, windowToMessageAt: row.windowToMessageAt,
      startedAt: row.startedAt, status: row.status, conversations: row.conversations,
      unitsTotal: row.unitsTotal, unitsCovered: row.unitsCovered, unitsFailed: row.unitsFailed,
    })),
    records: itemRows.map((row) => recordOf(row, changesByItem.get(row.id) ?? [])),
    includePrivate: options.includePrivate,
  });
}

/**
 * The read a family page must use. It fixes `decisions` to `approved` so a caller cannot forget to
 * filter, and it never reports an approved-empty archive as `no_items`.
 *
 * That second part is the point. If rows exist but none has been read by a person, "no items" would
 * license the page to say 「已检查，没有待办」 — a claim about the family's week resting on a queue
 * nobody has looked at. So this returns `not_extracted`, whose contract is "render nothing", with a
 * reason that says plainly what is really going on. The count is still available to a reviewer
 * through readUpcomingFeed() / readUpcomingRecords(), which see every status.
 */
export async function readUpcomingFeedForFamily(options: Omit<ReadUpcomingOptions, "decisions" | "includePrivate"> = {}): Promise<UpcomingFeedResult> {
  const approved = await readUpcomingFeed({ ...options, decisions: ["approved"] });
  if (approved.state !== "no_items") return approved;
  const everything = await readUpcomingFeed({ ...options, decisions: ["needs_human_review", "approved"] });
  return familyFeedFrom(approved, everything.state === "ready" ? everything.items.length : 0);
}

/**
 * Record a human's review decision. THE REVIEWER'S PATH, and the only way a row becomes `approved`.
 *
 * Deliberately separate from mergeUpcomingCandidates, which never writes this column at all: an
 * extraction re-run must not be able to approve anything, and must not be able to undo an approval
 * either. It touches nothing else — not the status, not the evidence, not the dates. Approving a
 * finished item leaves it finished, with the message that proved it still attached.
 */
export async function setUpcomingReviewDecision(
  itemIds: string[],
  decision: UpcomingItemRecord["reviewDecision"],
  options: { profileId?: string; env?: NodeJS.ProcessEnv; db?: UpcomingDb; now?: string } = {},
): Promise<{ updated: number; ids: string[] }> {
  if (!itemIds.length) return { updated: 0, ids: [] };
  if (decision !== "approved" && decision !== "rejected" && decision !== "needs_human_review") {
    throw new Error(`setUpcomingReviewDecision: refusing unknown decision "${decision}"`);
  }
  const db = dbFor(options);
  const rows = await db.update(t.upcomingItems)
    .set({ reviewDecision: decision, updatedAt: options.now ?? new Date().toISOString() })
    .where(and(
      eq(t.upcomingItems.profileId, options.profileId ?? CANONICAL_PROFILE_ID),
      inArray(t.upcomingItems.id, itemIds),
    ))
    .returning({ id: t.upcomingItems.id });
  return { updated: rows.length, ids: rows.map((row) => row.id) };
}

/**
 * The family-facing source projection: who raised each approved item, and what became of it.
 *
 * Curated summaries are passed in rather than read from a table, because there is no table for
 * them yet and there deliberately is not one until the commander has reviewed each line. With none
 * supplied every item comes back `pending_review`, which the page must render as 「来源摘要待审核」
 * — NOT as "this item has no source". Those are different sentences and only one of them is true.
 *
 * It reads only `approved` items, so an unreviewed todo cannot leak a summary either.
 */
export async function readUpcomingProvenanceForFamily(
  options: ReadUpcomingOptions & { curated?: CuratedProvenance[] } = {},
): Promise<UpcomingProvenance[]> {
  const records = (await readUpcomingRecords(options)).filter((record) => record.reviewDecision === "approved");
  const curatedById = new Map((options.curated ?? []).map((entry) => [entry.itemId, entry]));
  const items = records.map((record) => buildUpcomingProvenance(record, curatedById.get(record.id)));
  // Last gate before it leaves: no internal identifier of any kind in the payload.
  assertFamilySafeProvenance(items);
  return items;
}

/** The same read with provenance attached, for a reviewer or a script — never for a page. */
export async function readUpcomingRecords(options: ReadUpcomingOptions = {}): Promise<UpcomingItemRecord[]> {
  const db = dbFor(options);
  const profileId = options.profileId ?? CANONICAL_PROFILE_ID;
  const itemRows = await db.select().from(t.upcomingItems).where(eq(t.upcomingItems.profileId, profileId));
  if (!itemRows.length) return [];
  const changeRows = await db.select().from(t.upcomingItemChanges)
    .where(inArray(t.upcomingItemChanges.itemId, itemRows.map((row) => row.id)))
    .orderBy(asc(t.upcomingItemChanges.day));
  const byItem = new Map<string, UpcomingChange[]>();
  for (const row of changeRows) {
    const list = byItem.get(row.itemId) ?? [];
    list.push({
      at: row.createdAt, day: row.day, change: row.change as UpcomingChange["change"],
      fromStatus: (row.fromStatus ?? undefined) as UpcomingStatus | undefined,
      toStatus: row.toStatus as UpcomingStatus,
      fromWhen: row.fromWhen as unknown as UpcomingWhen | undefined,
      toWhen: row.toWhen as unknown as UpcomingWhen | undefined,
      note: row.note ?? undefined, quote: row.quote ?? undefined,
      sourceIds: row.sourceIds ?? [], batchId: row.batchId,
    });
    byItem.set(row.itemId, list);
  }
  return itemRows.map((row) => recordOf(row, byItem.get(row.id) ?? []));
}
