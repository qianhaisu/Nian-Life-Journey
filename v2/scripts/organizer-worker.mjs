#!/usr/bin/env node
// Drains (--once) or polls (default) the organizer_jobs queue against whatever REPOSITORY_BACKEND
// resolves to. Local init/backfill work should use --once so the process exits once the queue is
// empty instead of idling.
//
//   node --import tsx scripts/organizer-worker.mjs --once [--max-jobs=50]
//   node --import tsx scripts/organizer-worker.mjs [--poll-interval-ms=5000]
import { runOrganizerWorker } from "../lib/organizer/worker.ts";

const args = process.argv.slice(2);
const once = args.includes("--once");
const maxJobsArg = args.find((a) => a.startsWith("--max-jobs="));
const pollIntervalArg = args.find((a) => a.startsWith("--poll-interval-ms="));

const outcomes = await runOrganizerWorker({
  once,
  maxJobs: maxJobsArg ? Number(maxJobsArg.slice("--max-jobs=".length)) : undefined,
  pollIntervalMs: pollIntervalArg ? Number(pollIntervalArg.slice("--poll-interval-ms=".length)) : undefined,
});

const succeeded = outcomes.filter((o) => o.ok).length;
const failed = outcomes.filter((o) => !o.ok).length;
console.log(`Organizer worker: processed ${outcomes.length} job(s) — ${succeeded} succeeded, ${failed} failed.`);
for (const outcome of outcomes) {
  if (outcome.ok) console.log(`  ✓ ${outcome.job.id} -> ${outcome.action}`);
  else console.log(`  ✗ ${outcome.job.id} -> ${outcome.error}${outcome.permanent ? " (permanent)" : " (will retry)"}`);
}
process.exit(failed && outcomes.every((o) => !o.ok) ? 1 : 0);
