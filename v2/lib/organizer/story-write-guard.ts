// Organizer write guard: which stories an automatic writer may never touch, decided from the
// ledger itself rather than from anything the caller says about itself.
//
// Why this exists (2026-09-13 incident). The Organizer loop matched 59 already-published stories by
// `organization_fingerprint`, overwrote their title/story/source_ids in place, then appended a
// `needs_human_review` row that took every one of them offline. Its only replay guard was
// `findOrganizerRun`, which reads `organizer_runs` — and stories published through the human
// queue169 / pack route have a fingerprint on `life_events` but no organizer run. So the short-circuit
// saw nothing, and the fingerprint update hit anyway.
//
// The rules here therefore look at the TARGET, never at the writer's claims:
//   1. A story the publication gate currently publishes is protected (same `indexReviewsWithConflicts`
//      + `isEventPublishable` the family pages use, same-instant conflicts included).
//   2. A story that was EVER approved is protected, even if a later automatic row superseded it —
//      that is exactly the shape the incident left behind.
//   3. A story that carries ANY ledger row from a provenance that is not a known automatic producer is
//      protected. This is an allow-list of automatic providers, not a list of human ones: an unknown
//      provider protects (fail closed), because missing one human route would silently re-open the hole.
//   4. A queue169 decision addressed to `fingerprint:<organization_fingerprint>` protects the event
//      with that fingerprint — including one that does not exist yet (an insert is refused too).
//
// `media_subject_check` rows are about a photograph, not a story, and are never read as a story
// decision. `media_binding` rows (`<eventId>|<mediaId>`) are a human decision about this story's
// photographs and do count.
//
// Human decisions do not go through the automatic methods at all. They use
// `recordHumanStoryDecision`, which must be given the content hash the person actually reviewed and
// refuses when the stored story no longer matches it — so an approval of old text can never publish
// new text. `actor: "human"` on an automatic method is rejected: saying "human" is not a credential.
import { createHash } from "node:crypto";
import { indexReviewsWithConflicts, isEventPublishable, type QualityDecision } from "./quality-review";

export type WriteActor = "organizer";

/**
 * Providers whose ledger rows are written by automatic code paths (Organizer adapter, T20-C grader,
 * Memory Editor). Everything else — `human`, `claude-code`, `commander-*`, `data-track-*`,
 * `nianlife-preview`, `cowork-a6`, or any name not seen before — is treated as a human route.
 * Production distribution 2026-09-14: see NianlifeOps GUARD-ledger-shape-2026-09-14T03-12-50.json.
 */
export const AUTOMATIC_REVIEW_PROVIDERS: ReadonlySet<string> = new Set(["deepseek"]);

/** Ledger kinds that are never a decision about a story, even when a target id happens to match. */
const NON_STORY_KINDS: ReadonlySet<string> = new Set(["media_subject_check", "daily_trace", "monthly_snapshot", "monthly_review_draft", "echo_group"]);

/** Kinds an automatic writer might append about a story. All of them are guarded. */
export const STORY_REVIEW_KINDS: ReadonlySet<string> = new Set(["life_event", "life_event_preview", "life_event_queue169", "life_event_trace", "media_binding"]);

export const FINGERPRINT_TARGET_PREFIX = "fingerprint:";

export type LedgerRow = {
  targetKind: string;
  targetId: string;
  decision: string;
  provider: string;
  promptVersion: string;
  reviewedAt?: string | null;
};

export type ProtectableEvent = {
  id: string;
  organizationFingerprint?: string | null;
  createdBy?: string | null;
  organizerVersion?: string | null;
  organizerRun?: { organizerType?: string } | null;
};

export type StoryProtection = { protected: boolean; reasons: string[] };

/** The SQL-side twin of `rowLinksToStory`, so the database read and this filter cannot drift. */
export function storyLinkTargets(eventId: string | null | undefined, fingerprints: Array<string | null | undefined>): { ids: string[]; fingerprintTargets: string[] } {
  const ids = eventId ? [eventId] : [];
  const fingerprintTargets = [...new Set(fingerprints.filter((fp): fp is string => Boolean(fp)).map((fp) => `${FINGERPRINT_TARGET_PREFIX}${fp}`))];
  return { ids, fingerprintTargets };
}

export function rowLinksToStory(row: Pick<LedgerRow, "targetKind" | "targetId">, eventId: string | null | undefined, fingerprints: Array<string | null | undefined>): boolean {
  if (NON_STORY_KINDS.has(row.targetKind)) return false;
  const { ids, fingerprintTargets } = storyLinkTargets(eventId, fingerprints);
  if (row.targetKind === "media_binding") return ids.includes(row.targetId.split("|")[0]);
  return ids.includes(row.targetId) || fingerprintTargets.includes(row.targetId);
}

/**
 * Pure. `rows` may be wider than the story (the caller's SQL is allowed to over-select); only rows
 * that link to this event or fingerprint are considered.
 */
export function evaluateStoryProtection(target: { event?: ProtectableEvent | null; eventId?: string | null; fingerprints?: Array<string | null | undefined> }, rows: readonly LedgerRow[]): StoryProtection {
  const event = target.event ?? null;
  // A ledger row can name an id whose life_event does not exist (yet): it still speaks for that id.
  const eventId = event?.id ?? target.eventId ?? null;
  const fingerprints = [...(target.fingerprints ?? []), event?.organizationFingerprint];
  const linked = rows.filter((row) => rowLinksToStory(row, eventId, fingerprints));
  const reasons = new Set<string>();

  if (event) {
    const lifeEventRows = linked.filter((row) => row.targetKind === "life_event" && row.targetId === event.id);
    const { index, conflicts } = indexReviewsWithConflicts(lifeEventRows.map((row) => ({ ...row, id: "", profileId: "", policyVersion: "", reviewFingerprint: "", reasonCodes: [], reviewedAt: row.reviewedAt ?? undefined })) as never);
    if (isEventPublishable(event as never, index)) reasons.add("PUBLISHED");
    if (conflicts.length) reasons.add("SAME_INSTANT_CONFLICT");
  }
  for (const row of linked) {
    if (row.decision === "approved") reasons.add(`EVER_APPROVED:${row.targetKind}`);
    if (!AUTOMATIC_REVIEW_PROVIDERS.has(row.provider)) reasons.add(`HUMAN_DECISION:${row.targetKind}:${row.provider}:${row.decision}`);
  }
  const list = [...reasons].sort();
  // A same-instant conflict alone is not protection; it is reported beside a real reason.
  const decisive = list.filter((reason) => reason !== "SAME_INSTANT_CONFLICT");
  return { protected: decisive.length > 0, reasons: list };
}

// ---------------------------------------------------------------- content version

/**
 * The exact fields a human approves when approving a story. Order is fixed; values are raw — no
 * trimming, no whitespace folding. `occurredAt` must be the canonical UTC instant with microseconds,
 * `YYYY-MM-DDTHH:MM:SS.ffffffZ`, which SQL reproduces as
 *   to_char((occurred_at::timestamptz) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 * Arrays keep their stored order. The payload is JSON.stringify of a fixed-order array.
 */
export type StoryContent = {
  title: string | null;
  story: string | null;
  occurredAtUtc: string;
  memoryWeight: string;
  sourceIds: string[];
  mediaIds: string[];
  heroMediaId: string | null;
};

export const STORY_CONTENT_HASH_VERSION = "story-content-v1";
export const CONTENT_SHA256_REASON_PREFIX = "content-sha256:";

export function canonicalOccurredAtUtc(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) return value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new StoryWriteContractError("UNPARSEABLE_OCCURRED_AT", `occurredAt "${value}" is not a parseable instant`);
  return new Date(parsed).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

export function storyContentPayload(content: StoryContent): string {
  return JSON.stringify([STORY_CONTENT_HASH_VERSION, content.title ?? null, content.story ?? null, content.occurredAtUtc, content.memoryWeight, content.sourceIds ?? [], content.mediaIds ?? [], content.heroMediaId ?? null]);
}

export function storyContentSha256(content: StoryContent): string {
  return createHash("sha256").update(storyContentPayload(content), "utf8").digest("hex");
}

/** A reason-code list carries a binding only when exactly one well-formed content hash is present. */
export function boundContentSha256(reasonCodes: readonly string[] | null | undefined): string | null {
  const hits = (reasonCodes ?? []).filter((code) => typeof code === "string" && code.startsWith(CONTENT_SHA256_REASON_PREFIX));
  if (hits.length !== 1) return null;
  const hex = hits[0].slice(CONTENT_SHA256_REASON_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

// ---------------------------------------------------------------- errors

export class StoryWriteContractError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = "StoryWriteContractError"; }
}

export class ProtectedStoryWriteError extends Error {
  readonly code = "PROTECTED_STORY";
  constructor(readonly detail: { operation: string; eventId: string | null; organizationFingerprint: string | null; reasons: string[] }) {
    super(`PROTECTED_STORY: ${detail.operation} refused for ${detail.eventId ?? `fingerprint ${detail.organizationFingerprint}`} (${detail.reasons.join(", ")})`);
    this.name = "ProtectedStoryWriteError";
  }
}

export function isProtectedStoryWriteError(error: unknown): error is ProtectedStoryWriteError {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "PROTECTED_STORY" && typeof (error as { detail?: unknown }).detail === "object";
}

/** Automatic persistence methods accept only the organizer actor. Anything else is refused, not upgraded. */
export function assertAutomaticActor(actor: unknown): void {
  if (actor === undefined || actor === "organizer") return;
  throw new StoryWriteContractError("ACTOR_NOT_ACCEPTED", `automatic persistence only accepts actor "organizer" (got ${JSON.stringify(actor)}); human story decisions go through recordHumanStoryDecision with the reviewed content hash`);
}

/**
 * An automatic writer may never publish, and may never write a story row under a provenance that
 * reads as a human route (that would forge protection evidence, and blur the ledger's audit trail).
 */
export function assertNotAutomaticApproval(review: { targetKind: string; decision: string; provider?: string }): void {
  if (!STORY_REVIEW_KINDS.has(review.targetKind)) return;
  if (review.decision === "approved") {
    throw new StoryWriteContractError("AUTOMATIC_APPROVAL_FORBIDDEN", `an automatic writer may not write decision "approved" on ${review.targetKind}`);
  }
  if (review.provider !== undefined && !AUTOMATIC_REVIEW_PROVIDERS.has(review.provider)) {
    throw new StoryWriteContractError("PROVIDER_NOT_AUTOMATIC", `an automatic writer may not record provider "${review.provider}" on ${review.targetKind}`);
  }
}

// ---------------------------------------------------------------- human decisions

export type HumanStoryDecisionInput = {
  eventId: string;
  decision: QualityDecision;
  /** sha256 of `storyContentPayload` for the version the person actually read. Required. */
  reviewedContentSha256: string;
  /** Recorded as `provider`. Must not be an automatic provider name. */
  operator: string;
  promptVersion: string;
  policyVersion: string;
  reasonCodes?: string[];
};

export function assertHumanDecisionInput(input: HumanStoryDecisionInput): void {
  if (!input.eventId) throw new StoryWriteContractError("MISSING_EVENT", "eventId is required");
  if (!/^[0-9a-f]{64}$/.test(input.reviewedContentSha256 ?? "")) throw new StoryWriteContractError("MISSING_REVIEWED_CONTENT_HASH", "reviewedContentSha256 must be the 64-hex sha256 of the reviewed story content");
  if (!input.operator || AUTOMATIC_REVIEW_PROVIDERS.has(input.operator)) throw new StoryWriteContractError("OPERATOR_NOT_HUMAN", `operator "${input.operator}" is empty or an automatic provider`);
  if (!input.promptVersion || !input.policyVersion) throw new StoryWriteContractError("MISSING_VERSION", "promptVersion and policyVersion are required");
  if ((input.reasonCodes ?? []).some((code) => code.startsWith(CONTENT_SHA256_REASON_PREFIX))) throw new StoryWriteContractError("REASON_CODE_RESERVED", `reason codes may not carry their own ${CONTENT_SHA256_REASON_PREFIX} entry`);
}
