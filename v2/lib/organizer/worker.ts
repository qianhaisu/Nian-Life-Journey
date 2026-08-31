import { claimNextOrganizerJob, completeOrganizerJob, failOrganizerJob, recoverStuckOrganizerJobs } from "@/lib/db/repository";
import type { OrganizerJob } from "@/lib/types";
import { getConfiguredOrganizer } from "./index";

// Retry policy for a job that throws (provider error, transient DB issue, ...). After the last
// attempt the job is marked "failed" permanently — never silently dropped, never retried forever.
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [10_000, 30_000, 120_000, 600_000];
// A job whose worker died mid-run (process killed, box recycled) stays "processing" with a stale
// lockedAt. Any later run of the worker sweeps those back to "pending" before claiming new work,
// so a crash never strands a job forever.
const STUCK_JOB_THRESHOLD_MS = 15 * 60 * 1000;

export type WorkerRunOptions = {
  /** Stop after draining all currently-claimable jobs instead of polling forever. */
  once?: boolean;
  /** Upper bound on jobs processed in one run() call, even in polling mode. */
  maxJobs?: number;
  /** Poll interval in polling mode. */
  pollIntervalMs?: number;
  now?: () => Date;
};

export type WorkerJobOutcome = { job: OrganizerJob; ok: true; action: string } | { job: OrganizerJob; ok: false; error: string; permanent: boolean };

async function processOneJob(job: OrganizerJob): Promise<WorkerJobOutcome> {
  try {
    const result = await getConfiguredOrganizer().organize(job.sourceIds, { force: job.force });
    await completeOrganizerJob(job.id, { resultAction: result.action, resultTargetId: result.eventId ?? result.traceId ?? result.careEpisodeId });
    return { job, ok: true, action: result.action };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const permanent = job.attempts >= MAX_ATTEMPTS;
    const delay = RETRY_DELAYS_MS[Math.min(job.attempts - 1, RETRY_DELAYS_MS.length - 1)];
    const nextAvailableAt = permanent ? null : new Date(Date.now() + delay).toISOString();
    await failOrganizerJob(job.id, message, nextAvailableAt);
    return { job, ok: false, error: message, permanent };
  }
}

// Drains (once) or polls (continuously) the organizer_jobs queue. A single call to run() always
// starts with a sweep for stuck jobs, so a worker that starts after a crash recovers prior work
// before it claims anything new.
export async function runOrganizerWorker(options: WorkerRunOptions = {}): Promise<WorkerJobOutcome[]> {
  const now = options.now ?? (() => new Date());
  const maxJobs = options.maxJobs ?? Infinity;
  const outcomes: WorkerJobOutcome[] = [];
  await recoverStuckOrganizerJobs(STUCK_JOB_THRESHOLD_MS, now());

  for (;;) {
    if (outcomes.length >= maxJobs) break;
    const job = await claimNextOrganizerJob(now());
    if (!job) {
      if (options.once) break;
      await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? 5000));
      continue;
    }
    outcomes.push(await processOneJob(job));
  }
  return outcomes;
}
