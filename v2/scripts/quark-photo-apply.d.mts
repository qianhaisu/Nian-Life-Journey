export type PermanentSkipRecord = { filename?: string; skip_reason?: string; size?: number };

export type ApplyRecord = {
  status: "created" | "reused" | "would_create";
  filename: string;
  sha256: string;
  rawSourceId: string;
  capturedAt: string;
};

export type FailedRecord = { filename: string; sha256: string; reason: string };

export type DateRecord = { date: string; sourceCount: number; jobId?: string; jobStatus?: string; wouldEnqueue?: boolean };

export type WorkerOutcome = { jobId: string; ok: boolean; action?: string; error?: string };

export type ApplySummary = {
  mode: "dry-run" | "apply";
  total: number;
  eligible: number;
  newCount: number;
  reusedCount: number;
  skippedCount: number;
  failedCount: number;
};

export type ApplyResult = ApplySummary & {
  created: ApplyRecord[];
  reused: ApplyRecord[];
  permanentlySkipped: { filename: string; sha256: string; skip_reason: string }[];
  failed: FailedRecord[];
  dates: DateRecord[];
  workerOutcomes: WorkerOutcome[];
  summary: ApplySummary;
};

export function applyQuarkPhotoArtifact(config: {
  artifactDir?: string;
  taskItemsPath?: string;
  originalsDir?: string;
  mode?: "dry-run" | "apply";
  permanentSkip?: Map<string, PermanentSkipRecord>;
  profileId?: string;
  contributorId?: string;
  visibility?: string;
  sourceLabel?: string;
  maxGeminiJobs?: number;
  requireGemini?: boolean;
  deps?: Record<string, unknown>;
}): Promise<ApplyResult>;

export function capturedAtIso(item: { capture_time: { text: string } }): string;

export const DEFAULT_PROFILE_ID: string;
export const DEFAULT_CONTRIBUTOR_ID: string;
export const DEFAULT_VISIBILITY: string;
export const DEFAULT_SOURCE_LABEL: string;
export const DEFAULT_MAX_GEMINI_JOBS: number;
