/**
 * The web process must never start Organizer work merely because a request
 * enqueued a job. ECS enables this deliberately after the migrated data has
 * been accepted; every other value, including an unset variable, keeps jobs
 * safely pending for a separately invoked worker.
 */
export function organizerWorkerEnabled(value = process.env.ORGANIZER_WORKER_ENABLED) {
  return value === "true";
}
