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

/**
 * 2026-09-16：Claude 审核是一个**独立的审核者类型**，既不是自动写手，也不是家庭人工决定。
 *
 * 为什么要单列：Teddy 本轮授权「由 Claude 实际审核，通过后直接发布」，同时要求「不得把机器决定
 * 塞进人工签名字段」「明确区分 Claude 决定与家庭人工决定」。在这之前账本里只有两类：
 * `deepseek`（自动）和其余一切（被当成人工）。如果 Claude 的决定用任何别的名字写进去，
 * 守卫就会把它算成家庭人工决定——既冒充了人，又让以后真正的人工决定无法辨认它。
 *
 * 所以：
 *   · `claude-review` 只能经由 recordClaudeStoryDecision / recordClaudeMediaDecision 写入；
 *     人工入口 recordHumanStoryDecision 拒收这个 operator。
 *   · 它和人工决定一样，让故事免受**自动写手**覆盖（Claude 读过并批准的正文不该被 Organizer 改写）。
 *   · 但它**不能**覆盖一条家庭人工决定：Claude 入口遇到最新决定来自人工，直接拒绝。
 *   · 历史上的 `claude-code`（257 行，2026-09-16 前）不属于这个类型，仍按原规则当人工处理——
 *     它们是当时以人工流程名义写入的，本轮不改写历史记录的归属。
 */
export const CLAUDE_REVIEW_PROVIDER = "claude-review";
/** Claude 审核行必须带上的授权依据。写进 reason_codes，查账时一眼可见。 */
export const CLAUDE_AUTHORIZATION_REASON = "authorized-by:teddy-2026-09-16";
export type ReviewerType = "automatic" | "claude" | "human";
export function reviewerTypeOf(provider: string | null | undefined): ReviewerType {
  if (provider && AUTOMATIC_REVIEW_PROVIDERS.has(provider)) return "automatic";
  if (provider === CLAUDE_REVIEW_PROVIDER) return "claude";
  return "human";
}

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
    const reviewer = reviewerTypeOf(row.provider);
    if (reviewer === "claude") reasons.add(`CLAUDE_DECISION:${row.targetKind}:${row.decision}`);
    else if (reviewer === "human") reasons.add(`HUMAN_DECISION:${row.targetKind}:${row.provider}:${row.decision}`);
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
/** A fingerprint of the requested changes, stored per-review to enable true idempotency comparison. */
export const REQUEST_FINGERPRINT_REASON_PREFIX = "request-fingerprint:";
/** Atomically records the full before-state (title, story, people) for restoration from the review. */
export const REVISION_BEFORE_REASON_PREFIX = "revision-before:";

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

/**
 * Canonical fingerprint of the patch requested in a ClaudeStoryCorrectionInput.
 * Stored as `request-fingerprint:<hex>` so a true retry (same patch) is distinguished
 * from a different-patch retry under the same promptVersion.
 *
 * Field presence is encoded explicitly so that omitted (keep-existing) and explicit null
 * (clear the field) produce DIFFERENT fingerprints. A sentinel string "__omitted__" marks
 * fields not present in the input.
 */
const FP_OMITTED = "__omitted__";
export function computeRequestFingerprint(input: { newTitle?: string | null; newStory?: string | null; newPeople?: string[]; policyVersion: string }): string {
  const payload = JSON.stringify({
    newTitle: input.newTitle !== undefined ? (input.newTitle ?? null) : FP_OMITTED,
    newStory: input.newStory !== undefined ? (input.newStory ?? null) : FP_OMITTED,
    newPeople: input.newPeople !== undefined ? [...input.newPeople].sort() : FP_OMITTED,
    policyVersion: input.policyVersion,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/** Extracts the stored request fingerprint from a reason-code list, if present. */
export function boundRequestFingerprint(reasonCodes: readonly string[] | null | undefined): string | null {
  const hits = (reasonCodes ?? []).filter((code) => typeof code === "string" && code.startsWith(REQUEST_FINGERPRINT_REASON_PREFIX));
  if (hits.length !== 1) return null;
  const hex = hits[0].slice(REQUEST_FINGERPRINT_REASON_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

// ---------------------------------------------------------------- errors

export class StoryWriteContractError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = "StoryWriteContractError"; }
}

export class ProtectedStoryWriteError extends Error {
  readonly code = "PROTECTED_STORY";
  /**
   * `affectedEventIds` names the protected stories that were actually in the way. For a direct hit
   * it is empty (the target itself is protected); for a shared source or photograph (2026-09-14 P1:
   * a write to one story re-pointing or clearing another story's raw_sources.related_life_event_id /
   * media.life_event_id) it lists the other, protected stories.
   */
  constructor(readonly detail: { operation: string; eventId: string | null; organizationFingerprint: string | null; reasons: string[]; affectedEventIds?: string[] }) {
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
  if (input.operator === CLAUDE_REVIEW_PROVIDER) throw new StoryWriteContractError("OPERATOR_NOT_HUMAN", `operator "${CLAUDE_REVIEW_PROVIDER}" is not a human; Claude decisions go through recordClaudeStoryDecision`);
  if (!input.promptVersion || !input.policyVersion) throw new StoryWriteContractError("MISSING_VERSION", "promptVersion and policyVersion are required");
  if ((input.reasonCodes ?? []).some((code) => code.startsWith(CONTENT_SHA256_REASON_PREFIX))) throw new StoryWriteContractError("REASON_CODE_RESERVED", `reason codes may not carry their own ${CONTENT_SHA256_REASON_PREFIX} entry`);
}


// ---------------------------------------------------------------- Claude review decisions (2026-09-16)

export type ClaudeStoryDecisionInput = {
  eventId: string;
  decision: QualityDecision;
  /** sha256 of `storyContentPayload` for the version Claude actually read against its sources. */
  reviewedContentSha256: string;
  promptVersion: string;
  policyVersion: string;
  /** 必须含 CLAUDE_AUTHORIZATION_REASON；其余写审核依据（主体、日期、来源核对结果、暂缓原因）。 */
  reasonCodes: string[];
};

/**
 * Input for a versioned story content correction (applies diff to story text and/or people field,
 * then records a review binding the new content hash).  Must not be used when a human decision
 * exists on the target event.
 */
export type ClaudeStoryCorrectionInput = {
  eventId: string;
  /** sha256 of the CURRENT stored content — StaleReviewContent if this doesn't match. */
  currentContentSha256: string;
  /** If undefined, keep existing value. */
  newTitle?: string | null;
  /** If undefined, keep existing value. */
  newStory?: string | null;
  /** If undefined, keep existing people. */
  newPeople?: string[];
  promptVersion: string;
  policyVersion: string;
  /** Must include CLAUDE_AUTHORIZATION_REASON and at least one correction:* code. */
  reasonCodes: string[];
};

export function assertClaudeStoryCorrectionInput(input: ClaudeStoryCorrectionInput): void {
  if (!input.eventId) throw new StoryWriteContractError("MISSING_EVENT", "eventId is required");
  if (!/^[0-9a-f]{64}$/.test(input.currentContentSha256 ?? ""))
    throw new StoryWriteContractError("MISSING_CONTENT_HASH", "currentContentSha256 must be a 64-hex sha256");
  if (!input.promptVersion || !input.policyVersion)
    throw new StoryWriteContractError("MISSING_VERSION", "promptVersion and policyVersion are required");
  assertClaudeReasonCodes(input.reasonCodes);
  if (!input.reasonCodes.some((c) => c.startsWith("correction:")))
    throw new StoryWriteContractError("MISSING_CORRECTION_CODE", "reasonCodes must include a correction:* code describing what was fixed");
  const RESERVED_PREFIXES = [CONTENT_SHA256_REASON_PREFIX, REQUEST_FINGERPRINT_REASON_PREFIX, REVISION_BEFORE_REASON_PREFIX];
  for (const prefix of RESERVED_PREFIXES) {
    if (input.reasonCodes.some((c) => c.startsWith(prefix)))
      throw new StoryWriteContractError("REASON_CODE_RESERVED", `caller must not supply ${prefix}; it is computed and appended by applyClaudeStoryCorrection`);
  }
}

export function assertClaudeStoryDecisionInput(input: ClaudeStoryDecisionInput): void {
  if (!input.eventId) throw new StoryWriteContractError("MISSING_EVENT", "eventId is required");
  if (!/^[0-9a-f]{64}$/.test(input.reviewedContentSha256 ?? "")) throw new StoryWriteContractError("MISSING_REVIEWED_CONTENT_HASH", "reviewedContentSha256 must be the 64-hex sha256 of the reviewed story content");
  if (!input.promptVersion || !input.policyVersion) throw new StoryWriteContractError("MISSING_VERSION", "promptVersion and policyVersion are required");
  assertClaudeReasonCodes(input.reasonCodes);
}

export type ClaudeMediaDecisionInput = {
  mediaId: string;
  decision: QualityDecision;
  /** 被审核时这张图的内容版本（资产 checksum，缺失时见 mediaContentVersion）。 */
  reviewedContentVersion: string;
  promptVersion: string;
  policyVersion: string;
  /** 必须含 CLAUDE_AUTHORIZATION_REASON，以及 kind:/subject:/use:/sensitive: 四类分类码。 */
  reasonCodes: string[];
};

export const MEDIA_CONTENT_VERSION_REASON_PREFIX = "content-version:";
const MEDIA_CLASSIFIERS = ["kind:", "subject:", "use:", "sensitive:"] as const;

export function assertClaudeMediaDecisionInput(input: ClaudeMediaDecisionInput): void {
  if (!input.mediaId || input.mediaId.includes("|")) throw new StoryWriteContractError("MISSING_MEDIA", "mediaId is required and names one picture");
  if (!input.reviewedContentVersion) throw new StoryWriteContractError("MISSING_REVIEWED_CONTENT_VERSION", "reviewedContentVersion is required");
  if (!input.promptVersion || !input.policyVersion) throw new StoryWriteContractError("MISSING_VERSION", "promptVersion and policyVersion are required");
  assertClaudeReasonCodes(input.reasonCodes);
  for (const prefix of MEDIA_CLASSIFIERS) {
    if (!input.reasonCodes.some((code) => code.startsWith(prefix))) throw new StoryWriteContractError("MISSING_CLASSIFICATION", `a Claude photo decision must record ${prefix}…`);
  }
  if ((input.reasonCodes ?? []).some((code) => code.startsWith(MEDIA_CONTENT_VERSION_REASON_PREFIX))) throw new StoryWriteContractError("REASON_CODE_RESERVED", `reason codes may not carry their own ${MEDIA_CONTENT_VERSION_REASON_PREFIX} entry`);
  // 主体确认不等于公开授权：敏感内容不许经由 approved 被推到默认阅读位置。
  if (input.decision === "approved" && !input.reasonCodes.includes("sensitive:none")) {
    throw new StoryWriteContractError("SENSITIVE_NOT_APPROVABLE", "only sensitive:none pictures may be approved; keep sensitive ones as deferred or store_only");
  }
  if (input.decision === "approved" && !input.reasonCodes.includes("kind:life")) {
    throw new StoryWriteContractError("NOT_A_LIFE_PHOTO", "only kind:life pictures may be approved for the album");
  }
  if (input.decision === "approved" && !input.reasonCodes.includes("subject:zhangnian")) {
    throw new StoryWriteContractError("SUBJECT_NOT_CONFIRMED", "approved means the subject is confirmed as 张年; use deferred when it cannot be confirmed");
  }
}

function assertClaudeReasonCodes(codes: string[] | undefined): void {
  if (!Array.isArray(codes) || !codes.includes(CLAUDE_AUTHORIZATION_REASON)) {
    throw new StoryWriteContractError("MISSING_AUTHORIZATION", `a Claude decision must carry ${CLAUDE_AUTHORIZATION_REASON}`);
  }
  if (codes.some((code) => code.startsWith(CONTENT_SHA256_REASON_PREFIX))) throw new StoryWriteContractError("REASON_CODE_RESERVED", `reason codes may not carry their own ${CONTENT_SHA256_REASON_PREFIX} entry`);
}

/** 「还没人决定」的标记，不算一条要被尊重的人工决定。 */
const PENDING_DECISIONS: ReadonlySet<string> = new Set(["needs_human_review", "needs_review"]);

/**
 * Claude 入口的人工优先规则：同一个对象上，只要存在一条**已经作出决定**的人工行（不是待审标记），
 * Claude 就不能在它上面再下决定——无论人工当时是批准、保留不发布、暂缓还是改写。
 * 返回第一条挡路的行（用于报错），没有则 undefined。`kinds` 限定看哪些账本种类。
 */
export function blockingHumanDecision(rows: readonly LedgerRow[], kinds: ReadonlySet<string>): LedgerRow | undefined {
  return rows.find((row) => kinds.has(row.targetKind) && reviewerTypeOf(row.provider) === "human" && !PENDING_DECISIONS.has(row.decision));
}

/** 故事上会被人工决定挡住的账本种类（media_binding 是照片配对，另走自己的判断）。 */
export const STORY_DECISION_KINDS: ReadonlySet<string> = new Set(["life_event", "life_event_preview", "life_event_queue169", "life_event_trace"]);
export const PHOTO_SUBJECT_KINDS: ReadonlySet<string> = new Set(["media_subject_check"]);

/**
 * 一张图的内容版本。有资产 checksum 就用它（原图、预览、重复引用共享同一资产时自然复用审核结果）；
 * 没有就用 id + 存储键 + 尺寸的哈希——变了就会被判为 stale、要求重审。
 */
export function mediaContentVersion(media: { id: string; objectKey?: string | null; width?: number | null; height?: number | null }, assetChecksum?: string | null): string {
  if (assetChecksum) return `sha256:${assetChecksum.replace(/^sha256:/, "")}`;
  return `shape:${createHash("sha256").update(`${media.id}|${media.objectKey ?? ""}|${media.width ?? ""}|${media.height ?? ""}`).digest("hex")}`;
}
