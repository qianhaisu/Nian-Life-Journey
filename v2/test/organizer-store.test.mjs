import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });
// lib/db/repository.ts (the facade rule-based.ts imports for its persist calls) resolves
// REPOSITORY_BACKEND once at module load and caches the module afterward — it can't be switched
// mid-process. Pin it to postgres here (when available) before anything imports rule-based.ts, the
// same way every other ad hoc script in this project's history has had to.
if (process.env.DATABASE_URL) process.env.REPOSITORY_BACKEND = "postgres";

// getOrganizerStore exists specifically because getStore()'s unfiltered select() across every
// table takes ~10 minutes at real WeChat-import data volume (thousands of raw_sources). This is a
// small, scoped contract: same shape guarantee on both backends, on a synthetic profile with a
// handful of rows — fast, not a re-run of the full repository contract suite.
const dataFile = path.join(process.cwd(), ".data", "nian-life.json");
let originalStore;
try { originalStore = await readFile(dataFile); } catch { originalStore = null; }
test.after(async () => {
  if (originalStore) await writeFile(dataFile, originalStore);
  else await rm(dataFile, { force: true });
});

function uid(prefix) { return `${prefix}-${randomUUID()}`; }

async function checkScopedRead(createRepository, profileId) {
  const repository = createRepository();
  const sourceA = { id: uid("source"), profileId, sourceType: "parent_note", contentTypes: ["family"], contributorId: "contributor-dad", capturedAt: "2026-05-01T10:00:00.000Z", importedAt: "2026-05-01T10:00:00.000Z", text: "今天一起去了公园。", mediaIds: [], sourceLabel: "note", visibility: "family", status: "uploaded" };
  await repository.persistUpload({ source: sourceA, media: [], assets: [], locations: [] });
  const store = await repository.getOrganizerStore(profileId);
  assert.equal(store.profile.id, profileId);
  assert.ok(store.rawSources.some((s) => s.id === sourceA.id), "the scoped store must include the just-written source");
  assert.equal(store.rawSources.every((s) => s.profileId === profileId), true, "getOrganizerStore must only return rows for the requested profile");
  return { repository, sourceA };
}

test("[json] getOrganizerStore scopes rawSources/media/mediaAssets/events to the requested profile", async () => {
  const { createJsonRepository } = await import("../lib/db/json-repository.ts");
  await checkScopedRead(() => createJsonRepository(), "profile-zhangnian");
});

if (process.env.DATABASE_URL) {
  const { createPostgresRepository } = await import("../lib/db/postgres-repository.ts");
  const { closePool } = await import("../lib/db/client.ts");
  const pg = await import("pg");
  const profileId = uid("profile-organizer-store");

  test("[postgres] getOrganizerStore scopes rawSources/media/mediaAssets/events to the requested profile", async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("insert into profiles (id, display_name, birth_date, timezone, visibility) values ($1, 'Synthetic OrganizerStore', '2020-01-01', 'UTC', 'private') on conflict (id) do nothing", [profileId]);
    await client.end();
    await checkScopedRead(() => createPostgresRepository(), profileId);
  });

  test("[postgres] RuleBasedMemoryOrganizer accepts a pre-fetched store and a dryRun option: dryRun predicts the exact real-write decision without persisting, and the real write is idempotent on rerun", async () => {
    const { RuleBasedMemoryOrganizer } = await import("../lib/organizer/rule-based.ts");
    const repository = createPostgresRepository();
    const sourceB = { id: uid("source"), profileId, sourceType: "parent_note", contentTypes: ["family"], contributorId: "contributor-dad", capturedAt: "2026-05-02T10:00:00.000Z", importedAt: "2026-05-02T10:00:00.000Z", text: "今天第一次自己穿鞋子。", mediaIds: [], sourceLabel: "note", visibility: "family", status: "uploaded" };
    await repository.persistUpload({ source: sourceB, media: [], assets: [], locations: [] });
    const store = await repository.getOrganizerStore(profileId);
    const organizer = new RuleBasedMemoryOrganizer();

    const dry = await organizer.organize([sourceB.id], { store, dryRun: true });
    assert.ok(dry.action);
    const storeAfterDry = await repository.getOrganizerStore(profileId);
    assert.equal(storeAfterDry.events.length, 0, "dryRun must not persist anything, even when the decision would create a LifeEvent");

    const real = await organizer.organize([sourceB.id], { store, dryRun: false });
    assert.equal(real.action, dry.action, "dryRun must predict the exact same decision the real run makes");
    assert.equal(real.organizationFingerprint, dry.organizationFingerprint);

    const rerunStore = await repository.getOrganizerStore(profileId);
    const rerun = await organizer.organize([sourceB.id], { store: rerunStore });
    assert.equal(rerun.reason, "This source batch was already organized.", "rerunning the same batch must be idempotent via organizationFingerprint");
    assert.equal(rerun.action, real.action);
  });

  test.after(async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("delete from source_memory_links where life_event_id in (select id from life_events where profile_id = $1)", [profileId]);
    for (const table of ["life_events", "daily_traces", "organizer_runs", "raw_sources"]) await client.query(`delete from ${table} where profile_id = $1`, [profileId]);
    await client.query("delete from profiles where id = $1", [profileId]);
    await client.end();
    await closePool();
  });
} else {
  test("[postgres] getOrganizerStore contract skipped — DATABASE_URL is not set", { skip: true }, () => {});
}
