// The human story-decision entrance (DATA-0914-02 P2, 2026-09-14).
//
// A person approves what they READ, not what happens to be in the database when the approval lands.
// So a decision round has two steps, and the hash travels from the first to the second:
//
//   1. `buildReviewPackage` reads each story through getStoryContentVersion and writes a package: the
//      exact reviewed content (title, story, date, weight, sources, photographs) beside its sha256.
//      The person reads the package and fills in `decision` per entry. Nothing is written to the
//      database in this step.
//   2. `applyReviewPackage` hands each decision to recordHumanStoryDecision with the package's own
//      hash. The repository compares that hash with the stored story under the story lock: if an
//      automatic writer (or anyone) changed the story after the package was made, the decision is
//      refused as STALE and nothing is written — a late approval of old text can never publish new text.
//
// Every entry is also checked against itself before it is sent: an entry whose content no longer
// hashes to its recorded sha256 (text edited in the package file, or a hash pasted in from elsewhere)
// is refused as ENTRY_CONTENT_HASH_MISMATCH. The hash must be the hash of what was on the page.
//
// Scope, deliberately: historical approvals are not rewritten, and the old raw-SQL release scripts
// under v2/.data are not called or refactored. This is the path the NEXT human decision uses.
import { StoryWriteContractError, storyContentSha256, type HumanStoryDecisionInput, type StoryContent } from "@/lib/organizer/story-write-guard";
import { isQualityDecision, type QualityDecision } from "@/lib/organizer/quality-review";

export const STORY_REVIEW_PACKAGE_VERSION = "story-review-package-v1";

export type ReviewPackageEntry = {
  eventId: string;
  /** sha256 of the content below, taken when the package was generated. */
  contentSha256: string;
  content: StoryContent;
  /** Filled in by the person reviewing. null = no decision yet (skipped on apply). */
  decision: QualityDecision | null;
  note?: string;
};

export type ReviewPackage = { version: typeof STORY_REVIEW_PACKAGE_VERSION; generatedAt: string; entries: ReviewPackageEntry[] };

export type StoryReviewRepository = {
  getStoryContentVersion(eventId: string): Promise<{ eventId: string; contentSha256: string; content: StoryContent } | null>;
  recordHumanStoryDecision(input: HumanStoryDecisionInput): Promise<{ contentSha256: string; idempotent: boolean }>;
};

export async function buildReviewPackage(repository: StoryReviewRepository, eventIds: string[], now: string): Promise<{ pkg: ReviewPackage; missing: string[] }> {
  const entries: ReviewPackageEntry[] = [];
  const missing: string[] = [];
  for (const eventId of [...new Set(eventIds)]) {
    const version = await repository.getStoryContentVersion(eventId);
    if (!version) { missing.push(eventId); continue; }
    entries.push({ eventId, contentSha256: version.contentSha256, content: version.content, decision: null, note: "" });
  }
  return { pkg: { version: STORY_REVIEW_PACKAGE_VERSION, generatedAt: now, entries }, missing };
}

/** Returns null for a usable entry, or the refusal code. */
export function validateReviewPackageEntry(entry: ReviewPackageEntry): string | null {
  if (!entry || typeof entry.eventId !== "string" || !entry.eventId) return "ENTRY_MALFORMED";
  if (!/^[0-9a-f]{64}$/.test(entry.contentSha256 ?? "")) return "ENTRY_MALFORMED";
  if (!entry.content || typeof entry.content.occurredAtUtc !== "string") return "ENTRY_MALFORMED";
  if (storyContentSha256(entry.content) !== entry.contentSha256) return "ENTRY_CONTENT_HASH_MISMATCH";
  if (entry.decision !== null && !isQualityDecision(entry.decision)) return "DECISION_INVALID";
  return null;
}

export type ReviewApplyOutcome = { eventId: string; outcome: "written" | "idempotent" | "would_write" | "stale" | "skipped_no_decision" | "refused"; code?: string };

export async function applyReviewPackage(repository: StoryReviewRepository, pkg: ReviewPackage, options: { operator: string; promptVersion: string; policyVersion: string; commit: boolean }): Promise<ReviewApplyOutcome[]> {
  if (pkg?.version !== STORY_REVIEW_PACKAGE_VERSION || !Array.isArray(pkg.entries)) throw new StoryWriteContractError("PACKAGE_MALFORMED", `expected a ${STORY_REVIEW_PACKAGE_VERSION} package`);
  const outcomes: ReviewApplyOutcome[] = [];
  for (const entry of pkg.entries) {
    const invalid = validateReviewPackageEntry(entry);
    if (invalid) { outcomes.push({ eventId: entry?.eventId ?? "(unknown)", outcome: "refused", code: invalid }); continue; }
    if (entry.decision === null) { outcomes.push({ eventId: entry.eventId, outcome: "skipped_no_decision" }); continue; }
    if (!options.commit) {
      const current = await repository.getStoryContentVersion(entry.eventId);
      outcomes.push(current?.contentSha256 === entry.contentSha256 ? { eventId: entry.eventId, outcome: "would_write" } : { eventId: entry.eventId, outcome: "stale", code: current ? "STALE_REVIEW_CONTENT" : "EVENT_NOT_FOUND" });
      continue;
    }
    try {
      const result = await repository.recordHumanStoryDecision({
        eventId: entry.eventId, decision: entry.decision, reviewedContentSha256: entry.contentSha256,
        operator: options.operator, promptVersion: options.promptVersion, policyVersion: options.policyVersion,
        reasonCodes: [STORY_REVIEW_PACKAGE_VERSION],
      });
      outcomes.push({ eventId: entry.eventId, outcome: result.idempotent ? "idempotent" : "written" });
    } catch (error) {
      const code = error instanceof StoryWriteContractError ? error.code : undefined;
      if (!code) throw error;
      outcomes.push({ eventId: entry.eventId, outcome: code === "STALE_REVIEW_CONTENT" ? "stale" : "refused", code });
    }
  }
  return outcomes;
}
