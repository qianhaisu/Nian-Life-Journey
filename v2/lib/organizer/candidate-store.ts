// Self-contained MemoryCandidate persistence (§10). Deliberately independent of lib/db/schema.ts
// and lib/db/repository-interface.ts — those files were under active concurrent edit by another
// session at the time this pipeline was built, and a MemoryCandidate is additive, review-only data
// that nothing else in the app reads yet. Migrating this into the real Postgres schema/Repository
// interface (its own additive table + interface methods, mirrored in both backends per project
// convention) is the natural next step once the shape has proven itself, not a checkpoint that had
// to block this stage.
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { OrganizerOutcome } from "./contract";

export type CandidateStatus = "pending" | "needs_review" | "auto_accept" | "deferred" | "rejected" | "failed";

export type MemoryCandidate = {
  id: string;
  profileId: string;
  conversationId: string;
  windowId: string;
  windowFingerprint: string;
  sourceIds: string[];
  proposedAction: string;
  finalAction: OrganizerOutcome["action"];
  outcome: OrganizerOutcome;
  worthinessScore: number;
  selectionReason: string;
  degradeReason?: string;
  reasonCodes: string[];
  status: CandidateStatus;
  policyVersion: string;
  promptVersion: string;
  modelVersion: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
};

// Overridable so tests never touch the real .data directory used by the JSON repository.
function candidateFile() { return process.env.ORGANIZER_CANDIDATE_STORE_PATH || path.join(process.cwd(), ".data", "memory-candidates.json"); }

async function readAll(): Promise<MemoryCandidate[]> {
  try { return JSON.parse(await fs.readFile(candidateFile(), "utf8")) as MemoryCandidate[]; }
  catch { return []; }
}
async function writeAll(candidates: MemoryCandidate[]) { const file = candidateFile(); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(candidates, null, 2), "utf8"); }

let mutationTail: Promise<void> = Promise.resolve();
async function withMutation<T>(operation: (candidates: MemoryCandidate[]) => T | Promise<T>) {
  const run = async () => { const candidates = await readAll(); const result = await operation(candidates); await writeAll(candidates); return result; };
  const next = mutationTail.then(run, run);
  mutationTail = next.then(() => undefined, () => undefined);
  return next;
}

function statusFor(outcome: OrganizerOutcome): CandidateStatus {
  if (outcome.action === "failed") return "failed";
  if (outcome.action === "life_event_candidate") return outcome.reviewRequirement === "auto_accept" ? "auto_accept" : "needs_review";
  if (outcome.action === "care_observation") return "needs_review";
  return "pending";
}

export type UpsertCandidateInput = { profileId: string; conversationId: string; windowId: string; windowFingerprint: string; sourceIds: string[]; proposedAction: string; outcome: OrganizerOutcome; degradeReason?: string; reasonCodes: string[]; promptVersion: string; now?: string };

// Idempotent by windowFingerprint: rerunning the same window (same policy/prompt/model version and
// same evidence) never creates a duplicate candidate.
export async function upsertMemoryCandidate(input: UpsertCandidateInput): Promise<MemoryCandidate> {
  return withMutation((candidates) => {
    const now = input.now ?? new Date().toISOString();
    const existing = candidates.find((candidate) => candidate.windowFingerprint === input.windowFingerprint);
    if (existing && existing.status !== "pending" && existing.reviewedAt) return existing;
    const candidate: MemoryCandidate = {
      id: existing?.id ?? `memory-candidate-${randomUUID()}`,
      profileId: input.profileId, conversationId: input.conversationId, windowId: input.windowId, windowFingerprint: input.windowFingerprint, sourceIds: input.sourceIds,
      proposedAction: input.proposedAction, finalAction: input.outcome.action, outcome: input.outcome, worthinessScore: input.outcome.worthinessScore, selectionReason: input.outcome.selectionReason,
      degradeReason: input.degradeReason, reasonCodes: input.reasonCodes, status: statusFor(input.outcome), policyVersion: input.outcome.policyVersion, promptVersion: input.promptVersion, modelVersion: input.outcome.modelVersion,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    if (existing) Object.assign(existing, candidate); else candidates.push(candidate);
    return existing ?? candidate;
  });
}

export async function listMemoryCandidates(filter: { status?: CandidateStatus | CandidateStatus[]; profileId?: string } = {}): Promise<MemoryCandidate[]> {
  const candidates = await readAll();
  const statuses = filter.status ? (Array.isArray(filter.status) ? filter.status : [filter.status]) : undefined;
  return candidates.filter((candidate) => (!statuses || statuses.includes(candidate.status)) && (!filter.profileId || candidate.profileId === filter.profileId)).toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getMemoryCandidate(id: string): Promise<MemoryCandidate | null> { return (await readAll()).find((candidate) => candidate.id === id) ?? null; }

export async function reviewMemoryCandidate(id: string, status: Exclude<CandidateStatus, "pending">, now = new Date().toISOString()): Promise<MemoryCandidate | null> {
  return withMutation((candidates) => { const candidate = candidates.find((item) => item.id === id); if (!candidate) return null; candidate.status = status; candidate.reviewedAt = now; candidate.updatedAt = now; return candidate; });
}
