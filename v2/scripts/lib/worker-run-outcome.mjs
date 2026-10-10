// A partial import keeps the last successful watermark so omitted messages remain retryable.
export function workerRunOutcome({ previous, startedAt, runId, conversations, failed }) {
  const complete = failed === 0;
  return {
    exitCode: complete ? 0 : 1,
    advanced: complete,
    state: { version: 2, lastRunAt: complete ? startedAt : previous.lastRunAt ?? null, lastRunId: complete ? runId : previous.lastRunId ?? null, conversations },
  };
}
