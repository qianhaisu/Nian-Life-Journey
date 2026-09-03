// What bounds one worker invocation.
//
// POST /api/internal/organizer-worker is a single serverless invocation, and runOrganizerWorker()
// awaits each job in turn, so the invocation's wall time is the sum of its batch. The batch bound
// is therefore the thing that keeps an invocation inside the platform's function duration — not a
// model timeout, which only decides how long a single job is allowed to hang before it fails.
//
// These cases pin the bound, and pin everything the bound must NOT change: jobs past it are never
// claimed (so they are still there for the next invocation), the retry backoff is untouched, and
// the stuck-job sweep runs even when the bound allows no processing at all.
//
// The JSON repository is used as a REAL backend here (same convention as organizer-v2-cutover):
// every row asserted on was written by the code paths PostgreSQL runs. Plain `npm test` never
// connects to PostgreSQL — product-truth pins that — so nothing here touches production data.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { claimNextOrganizerJob, enqueueOrganizerJob, getOrganizerJob } from "../lib/db/repository.ts";
import { runOrganizerWorker } from "../lib/organizer/worker.ts";

const routeFile = path.join(process.cwd(), "app", "api", "internal", "organizer-worker", "route.ts");
const dataFile = path.join(process.cwd(), ".data", "nian-life.json");
const PROFILE_ID = "profile-worker-batch-test";

let originalStore;
try { originalStore = await readFile(dataFile); } catch { originalStore = null; }
test.after(async () => {
  if (originalStore) await writeFile(dataFile, originalStore);
  else await rm(dataFile, { force: true });
});

// The JSON store is shared local data that may already hold queued jobs, and a claim takes the
// oldest claimable row in the whole queue. Park everything already there past the horizon so the
// claim assertions below are about this file's own jobs; test.after restores the file byte for byte.
const PARKED_UNTIL = "3000-01-01T00:00:00.000Z";
async function parkExistingJobs() {
  let raw;
  try { raw = await readFile(dataFile, "utf8"); } catch { return; }
  const store = JSON.parse(raw);
  for (const job of store.organizerJobs ?? []) job.availableAt = PARKED_UNTIL;
  await writeFile(dataFile, JSON.stringify(store, null, 2));
}

// A job whose sources do not exist fails deterministically inside the organizer ("No sources found
// for organization"), which is the cheapest honest way to occupy the loop: the bound is on how many
// jobs an invocation takes, and an outcome is recorded whether the job succeeded or failed.
const queueJob = () => enqueueOrganizerJob({ sourceIds: [`source-worker-batch-${randomUUID()}`], profileId: PROFILE_ID });

test("one invocation claims at most the batch bound, and never touches the rest", async () => {
  await parkExistingJobs();
  const queued = [];
  for (let i = 0; i < 8; i += 1) queued.push(await queueJob());
  const mine = new Set(queued.map((job) => job.id));
  // A fixed clock: the eight rows are claimable at `at`, the parked rows are not, and a row pushed
  // into retry backoff during the run lands after `at` — so neither assertion depends on how long
  // the machine took.
  const at = new Date();

  const invocation = await runOrganizerWorker({ once: true, maxJobs: 5, now: () => at });

  assert.equal(invocation.length, 5);
  assert.ok(invocation.every((outcome) => mine.has(outcome.job.id)), "claimed a job this test did not queue");

  const claimed = new Set(invocation.map((outcome) => outcome.job.id));
  const leftover = queued.filter((job) => !claimed.has(job.id));
  assert.equal(leftover.length, 3);
  for (const job of leftover) {
    const row = await getOrganizerJob(job.id);
    assert.equal(row.status, "pending");
    // attempts is incremented by the claim itself, so 0 proves the row was never claimed — not
    // merely that it was claimed and left unfinished.
    assert.equal(row.attempts, 0);
    assert.equal(row.lockedAt, undefined);
  }
});

test("the jobs past the bound are what the next invocation picks up", async () => {
  await parkExistingJobs();
  const queued = [];
  for (let i = 0; i < 8; i += 1) queued.push(await queueJob());
  const at = new Date();

  const first = await runOrganizerWorker({ once: true, maxJobs: 5, now: () => at });
  const second = await runOrganizerWorker({ once: true, maxJobs: 5, now: () => at });

  const leftover = queued.filter((job) => !first.some((outcome) => outcome.job.id === job.id));
  assert.deepEqual(new Set(second.map((outcome) => outcome.job.id)), new Set(leftover.map((job) => job.id)));
  // The five from the first invocation are not re-run: they are in retry backoff, which the bound
  // did not change.
  for (const outcome of first) {
    const row = await getOrganizerJob(outcome.job.id);
    assert.equal(row.status, "pending");
    assert.equal(row.attempts, 1);
    assert.ok(row.availableAt > at.toISOString(), "a failed job became claimable again immediately");
    assert.match(row.lastError, /No sources found/);
  }
  assert.equal(second.length, 3);
});

test("the stuck-job sweep runs even when the bound allows no processing at all", async () => {
  await parkExistingJobs();
  const job = await queueJob();

  // An invocation claims the job and then dies — box recycled, or the function killed at its
  // duration limit. The row is left "processing" with a lock nothing will ever clear.
  const claimed = await claimNextOrganizerJob(new Date());
  assert.equal(claimed.id, job.id);
  assert.equal((await getOrganizerJob(job.id)).status, "processing");

  // A later invocation, past the 15-minute threshold, with a bound that permits zero jobs: the
  // sweep happens before the loop, so the batch bound can never strand a crashed job.
  const later = new Date(Date.now() + 20 * 60 * 1000);
  const outcomes = await runOrganizerWorker({ once: true, maxJobs: 0, now: () => later });

  assert.equal(outcomes.length, 0);
  const recovered = await getOrganizerJob(job.id);
  assert.equal(recovered.status, "pending");
  assert.equal(recovered.lockedAt, undefined);
});

test("the deployed route's batch fits the duration it declares", async () => {
  const source = await readFile(routeFile, "utf8");
  const bound = Number(/MAX_JOBS_PER_INVOCATION = (\d+)/.exec(source)?.[1]);
  const declared = Number(/export const maxDuration = (\d+)/.exec(source)?.[1]);
  assert.ok(Number.isInteger(bound) && bound > 0, `route batch bound is ${bound}`);
  assert.ok(Number.isInteger(declared) && declared > 0, `route declares no maxDuration`);
  // The plan's ceiling, which the declaration may not exceed: Hobby with Fluid Compute is 300 s.
  assert.ok(declared <= 300, `maxDuration ${declared} is above the plan ceiling`);
  // The two numbers are one decision. A V2 Memory measures 15–30 s, so a batch is only allowed to
  // grow if the duration it runs in grows with it — raising the bound back to 25 fails here.
  const WORST_CASE_SECONDS_PER_JOB = 30;
  assert.ok(bound * WORST_CASE_SECONDS_PER_JOB <= declared, `${bound} jobs at ${WORST_CASE_SECONDS_PER_JOB}s does not fit in ${declared}s`);
  assert.match(source, /runOrganizerWorker\(\{ once: true, maxJobs: MAX_JOBS_PER_INVOCATION \}\)/);
});
