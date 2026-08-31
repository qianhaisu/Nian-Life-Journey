import { after } from "next/server";
import { runOrganizerWorker } from "./worker";

// Cron (vercel.json) only runs once a day on the current Vercel plan — far too slow to be the
// primary trigger. Call this right after a successful enqueue, from a real request context (a
// Server Action or Route Handler): it schedules a small worker drain to run after the response is
// already sent, so capture/ingest stays fast while the source still gets organized within seconds
// instead of waiting for the next cron tick. Safe to skip on error — the job stays durably queued
// either way and the daily cron (or a manual worker run) still picks it up.
const JOBS_PER_KICK = 3;

export function kickOrganizerWorker() {
  after(() => runOrganizerWorker({ once: true, maxJobs: JOBS_PER_KICK }).catch(() => {}));
}
