import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runOrganizerWorker } from "@/lib/organizer/worker";
import { organizerWorkerEnabled } from "@/lib/organizer/worker-gate";

// Minimal production trigger for the async Organizer queue: drains a bounded batch of whatever is
// claimable right now and returns. Safe to call repeatedly/concurrently — claimNextOrganizerJob()
// uses `FOR UPDATE SKIP LOCKED`, so two overlapping invocations never process the same job twice.
// The ECS baseline has no scheduler. An explicit, authenticated manual request uses CRON_SECRET
// (or the existing INGESTION_TOKEN fallback) only after ORGANIZER_WORKER_ENABLED is enabled.
//
// The batch bound is a *duration* bound. Everything here happens inside one serverless invocation
// and runOrganizerWorker() awaits each job in turn, so the invocation's wall time is the sum of the
// batch — and a V2 Memory (Judgment + Writer) measures roughly 15–30 s. At 25 that is 6–12 minutes,
// past any function duration this project can be deployed under; at 5 the worst case is ~2.5
// minutes. Jobs past the bound are never claimed: they stay `pending` for the next invocation (the
// post-response kick in lib/organizer/kick.ts or a manual call), so a small batch
// costs latency on a backlog and nothing else. Raise the model timeout instead and the invocation
// is killed mid-job — that job then waits out the 15-minute stuck sweep before anyone retries it.
const MAX_JOBS_PER_INVOCATION = 5;

// This is also respected by the remaining Vercel deployment until its manual retirement. The
// ECS Web process does not invoke this route automatically; its own caller must set a timeout
// consistent with the five-job bound above.
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET ?? process.env.INGESTION_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!organizerWorkerEnabled()) return NextResponse.json({ error: "Organizer worker is disabled" }, { status: 503 });
  const outcomes = await runOrganizerWorker({ once: true, maxJobs: MAX_JOBS_PER_INVOCATION });
  const succeeded = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.filter((o) => !o.ok).length;
  return NextResponse.json({
    processed: outcomes.length,
    succeeded,
    failed,
    jobs: outcomes.map((o) => o.ok ? { id: o.job.id, status: "succeeded", action: o.action } : { id: o.job.id, status: o.permanent ? "failed" : "retrying", error: o.error }),
  });
}

export const GET = POST;
