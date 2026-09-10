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
import { ON_DEMAND_ARCHIVE_TTL_MS, __resetOnDemandArchiveForTests, loadFamilyArchiveOnDemand } from "../lib/family-archive.ts";

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
    if (!/loadFamilyArchive(OnDemand)?\s*\(/.test(source)) continue;
    if (source.includes("renderOnDemand()")) continue;
    if (/export const dynamic\s*=\s*"force-dynamic"/.test(source)) continue;
    offenders.push("/" + route.join("/"));
  }
  assert.deepEqual(offenders, [], "these pages would ship build-time mock HTML as their first response");
});

test("the three known on-demand pages are actually wired to it", () => {
  // Named explicitly so deleting the call from one of them fails here even if the scan above is
  // later loosened.
  for (const route of ["page.tsx", path.join("memory", "page.tsx"), path.join("about", "page.tsx")]) {
    const source = readFileSync(path.join(appDir, route), "utf8");
    assert.ok(source.includes("renderOnDemand()"), `${route} must opt out of build-time prerendering`);
    assert.ok(source.includes("loadFamilyArchiveOnDemand()"), `${route} must use the memoised archive read`);
    assert.ok(!/^export const revalidate/m.test(source), `${route} has no route cache, so it must not claim a revalidate window`);
  }
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
