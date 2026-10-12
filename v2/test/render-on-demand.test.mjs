// A page with no dynamic params is prerendered at build by default, and the Docker builder stage
// has no DATABASE_URL — so the build renders it from lib/mock-data.ts and ships that HTML. Verified
// in the 2026-09-10 image: /, /memory and /about were all baked from the seed fixture and served
// mock until each page's own ISR window elapsed. These tests hold the two halves of the fix: every
// paramless page that reads the archive opts out of build-time prerendering, and the read those
// now-uncached pages do is memoised so "no route cache" does not mean "a whole-store read per
// request".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ISR_ARCHIVE_TTL_MS, ON_DEMAND_ARCHIVE_TTL_MS, __resetOnDemandArchiveForTests, invalidateOnDemandArchive, loadFamilyArchiveForIsr, loadFamilyArchiveOnDemand } from "../lib/family-archive.ts";
import { ON_DEMAND_ARCHIVE_PATHS } from "../lib/render-on-demand.ts";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");

function pageFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...pageFiles(full));
    else if (entry.name === "page.tsx") found.push(full);
  }
  return found;
}

test("every paramless page that reads the archive is rendered on demand, never prerendered from the build's mock store", () => {
  const offenders = [];
  for (const file of pageFiles(appDir)) {
    const route = path.relative(appDir, file).split(path.sep).slice(0, -1);
    // A route with a dynamic segment is already generated on demand: its generateStaticParams is
    // guarded by buildTimeArchiveEnumerationAllowed() (lib/db/config.ts) and returns nothing at
    // build time. Only paramless routes are prerendered unconditionally.
    if (route.some((segment) => segment.startsWith("["))) continue;
    const source = readFileSync(file, "utf8");
    // `readHomeFeed()` counts as reading the archive: it is lib/home-feed.ts's SSR entry point and
    // it awaits loadFamilyArchiveOnDemand() internally (HOME-20260913, 2026-09-13). Without it in
    // this pattern the front page — the one page this scan exists for — silently stopped being
    // scanned the moment it started reading through that wrapper, so a page that read the archive
    // and forgot renderOnDemand() would have shipped build-time mock HTML with nothing failing.
    if (!/(loadFamilyArchive(OnDemand)?|readHomeFeed)\s*\(/.test(source)) continue;
    if (source.includes("renderOnDemand()")) continue;
    if (/export const dynamic\s*=\s*"force-dynamic"/.test(source)) continue;
    offenders.push("/" + route.join("/"));
  }
  assert.deepEqual(offenders, [], "these pages would ship build-time mock HTML as their first response");
});

test("the three known on-demand pages are actually wired to it", () => {
  // Named explicitly so deleting the call from one of them fails here even if the scan above is
  // later loosened.
  for (const route of ["page.tsx", path.join("memory", "page.tsx"), path.join("mom-reports", "page.tsx")]) {
    const source = readFileSync(path.join(appDir, route), "utf8");
    assert.ok(source.includes("renderOnDemand()"), `${route} must opt out of build-time prerendering`);
    // Either the memoised read itself, or lib/home-feed.ts's readHomeFeed() — which is a wrapper
    // around exactly that read, asserted below rather than taken on trust. The front page moved to
    // the wrapper on 2026-09-13 (HOME-20260913); what must not be allowed is the RAW
    // loadFamilyArchive(), which is a whole-store read with no memo in front of it.
    assert.ok(
      /loadFamilyArchiveOnDemand\(\)|readHomeFeed\(/.test(source),
      `${route} must use the memoised archive read`,
    );
    assert.ok(!/^export const revalidate/m.test(source), `${route} has no route cache, so it must not claim a revalidate window`);
  }
  // The indirection allowed above is only safe while it really is an indirection to the memoised
  // read. Named here so that replacing it with loadFamilyArchive() inside home-feed.ts — a whole
  // store read on every single request — fails at this guard rather than on the egress bill
  // (CLAUDE.md, the 2026-09-06 $87 incident).
  const homeFeed = readFileSync(path.join(appDir, "..", "lib", "home-feed.ts"), "utf8");
  assert.ok(homeFeed.includes("loadFamilyArchiveOnDemand"), "readHomeFeed must reach the archive through the memoised read");
  assert.ok(!/await\s+loadFamilyArchive\(\)/.test(homeFeed), "readHomeFeed must never call the un-memoised whole-store read");
});

test("the on-demand archive read is shared within its window and re-read after it", async () => {
  __resetOnDemandArchiveForTests();
  let reads = 0;
  const archive = (label) => async () => { reads += 1; return { label, reads }; };

  const first = await loadFamilyArchiveOnDemand(archive("a"), 1_000);
  const second = await loadFamilyArchiveOnDemand(archive("b"), 1_000 + ON_DEMAND_ARCHIVE_TTL_MS - 1);
  assert.equal(reads, 1, "a second request inside the window must not re-read the whole store");
  assert.equal(second, first, "…and gets the same archive object");

  const third = await loadFamilyArchiveOnDemand(archive("c"), 1_000 + ON_DEMAND_ARCHIVE_TTL_MS);
  assert.equal(reads, 2, "once the window is over, the next request pays for a fresh read");
  assert.equal(third.label, "c");
});

test("concurrent first requests share one read instead of starting several", async () => {
  __resetOnDemandArchiveForTests();
  let reads = 0;
  const slow = async () => { reads += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { reads }; };
  const [one, two, three] = await Promise.all([
    loadFamilyArchiveOnDemand(slow, 5_000),
    loadFamilyArchiveOnDemand(slow, 5_000),
    loadFamilyArchiveOnDemand(slow, 5_000),
  ]);
  assert.equal(reads, 1);
  assert.equal(one, two);
  assert.equal(two, three);
});

test("a failed read is not pinned in front of the site for the rest of the window", async () => {
  __resetOnDemandArchiveForTests();
  await assert.rejects(() => loadFamilyArchiveOnDemand(async () => { throw new Error("database is down"); }, 9_000));
  const recovered = await loadFamilyArchiveOnDemand(async () => ({ label: "back" }), 9_001);
  assert.equal(recovered.label, "back", "the next request retries instead of replaying the failure");
  __resetOnDemandArchiveForTests();
});

test("a revalidate notification drops the memo, so the next read sees the new archive", () => {
  // scripts/nianlife-worker.mjs POSTs /api/internal/revalidate after every write and its path list
  // always contains "/" and "/memory" — the whole point being that new content does not wait out a
  // cache window. Those routes have no Next route cache any more, and revalidatePath() cannot see
  // this memo at all, so before this the push reported success and changed nothing for 300s.
  assert.deepEqual([...ON_DEMAND_ARCHIVE_PATHS], ["/", "/memory", "/mom-reports"]);
});

test("cache: filled, then notified, then the next read is fresh — and reuse still works in between", async () => {
  __resetOnDemandArchiveForTests();
  let reads = 0;
  const load = () => { reads += 1; return Promise.resolve({ generation: reads }); };

  const first = await loadFamilyArchiveOnDemand(load, 1_000);
  assert.equal(first.generation, 1);
  // Normal reuse: inside the window, no second read.
  assert.equal((await loadFamilyArchiveOnDemand(load, 1_100)).generation, 1);
  assert.equal(reads, 1);

  // The worker writes and notifies.
  invalidateOnDemandArchive();
  const afterNotice = await loadFamilyArchiveOnDemand(load, 1_200);
  assert.equal(afterNotice.generation, 2, "the very next read goes back to the archive, well inside the 300s window");
  assert.equal(reads, 2);

  // And the window restarts from there rather than expiring early.
  assert.equal((await loadFamilyArchiveOnDemand(load, 1_300)).generation, 2);
  assert.equal(reads, 2);
});

test("cache: a failed read still evicts itself, notification or not", async () => {
  __resetOnDemandArchiveForTests();
  let reads = 0;
  await assert.rejects(() => loadFamilyArchiveOnDemand(() => { reads += 1; return Promise.reject(new Error("db down")); }, 2_000));
  const recovered = await loadFamilyArchiveOnDemand(() => { reads += 1; return Promise.resolve({ generation: "back" }); }, 2_001);
  assert.equal(recovered.generation, "back");
  assert.equal(reads, 2, "the failure was not held in front of the site until the window lapsed");
  __resetOnDemandArchiveForTests();
});

// 2026-09-20: the ISR pages (year, month, day) used to call loadFamilyArchive() directly, so every
// cold render paid the whole-archive read again — measured at 38.1 MB against production, and the
// reason a cold day page took 4.3–5.0 s. They now share a memo on a much shorter TTL. Same three
// properties the on-demand memo is held to, asserted separately because the TTL differs on purpose.
test("the ISR archive read is memoised on its own short TTL, and a publish drops it", async () => {
  const archive = (tag) => async () => ({ tag });
  __resetOnDemandArchiveForTests();

  const first = await loadFamilyArchiveForIsr(archive("a"), 1_000);
  const second = await loadFamilyArchiveForIsr(archive("b"), 1_000 + ISR_ARCHIVE_TTL_MS - 1);
  assert.equal(second.tag, "a", "a render inside the window must reuse the read, not start another 38 MB one");

  const third = await loadFamilyArchiveForIsr(archive("c"), 1_000 + ISR_ARCHIVE_TTL_MS);
  assert.equal(third.tag, "c", "the TTL must actually expire");

  // The TTL is the backstop; the publish notice is the mechanism. invalidateOnDemandArchive() has
  // to clear BOTH memos or a publish refreshes the on-demand pages and leaves the months behind.
  invalidateOnDemandArchive();
  const afterPublish = await loadFamilyArchiveForIsr(archive("d"), 1_000 + ISR_ARCHIVE_TTL_MS);
  assert.equal(afterPublish.tag, "d", "a publish must drop the ISR memo immediately, not wait out its TTL");
});

test("the ISR TTL stays well under the on-demand one, so an ISR page's route cache plus memo is not double its promise", () => {
  assert.ok(ISR_ARCHIVE_TTL_MS < ON_DEMAND_ARCHIVE_TTL_MS / 2,
    `stacking this under a 300s route cache is only defensible while it stays small; got ${ISR_ARCHIVE_TTL_MS}ms`);
});
