import { after } from "next/server";
import { runOrganizerWorker } from "./worker";
import { organizerWorkerEnabled } from "./worker-gate";

// ECS keeps automatic work off until migration acceptance explicitly enables it. Call this after
// a successful enqueue from a real request context. When enabled, it drains a small batch after
// the response; when disabled, the durable job remains pending for the separately invoked worker.
const JOBS_PER_KICK = 3;

export function kickOrganizerWorker() {
  if (!organizerWorkerEnabled()) return;
  after(() => runOrganizerWorker({ once: true, maxJobs: JOBS_PER_KICK }).catch(() => {}));
}
