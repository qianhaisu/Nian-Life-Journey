// Facts the site must never get wrong, pinned as tests: whose book this is, and that the test suite
// itself cannot reach the real database or leak its fixtures into that book.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CANONICAL_PROFILE_ID } from "../lib/db/config.ts";
import { scopeStoreToProfile } from "../lib/db/profile-scope.ts";
import { createJsonRepository } from "../lib/db/json-repository.ts";
import { CONTRACT_DATABASE_URL } from "./fixtures/contract-database.mjs";

// Same .data/nian-life.json restore convention as repository-contract.test.mjs.
const dataFile = path.join(process.cwd(), ".data", "nian-life.json");
let originalStore;
try { originalStore = await readFile(dataFile); } catch { originalStore = null; }
test.after(async () => {
  if (originalStore) await writeFile(dataFile, originalStore);
  else await rm(dataFile, { force: true });
});

const uid = (prefix) => `${prefix}-${randomUUID()}`;
const FIXTURE_PROFILE = "profile-contract-test-fixture";

function eventFor(profileId, title) {
  return { id: uid("event"), profileId, title, story: "story", occurredAt: "2026-11-01", people: [], tags: [], contentTypes: ["family"], mediaIds: [], sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false, createdBy: "user" };
}
function sourceFor(profileId) {
  return { id: uid("source"), profileId, sourceType: "parent_note", contentTypes: ["family"], contributorId: "contributor-dad", capturedAt: "2026-11-01T10:00:00.000Z", importedAt: "2026-11-01T10:00:00.000Z", mediaIds: [], sourceLabel: "note", visibility: "family", status: "uploaded" };
}

test("scopeStoreToProfile keeps only the named profile's rows, following assets and sources for the unscoped tables", () => {
  const asset = (profileId) => ({ id: uid("asset"), profileId, mediaType: "photo", mimeType: "image/jpeg", createdAt: "2026-11-01T10:00:00.000Z" });
  const own = { source: sourceFor(CANONICAL_PROFILE_ID), event: eventFor(CANONICAL_PROFILE_ID, "真的记忆"), asset: asset(CANONICAL_PROFILE_ID) };
  const other = { source: sourceFor(FIXTURE_PROFILE), event: eventFor(FIXTURE_PROFILE, "Contract test event"), asset: asset(FIXTURE_PROFILE) };
  const location = (assetId) => ({ id: uid("location"), mediaAssetId: assetId, provider: "hot", variant: "web", providerRef: uid("ref"), status: "ready", createdAt: "x", updatedAt: "x" });
  const link = (s, e) => ({ rawSourceId: s.id, lifeEventId: e.id, role: "primary", createdAt: "x" });
  const store = {
    profile: { id: CANONICAL_PROFILE_ID, displayName: "张年", birthDate: "2025-01-03", timezone: "Asia/Shanghai", visibility: "family" },
    contributors: [], media: [], connectorStates: [], dailyTraces: [], growthRecords: [], careRecords: [], careEpisodes: [], monthlyFocusGoals: [], organizerRuns: [], organizerJobs: [], chatImportTasks: [],
    mediaAssets: [own.asset, other.asset],
    mediaLocations: [location(own.asset.id), location(other.asset.id)],
    rawSources: [own.source, other.source],
    events: [own.event, other.event],
    links: [link(own.source, own.event), link(other.source, other.event)],
    monthlySnapshot: null,
  };
  const scoped = scopeStoreToProfile(store, CANONICAL_PROFILE_ID);
  assert.deepEqual(scoped.events.map((e) => e.title), ["真的记忆"]);
  assert.deepEqual(scoped.rawSources.map((s) => s.id), [own.source.id]);
  assert.deepEqual(scoped.mediaAssets.map((a) => a.id), [own.asset.id]);
  assert.deepEqual(scoped.mediaLocations.map((l) => l.mediaAssetId), [own.asset.id]);
  assert.deepEqual(scoped.links, [link(own.source, own.event)]);
  assert.equal(scoped.profile.birthDate, "2025-01-03");
  // The fixture's own view still sees its rows — only the default read is pinned.
  assert.deepEqual(scopeStoreToProfile(store, FIXTURE_PROFILE).events.map((e) => e.title), ["Contract test event"]);
});

test("[json] a contract-test event written under the fixture profile never reaches 张年's home, timeline or archive", async () => {
  const { loadFamilyArchive } = await import("../lib/family-archive.ts");
  const repo = createJsonRepository();
  const source = sourceFor(FIXTURE_PROFILE);
  await repo.appendUpload({ source, media: [] });
  const fixtureEvent = eventFor(FIXTURE_PROFILE, "Contract test event");
  await repo.persistOrganization([source.id], fixtureEvent, [{ rawSourceId: source.id, lifeEventId: fixtureEvent.id, role: "primary", createdAt: "2026-11-01T10:00:00.000Z" }]);

  const [home, all, archive] = await Promise.all([repo.getHomeEvents(), repo.getAllEvents(), loadFamilyArchive()]);
  assert.equal(archive.store.profile.id, CANONICAL_PROFILE_ID);
  assert.equal(archive.store.profile.birthDate, "2025-01-03");
  assert.equal(archive.birthDay, "2025-01-03");
  assert.ok(!home.some((e) => e.title === "Contract test event"), "homepage query must not show the fixture");
  assert.ok(!all.some((e) => e.id === fixtureEvent.id), "timeline query must not show the fixture");
  assert.ok(!archive.events.some((e) => e.id === fixtureEvent.id), "chapters must not show the fixture");
  const { store } = archive;
  assert.ok(!store.events.some((e) => e.id === fixtureEvent.id) && !store.rawSources.some((s) => s.id === source.id) && !store.links.some((l) => l.lifeEventId === fixtureEvent.id));
  assert.ok(store.events.every((e) => e.profileId === CANONICAL_PROFILE_ID));

  // The backend still holds the fixture (nothing was deleted) — the pipelines read the full view.
  const raw = await repo.getStore();
  assert.equal(raw.profile.id, CANONICAL_PROFILE_ID);
  assert.ok(raw.events.some((e) => e.id === fixtureEvent.id));
  // A fixture event's detail is readable by id, but the page treats a non-张年 owner as not found.
  const detail = await repo.getEventDetail(fixtureEvent.id);
  assert.notEqual(detail.event.profileId, raw.profile.id);
});

test("plain `npm test` never connects to PostgreSQL: DB suites gate only on CONTRACT_DATABASE_URL", async () => {
  if (process.env.CONTRACT_DATABASE_URL) {
    assert.equal(CONTRACT_DATABASE_URL, process.env.CONTRACT_DATABASE_URL.trim());
    return;
  }
  assert.equal(CONTRACT_DATABASE_URL, null);
  // No test file may load .env.local or gate a real-database suite on DATABASE_URL again.
  const testDir = path.join(process.cwd(), "test");
  for (const file of (await readdir(testDir)).filter((name) => name.endsWith(".test.mjs"))) {
    const text = await readFile(path.join(testDir, file), "utf8");
    assert.ok(!/from\s+["']dotenv["']/.test(text), `${file} loads dotenv — tests must not read .env.local`);
    assert.ok(!/if \(process\.env\.DATABASE_URL\)|Boolean\(process\.env\.DATABASE_URL\)|connectionString: process\.env\.DATABASE_URL/.test(text), `${file} gates or connects on DATABASE_URL instead of CONTRACT_DATABASE_URL`);
  }
});
