import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runOrganizerWorker } from "@/lib/organizer/worker";

// Minimal production trigger for the async Organizer queue: drains whatever is claimable right
// now and returns. Safe to call repeatedly/concurrently — claimNextOrganizerJob() uses
// `FOR UPDATE SKIP LOCKED`, so two overlapping invocations never process the same job twice.
// Vercel Cron sends its own Authorization: Bearer $CRON_SECRET when configured; a manual/curl
// trigger authenticates the same way INGESTION_TOKEN already protects /api/internal/ingest.
const MAX_JOBS_PER_INVOCATION = 25;

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
