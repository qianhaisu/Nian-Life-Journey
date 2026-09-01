// Runs the same behavioral contract against both repository backends. The JSON suite always runs
// (no external dependency). The PostgreSQL suite runs only when DATABASE_URL points at a reachable
// database — it is skipped, not faked, when one isn't available: this file never substitutes an
// in-memory/behaviorally-different simulator and calls that "PostgreSQL verified".
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { createJsonRepository } from "../lib/db/json-repository.ts";
import { resolveRepositoryBackend } from "../lib/db/config.ts";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });

const HAS_DATABASE_URL = Boolean(process.env.DATABASE_URL);

// The JSON repository writes to a single shared .data/nian-life.json — same convention as
// test/ai-organizer.test.mjs and test/quark-artifact-ingest.test.mjs. Without this restore, rows
// this file writes (e.g. a DailyTrace dated 2026-11-02) persist across runs and can be picked up
// by a later run's day-based fallback match, corrupting what looks like a fresh fixture.
const dataFile = path.join(process.cwd(), ".data", "nian-life.json");
let originalStore;
try { originalStore = await readFile(dataFile); } catch { originalStore = null; }
test.after(async () => {
  if (originalStore) await writeFile(dataFile, originalStore);
  else await rm(dataFile, { force: true });
});

function uid(prefix) { return `${prefix}-${randomUUID()}`; }

function fixtureSource(overrides = {}) {
  const id = uid("source");
  return { id, profileId: "profile-contract-test-fixture", sourceType: "parent_note", contentTypes: ["family"], contributorId: "contributor-dad", capturedAt: "2026-11-01T10:00:00.000Z", importedAt: "2026-11-01T10:00:00.000Z", mediaIds: [], sourceLabel: "Contract test source", visibility: "family", status: "uploaded", ...overrides };
}
function fixtureEvent(overrides = {}) {
  const id = uid("event");
  return { id, profileId: "profile-contract-test-fixture", title: "Contract test event", story: "story", occurredAt: "2026-11-01", people: [], tags: [], contentTypes: ["family"], mediaIds: [], sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false, createdBy: "user", ...overrides };
}
function fixtureAsset(overrides = {}) {
  return { id: uid("asset"), profileId: "profile-contract-test-fixture", mediaType: "photo", mimeType: "image/jpeg", archiveStatus: "awaiting_archive", createdAt: "2026-11-01T10:00:00.000Z", ...overrides };
}
function fixtureLocation(assetId, overrides = {}) {
  const now = "2026-11-01T10:00:00.000Z";
  return { id: uid("location"), mediaAssetId: assetId, provider: "hot", variant: "web", providerRef: uid("ref"), status: "ready", createdAt: now, updatedAt: now, ...overrides };
}
function fixtureRun(fingerprint, overrides = {}) {
  return { id: uid("run"), profileId: "profile-contract-test-fixture", organizationFingerprint: fingerprint, organizerType: "rule", organizerVersion: "rule-v1", provider: "rule", action: "daily_trace", sourceIds: [], sourceCount: 0, mediaInputCount: 0, processedAt: "2026-11-01T10:00:00.000Z", ...overrides };
}

function runContractSuite(name, createRepo) {
  test(`[${name}] appendUpload persists a source, readable via getStore and getAllEvents`, async () => {
    const repo = createRepo();
    const source = fixtureSource();
    await repo.appendUpload({ source, media: [] });
    const store = await repo.getStore();
    assert.ok(store.rawSources.some((item) => item.id === source.id));
  });

  test(`[${name}] persistOrganization creates a LifeEvent and links it to its sources`, async () => {
    const repo = createRepo();
    const source = fixtureSource();
    await repo.appendUpload({ source, media: [] });
    const event = fixtureEvent({ sourceIds: [source.id] });
    await repo.persistOrganization([source.id], event, [{ rawSourceId: source.id, lifeEventId: event.id, role: "primary", createdAt: "2026-11-01T10:00:00.000Z" }]);
    const detail = await repo.getEventDetail(event.id);
    assert.ok(detail);
    assert.equal(detail.event.id, event.id);
    assert.ok(detail.sources.some((item) => item.id === source.id));
    const store = await repo.getStore();
    assert.ok(store.links.some((link) => link.rawSourceId === source.id && link.lifeEventId === event.id));
    assert.equal(store.rawSources.find((item) => item.id === source.id).status, "organized");
  });

  test(`[${name}] persistOrganization on an existing event merges rather than duplicating`, async () => {
    const repo = createRepo();
    const first = fixtureSource();
    await repo.appendUpload({ source: first, media: [] });
    const event = fixtureEvent({ sourceIds: [first.id] });
    await repo.persistOrganization([first.id], event, []);
    const second = fixtureSource();
    await repo.appendUpload({ source: second, media: [] });
    await repo.persistOrganization([second.id], { ...event, sourceIds: [second.id] }, []);
    const store = await repo.getStore();
    assert.equal(store.events.filter((item) => item.id === event.id).length, 1);
    const merged = store.events.find((item) => item.id === event.id);
    assert.ok(merged.sourceIds.includes(first.id) && merged.sourceIds.includes(second.id));
  });

  test(`[${name}] MediaAsset/MediaLocation: append, update, and lookup by providerRef`, async () => {
    const repo = createRepo();
    const asset = fixtureAsset();
    const location = fixtureLocation(asset.id);
    await repo.appendMediaAssetWithLocation(asset, location);
    const found = await repo.findMediaLocationByProviderRef(location.provider, location.providerRef);
    assert.ok(found);
    assert.equal(found.asset.id, asset.id);
    const updated = await repo.updateMediaAsset(asset.id, { archiveStatus: "archived" });
    assert.equal(updated.archiveStatus, "archived");
  });

  test(`[${name}] DailyTrace: same organizationFingerprint merges into one trace, not two`, async () => {
    const repo = createRepo();
    const fingerprint = uid("fp");
    const first = { id: uid("trace"), profileId: "profile-contract-test-fixture", occurredAt: "2026-11-02", entries: ["a"], sourceIds: [], scopes: ["family"], visibility: "family", organizationFingerprint: fingerprint };
    await repo.persistDailyTrace(first);
    const second = { id: uid("trace"), profileId: "profile-contract-test-fixture", occurredAt: "2026-11-02", entries: ["b"], sourceIds: [], scopes: ["family"], visibility: "family", organizationFingerprint: fingerprint };
    await repo.persistDailyTrace(second);
    const store = await repo.getStore();
    const matches = store.dailyTraces.filter((item) => item.organizationFingerprint === fingerprint);
    assert.equal(matches.length, 1);
    assert.ok(matches[0].entries.includes("a") && matches[0].entries.includes("b"));
  });

  test(`[${name}] OrganizerRun: persistOrganizerRun is idempotent by organizationFingerprint`, async () => {
    const repo = createRepo();
    const fingerprint = uid("fp");
    const first = await repo.persistOrganizerRun(fixtureRun(fingerprint));
    const second = await repo.persistOrganizerRun(fixtureRun(fingerprint));
    assert.equal(first.id, second.id);
    const found = await repo.findOrganizerRun(fingerprint);
    assert.equal(found.id, first.id);
    const store = await repo.getStore();
    assert.equal(store.organizerRuns.filter((run) => run.organizationFingerprint === fingerprint).length, 1);
  });

  test(`[${name}] Quark providerRef upsert: recordArchivedOriginal is idempotent for the same (provider, providerRef)`, async () => {
    const repo = createRepo();
    const asset = fixtureAsset();
    await repo.appendMediaAssetWithLocation(asset, fixtureLocation(asset.id, { provider: "hot", variant: "original" }));
    const providerRef = uid("fid");
    await repo.recordArchivedOriginal({ assetId: asset.id, providerRef });
    await repo.recordArchivedOriginal({ assetId: asset.id, providerRef });
    const store = await repo.getStore();
    const quarkLocations = store.mediaLocations.filter((item) => item.mediaAssetId === asset.id && item.provider === "quark" && item.variant === "original");
    assert.equal(quarkLocations.length, 1, "recordArchivedOriginal must update the existing quark/original location, not create a second one");
  });

  test(`[${name}] undoOrganization removes the link and reverts source status`, async () => {
    const repo = createRepo();
    const source = fixtureSource();
    await repo.appendUpload({ source, media: [] });
    const event = fixtureEvent({ sourceIds: [source.id] });
    await repo.persistOrganization([source.id], event, [{ rawSourceId: source.id, lifeEventId: event.id, role: "primary", createdAt: "2026-11-01T10:00:00.000Z" }]);
    await repo.undoOrganization([source.id], event.id);
    const store = await repo.getStore();
    assert.equal(store.rawSources.find((item) => item.id === source.id).status, "uploaded");
    assert.ok(!store.links.some((link) => link.rawSourceId === source.id && link.lifeEventId === event.id));
  });

  test(`[${name}] getStore() returns every Store collection as an array (no undefined fields)`, async () => {
    const repo = createRepo();
    const store = await repo.getStore();
    for (const key of ["contributors", "media", "mediaAssets", "mediaLocations", "connectorStates", "rawSources", "events", "dailyTraces", "growthRecords", "careRecords", "careEpisodes", "monthlyFocusGoals", "organizerRuns", "organizerJobs", "links"]) {
      assert.ok(Array.isArray(store[key]), `store.${key} should be an array`);
    }
    assert.ok(store.profile?.id);
  });

  // The JSON store is one shared file across every test in this suite (and the postgres suite
  // shares one table, cleaned only once at the end) — claim ordering / "nothing claimable" checks
  // need a clean slate, not just fresh fixtures, so drain whatever earlier tests left pending.
  async function drainPendingOrganizerJobs(repo) {
    for (;;) {
      const job = await repo.claimNextOrganizerJob();
      if (!job) break;
      await repo.completeOrganizerJob(job.id, {});
    }
  }

  test(`[${name}] enqueueOrganizerJob is idempotent for the same source batch while a job is active`, async () => {
    const repo = createRepo();
    const sourceIds = [uid("source"), uid("source")];
    const first = await repo.enqueueOrganizerJob({ sourceIds, profileId: "profile-contract-test-fixture" });
    const second = await repo.enqueueOrganizerJob({ sourceIds: sourceIds.toReversed(), profileId: "profile-contract-test-fixture" });
    assert.equal(first.id, second.id, "re-enqueuing the same batch (any order) while pending must return the existing job, not a duplicate");
    assert.equal(first.status, "pending");
  });

  test(`[${name}] claimNextOrganizerJob claims oldest-first, sets processing, and increments attempts`, async () => {
    const repo = createRepo();
    await drainPendingOrganizerJobs(repo);
    const jobA = await repo.enqueueOrganizerJob({ sourceIds: [uid("source")], profileId: "profile-contract-test-fixture" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await repo.enqueueOrganizerJob({ sourceIds: [uid("source")], profileId: "profile-contract-test-fixture" });
    const claimed = await repo.claimNextOrganizerJob();
    assert.equal(claimed.id, jobA.id);
    assert.equal(claimed.status, "processing");
    assert.equal(claimed.attempts, 1);
    assert.ok(claimed.lockedAt);
  });

  test(`[${name}] a job that fails with a retry delay goes back to pending and can be re-enqueued as active again`, async () => {
    const repo = createRepo();
    await drainPendingOrganizerJobs(repo);
    const sourceIds = [uid("source")];
    const job = await repo.enqueueOrganizerJob({ sourceIds, profileId: "profile-contract-test-fixture" });
    await repo.claimNextOrganizerJob();
    const future = new Date(Date.now() + 60_000).toISOString();
    await repo.failOrganizerJob(job.id, "transient error", future);
    const reread = await repo.getOrganizerJob(job.id);
    assert.equal(reread.status, "pending");
    assert.equal(reread.lastError, "transient error");
    // Postgres round-trips a "timestamp" (no tz) column back as "YYYY-MM-DD HH:MM:SS.sss", with no
    // "T"/"Z" — every such column in this schema stores a UTC wall-clock value by convention, so
    // normalize before comparing instants rather than asserting on the raw string.
    const asUtcEpoch = (value) => Date.parse(/Z$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
    assert.equal(asUtcEpoch(reread.availableAt), asUtcEpoch(future));
    assert.equal(await repo.claimNextOrganizerJob(), null, "not claimable yet — availableAt is in the future");
  });

  test(`[${name}] a job that fails permanently (nextAvailableAt: null) is marked failed and stops blocking re-enqueue`, async () => {
    const repo = createRepo();
    const sourceIds = [uid("source")];
    const job = await repo.enqueueOrganizerJob({ sourceIds, profileId: "profile-contract-test-fixture" });
    await repo.claimNextOrganizerJob();
    await repo.failOrganizerJob(job.id, "permanent error", null);
    const reread = await repo.getOrganizerJob(job.id);
    assert.equal(reread.status, "failed");
    assert.ok(reread.completedAt);
    const requeued = await repo.enqueueOrganizerJob({ sourceIds, profileId: "profile-contract-test-fixture" });
    assert.notEqual(requeued.id, job.id, "a failed job must not block enqueuing the same batch again");
  });

  test(`[${name}] completeOrganizerJob marks the job succeeded with its result`, async () => {
    const repo = createRepo();
    const job = await repo.enqueueOrganizerJob({ sourceIds: [uid("source")], profileId: "profile-contract-test-fixture" });
    await repo.claimNextOrganizerJob();
    await repo.completeOrganizerJob(job.id, { resultAction: "daily_trace", resultTargetId: "trace-1" });
    const reread = await repo.getOrganizerJob(job.id);
    assert.equal(reread.status, "succeeded");
    assert.equal(reread.resultAction, "daily_trace");
    assert.equal(reread.resultTargetId, "trace-1");
    assert.ok(reread.completedAt);
  });

  test(`[${name}] recoverStuckOrganizerJobs resets a processing job whose lock is older than the threshold`, async () => {
    const repo = createRepo();
    await drainPendingOrganizerJobs(repo);
    const job = await repo.enqueueOrganizerJob({ sourceIds: [uid("source")], profileId: "profile-contract-test-fixture" });
    await repo.claimNextOrganizerJob();
    // Simulate 20 minutes passing (rather than backdating the claim itself, which would also
    // make the job's own availableAt land in the future relative to that earlier "now" and make
    // it unclaimable) by checking staleness against a "now" 20 minutes ahead.
    const laterNow = new Date(Date.now() + 20 * 60 * 1000);
    const recovered = await repo.recoverStuckOrganizerJobs(15 * 60 * 1000, laterNow);
    assert.ok(recovered >= 1);
    const reread = await repo.getOrganizerJob(job.id);
    assert.equal(reread.status, "pending");
    assert.ok(reread.lockedAt === undefined || reread.lockedAt === null);
  });
}

runContractSuite("json", () => createJsonRepository());

if (HAS_DATABASE_URL) {
  const { createPostgresRepository } = await import("../lib/db/postgres-repository.ts");
  const { Client } = await import("pg");

  // The fixtures above reference profile-contract-test-fixture/contributor-dad as foreign keys. The JSON
  // repository doesn't enforce referential integrity so this was never needed there, but real
  // PostgreSQL foreign keys reject rows whose parent doesn't exist yet — seed those two parent
  // rows before the suite runs, and remove everything scoped to this profile afterward so the
  // suite only ever cleans up what it created.
  const PROFILE_ID = "profile-contract-test-fixture";
  const CONTRIBUTOR_ID = "contributor-dad";
  test.before(async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(
      `insert into profiles (id, display_name, birth_date, timezone, visibility) values ($1, 'Contract Test Profile', '2020-01-01', 'UTC', 'private') on conflict (id) do nothing`,
      [PROFILE_ID],
    );
    await client.query(
      `insert into contributors (id, profile_id, role, display_name) values ($1, $2, 'father', 'Dad') on conflict (id) do nothing`,
      [CONTRIBUTOR_ID, PROFILE_ID],
    );
    await client.end();
  });
  test.after(async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(
      `delete from source_memory_links where raw_source_id in (select id from raw_sources where profile_id = $1) or life_event_id in (select id from life_events where profile_id = $1)`,
      [PROFILE_ID],
    );
    await client.query(`delete from media_locations where media_asset_id in (select id from media_assets where profile_id = $1)`, [PROFILE_ID]);
    for (const table of ["media", "media_assets", "raw_sources", "life_events", "daily_traces", "growth_records", "care_records", "care_episodes", "monthly_snapshot", "monthly_focus_goals", "organizer_runs", "organizer_jobs", "connector_states"]) {
      await client.query(`delete from ${table} where profile_id = $1`, [PROFILE_ID]);
    }
    await client.query(`delete from contributors where profile_id = $1`, [PROFILE_ID]);
    await client.query(`delete from profiles where id = $1`, [PROFILE_ID]);
    await client.end();
  });

  runContractSuite("postgres", () => createPostgresRepository());

  test("[postgres] a failed transaction rolls back cleanly (updateMediaAssetWithLocation with a nonexistent locationId)", async () => {
    const repo = createPostgresRepository();
    const asset = fixtureAsset();
    await repo.appendMediaAssetWithLocation(asset, fixtureLocation(asset.id));
    const result = await repo.updateMediaAssetWithLocation(asset.id, "location-does-not-exist", { archiveStatus: "archived" }, {});
    assert.equal(result, null);
    const reread = await repo.updateMediaAsset(asset.id, {});
    assert.notEqual(reread.archiveStatus, "archived", "the asset update must have rolled back alongside the failed location update");
  });

  test("[postgres] concurrent claimNextOrganizerJob calls never double-claim the same job (real FOR UPDATE SKIP LOCKED)", async () => {
    const repo = createPostgresRepository();
    // Drain whatever earlier tests left pending/claimable first — this test's attempts===1
    // assertion only holds for jobs it creates itself.
    for (;;) {
      const stray = await repo.claimNextOrganizerJob();
      if (!stray) break;
      await repo.completeOrganizerJob(stray.id, {});
    }
    const sourceIdBatches = Array.from({ length: 8 }, () => [uid("source")]);
    for (const sourceIds of sourceIdBatches) await repo.enqueueOrganizerJob({ sourceIds, profileId: PROFILE_ID });
    // Every worker shares the process's single pooled `db`, but the claim itself runs inside its
    // own `db.transaction`, which checks out a distinct connection — so this genuinely exercises
    // 6 concurrent `FOR UPDATE SKIP LOCKED` transactions racing against the same 8 pending rows,
    // not 6 calls serialized onto one connection.
    const claims = await Promise.all(Array.from({ length: 6 }, () => repo.claimNextOrganizerJob()));
    const claimed = claims.filter(Boolean);
    const claimedIds = claimed.map((job) => job.id);
    assert.equal(new Set(claimedIds).size, claimedIds.length, "no two concurrent callers claimed the same job");
    assert.ok(claimed.every((job) => job.status === "processing" && job.attempts === 1));
  });
} else {
  test("[postgres] contract suite skipped — DATABASE_URL is not set", { skip: true }, () => {});
  console.log("\n[repository-contract] DATABASE_URL not set — PostgreSQL contract suite skipped, not faked. Set DATABASE_URL to a reachable Postgres 15+ instance and re-run to verify the real backend.\n");
}

test("resolveRepositoryBackend never silently falls back: postgres without DATABASE_URL throws", () => {
  assert.throws(() => resolveRepositoryBackend({ REPOSITORY_BACKEND: "postgres" }), /DATABASE_URL/);
});
test("resolveRepositoryBackend defaults to json when unset", () => {
  assert.equal(resolveRepositoryBackend({}), "json");
});
test("resolveRepositoryBackend rejects an unknown value", () => {
  assert.throws(() => resolveRepositoryBackend({ REPOSITORY_BACKEND: "sqlite" }), /Unsupported REPOSITORY_BACKEND/);
});
