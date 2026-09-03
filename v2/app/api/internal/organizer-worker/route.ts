import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runOrganizerWorker } from "@/lib/organizer/worker";

// Minimal production trigger for the async Organizer queue: drains a bounded batch of whatever is
// claimable right now and returns. Safe to call repeatedly/concurrently — claimNextOrganizerJob()
// uses `FOR UPDATE SKIP LOCKED`, so two overlapping invocations never process the same job twice.
// Vercel Cron sends its own Authorization: Bearer $CRON_SECRET when configured; a manual/curl
// trigger authenticates the same way INGESTION_TOKEN already protects /api/internal/ingest.
//
// The batch bound is a *duration* bound. Everything here happens inside one serverless invocation
// and runOrganizerWorker() awaits each job in turn, so the invocation's wall time is the sum of the
// batch — and a V2 Memory (Judgment + Writer) measures roughly 15–30 s. At 25 that is 6–12 minutes,
// past any function duration this project can be deployed under; at 5 the worst case is ~2.5
// minutes. Jobs past the bound are never claimed: they stay `pending` for the next invocation (the
// post-response kick in lib/organizer/kick.ts, the daily cron, or a manual call), so a small batch
// costs latency on a backlog and nothing else. Raise the model timeout instead and the invocation
// is killed mid-job — that job then waits out the 15-minute stuck sweep before anyone retries it.
const MAX_JOBS_PER_INVOCATION = 5;

// Route segment config. This is a Node.js function (node:crypto below), and Fluid Compute is
// enabled on the project's plan, where 300 s is the ceiling — the plan is Hobby, which already
// rejected a `*/5` cron at deploy time for exceeding its limits (715f6bd), so the batch above is
// sized against a duration this deployment actually grants rather than a platform default.
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
