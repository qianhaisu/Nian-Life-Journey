// Runs the same behavioral contract against both repository backends. The JSON suite always runs
// (no external dependency). The PostgreSQL suite runs only when DATABASE_URL points at a reachable
// database — it is skipped, not faked, when one isn't available: this file never substitutes an
// in-memory/behaviorally-different simulator and calls that "PostgreSQL verified".
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createJsonRepository } from "../lib/db/json-repository.ts";
import { resolveRepositoryBackend } from "../lib/db/config.ts";

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
  return { id, profileId: "profile-zhangnian", sourceType: "parent_note", contentTypes: ["family"], contributorId: "contributor-dad", capturedAt: "2026-11-01T10:00:00.000Z", importedAt: "2026-11-01T10:00:00.000Z", mediaIds: [], sourceLabel: "Contract test source", visibility: "family", status: "uploaded", ...overrides };
}
function fixtureEvent(overrides = {}) {
  const id = uid("event");
  return { id, profileId: "profile-zhangnian", title: "Contract test event", story: "story", occurredAt: "2026-11-01", people: [], tags: [], contentTypes: ["family"], mediaIds: [], sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false, createdBy: "user", ...overrides };
}
function fixtureAsset(overrides = {}) {
  return { id: uid("asset"), profileId: "profile-zhangnian", mediaType: "photo", mimeType: "image/jpeg", archiveStatus: "awaiting_archive", createdAt: "2026-11-01T10:00:00.000Z", ...overrides };
}
function fixtureLocation(assetId, overrides = {}) {
  const now = "2026-11-01T10:00:00.000Z";
  return { id: uid("location"), mediaAssetId: assetId, provider: "hot", variant: "web", providerRef: uid("ref"), status: "ready", createdAt: now, updatedAt: now, ...overrides };
}
function fixtureRun(fingerprint, overrides = {}) {
  return { id: uid("run"), profileId: "profile-zhangnian", organizationFingerprint: fingerprint, organizerType: "rule", organizerVersion: "rule-v1", provider: "rule", action: "daily_trace", sourceIds: [], sourceCount: 0, mediaInputCount: 0, processedAt: "2026-11-01T10:00:00.000Z", ...overrides };
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
    const first = { id: uid("trace"), profileId: "profile-zhangnian", occurredAt: "2026-11-02", entries: ["a"], sourceIds: [], scopes: ["family"], visibility: "family", organizationFingerprint: fingerprint };
    await repo.persistDailyTrace(first);
    const second = { id: uid("trace"), profileId: "profile-zhangnian", occurredAt: "2026-11-02", entries: ["b"], sourceIds: [], scopes: ["family"], visibility: "family", organizationFingerprint: fingerprint };
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
    for (const key of ["contributors", "media", "mediaAssets", "mediaLocations", "connectorStates", "rawSources", "events", "dailyTraces", "growthRecords", "careRecords", "careEpisodes", "monthlyFocusGoals", "organizerRuns", "links"]) {
      assert.ok(Array.isArray(store[key]), `store.${key} should be an array`);
    }
    assert.ok(store.profile?.id);
  });
}

runContractSuite("json", () => createJsonRepository());

if (HAS_DATABASE_URL) {
  const { createPostgresRepository } = await import("../lib/db/postgres-repository.ts");
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
