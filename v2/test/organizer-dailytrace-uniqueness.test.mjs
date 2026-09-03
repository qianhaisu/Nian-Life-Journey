// Database-enforced DailyTrace identity, under concurrency.
//
// The application half of this contract — fingerprint is the whole identity, a calendar day is only
// a grouping key — is pinned in organizer-dailytrace-identity.test.mjs and repository-contract.
// This file pins the half application code CANNOT enforce: two callers racing to persist the same
// fingerprint must produce ONE artifact.
//
// Why it needs a real database. persistDailyTrace() does SELECT-then-INSERT. Under READ COMMITTED
// the second transaction cannot see the first's uncommitted row, so both miss and both insert —
// that is exactly how production acquired 17 duplicate-fingerprint pairs. No in-memory simulator
// reproduces that, so this suite is SKIPPED rather than faked when CONTRACT_DATABASE_URL is unset.
//
// The fix has two halves and both are asserted here:
//   1. daily_traces_fingerprint_unique_idx makes the loser's INSERT fail instead of duplicating.
//   2. persistDailyTrace() catches that 23505 and retries once in a fresh transaction, so losing
//      the race is invisible to the caller — it resolves to the same artifact the winner created.
//
// Every row written here carries a synthetic profile id and is deleted afterwards; nothing else in
// the database is read or touched.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CONTRACT_DATABASE_URL, SKIP_REASON } from "./fixtures/contract-database.mjs";

const PROFILE_ID = "profile-contract-test-fixture";
const uid = (p) => `${p}-${randomUUID()}`;
const DAY = "2026-12-05";

const traceFixture = (fingerprint, overrides = {}) => ({
  id: uid("trace"), profileId: PROFILE_ID, occurredAt: `${DAY}T12:00:00`, entries: [], sourceIds: [],
  scopes: ["family"], visibility: "family",
  organizerRun: { organizerType: "ai", organizerVersion: "evidence-v6", organizationFingerprint: fingerprint },
  organizationFingerprint: fingerprint, ...overrides,
});

test("DailyTrace fingerprint uniqueness under concurrency", { skip: CONTRACT_DATABASE_URL ? false : SKIP_REASON }, async (t) => {
  const { createPostgresRepository } = await import("../lib/db/postgres-repository.ts");
  const pg = (await import("pg")).default;
  const repo = createPostgresRepository();

  const client = new pg.Client({ connectionString: CONTRACT_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  // Same synthetic profile repository-contract.test.mjs uses, created the same way. daily_traces has
  // a FK to profiles, so it has to exist before any row here can be written.
  await client.query(
    "insert into profiles (id, display_name, birth_date, timezone, visibility) values ($1, 'Contract Test Profile', '2020-01-01', 'UTC', 'private') on conflict (id) do nothing",
    [PROFILE_ID],
  );
  const written = new Set();
  const rowsFor = async (fingerprint) => {
    const { rows } = await client.query("select id, entries, source_ids, organizer_run from daily_traces where organization_fingerprint = $1 order by id", [fingerprint]);
    for (const r of rows) written.add(r.id);
    return rows;
  };
  t.after(async () => {
    // Only this suite's own rows, addressed by id.
    if (written.size) await client.query("delete from daily_traces where id = any($1)", [[...written]]);
    await client.query("delete from daily_traces where profile_id = $1 and occurred_at::date = $2", [PROFILE_ID, DAY]);
    await client.end();
  });

  await t.test("the unique index exists and is unique", async () => {
    const { rows } = await client.query("select indexdef from pg_indexes where tablename='daily_traces' and indexname='daily_traces_fingerprint_unique_idx'");
    assert.equal(rows.length, 1, "daily_traces_fingerprint_unique_idx must exist");
    assert.match(rows[0].indexdef, /CREATE UNIQUE INDEX/);
  });

  await t.test("two CONCURRENT writes of the same fingerprint produce one artifact", async () => {
    const fingerprint = uid("fp-race");
    const a = traceFixture(fingerprint, { entries: ["from writer A"], sourceIds: [] });
    const b = traceFixture(fingerprint, { entries: ["from writer B"], sourceIds: [] });

    // Genuinely concurrent: both promises are in flight before either is awaited, which is what
    // makes both SELECTs able to miss.
    const [resA, resB] = await Promise.all([repo.persistDailyTrace(a), repo.persistDailyTrace(b)]);

    const rows = await rowsFor(fingerprint);
    assert.equal(rows.length, 1, `expected exactly one row, got ${rows.length}`);

    // Both callers must resolve to the SAME artifact — neither gets a dangling id.
    assert.equal(resA.id, resB.id, "both callers must resolve to the same identity");
    assert.equal(resA.id, rows[0].id);

    // ...and no entry is lost by losing the race.
    const entries = rows[0].entries;
    assert.ok(entries.includes("from writer A"), "writer A's entry survived");
    assert.ok(entries.includes("from writer B"), "writer B's entry survived");
    assert.equal(entries.length, 2, "union, not duplication");
  });

  await t.test("a concurrent write links every source and mutates no review state", async () => {
    const fingerprint = uid("fp-links");
    const s1 = uid("src"), s2 = uid("src");
    const a = traceFixture(fingerprint, { entries: ["A"], sourceIds: [s1] });
    const b = traceFixture(fingerprint, { entries: ["B"], sourceIds: [s2] });
    await Promise.all([repo.persistDailyTrace(a), repo.persistDailyTrace(b)]);

    const rows = await rowsFor(fingerprint);
    assert.equal(rows.length, 1);
    assert.deepEqual([...rows[0].source_ids].sort(), [s1, s2].sort(), "no source link is dropped by the loser");

    // The artifact gets its own review lifecycle: a race must not create a ledger row, and must not
    // inherit one.
    const { rows: reviews } = await client.query("select * from content_quality_reviews where target_id = $1", [rows[0].id]);
    assert.equal(reviews.length, 0, "persisting a trace never writes a review decision");
  });

  await t.test("N concurrent writers of one fingerprint still produce one artifact", async () => {
    const fingerprint = uid("fp-many");
    const writers = Array.from({ length: 5 }, (_, i) => traceFixture(fingerprint, { entries: [`writer ${i}`] }));
    const results = await Promise.all(writers.map((w) => repo.persistDailyTrace(w)));

    const rows = await rowsFor(fingerprint);
    assert.equal(rows.length, 1, `expected one row, got ${rows.length}`);
    assert.equal(new Set(results.map((r) => r.id)).size, 1, "every caller resolves to the same identity");
    for (let i = 0; i < writers.length; i += 1) {
      assert.ok(rows[0].entries.includes(`writer ${i}`), `writer ${i}'s entry survived`);
    }
  });

  await t.test("two DIFFERENT fingerprints on the same day remain two artifacts", async () => {
    const morning = uid("fp-morning"), evening = uid("fp-evening");
    const m = await repo.persistDailyTrace(traceFixture(morning, { entries: ["morning"] }));
    const e = await repo.persistDailyTrace(traceFixture(evening, { entries: ["evening"] }));
    written.add(m.id); written.add(e.id);

    assert.notEqual(m.id, e.id, "different evidence is a different artifact");
    assert.equal((await rowsFor(morning)).length, 1);
    assert.equal((await rowsFor(evening)).length, 1);

    // ...and the read layer still shows one day as one day.
    const { buildChapters } = await import("../lib/memory-chapters.ts");
    const traces = [
      { ...traceFixture(morning), id: m.id, entries: ["morning"] },
      { ...traceFixture(evening), id: e.id, entries: ["evening"] },
    ];
    const chapters = buildChapters({ events: [], traces, media: [], birthDay: "2025-01-01" });
    const days = chapters.flatMap((c) => c.months ?? []).flatMap((m) => m.traceDays ?? []).filter((d) => d.day === DAY);
    assert.equal(days.length, 1, "two artifacts, one calendar day");
    assert.deepEqual(days[0].entries.sort(), ["evening", "morning"]);
  });

  await t.test("a sequential REPLAY of identical input is idempotent", async () => {
    const fingerprint = uid("fp-replay");
    const first = await repo.persistDailyTrace(traceFixture(fingerprint, { entries: ["once"], sourceIds: ["s-replay"] }));
    written.add(first.id);
    const before = await rowsFor(fingerprint);

    const second = await repo.persistDailyTrace(traceFixture(fingerprint, { entries: ["once"], sourceIds: ["s-replay"] }));
    const after = await rowsFor(fingerprint);

    assert.equal(after.length, 1, "replay creates no second row");
    assert.equal(second.id, first.id, "replay resolves to the same artifact");
    assert.deepEqual(after[0].entries, before[0].entries, "replay adds no duplicate entry");
    assert.deepEqual(after[0].source_ids, before[0].source_ids, "replay adds no duplicate source link");
  });

  await t.test("a trace with no fingerprint still has no identity to collide on", async () => {
    // Postgres treats NULLs as distinct in a btree unique index, so the anonymous path the
    // repository contract pins is unaffected by the new constraint.
    const a = await repo.persistDailyTrace({ ...traceFixture(undefined), organizationFingerprint: undefined, entries: ["anon a"] });
    const b = await repo.persistDailyTrace({ ...traceFixture(undefined), organizationFingerprint: undefined, entries: ["anon b"] });
    written.add(a.id); written.add(b.id);
    assert.notEqual(a.id, b.id, "two fingerprint-less traces stay two rows");
  });
});
