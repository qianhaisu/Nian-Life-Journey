// The refresh contract a publish uses to make the family pages show it on the next request
// (lib/archive-refresh.ts). The failure it exists for, 2026-09-13: a published story opened by its
// direct link while its month page kept serving pre-publish HTML, because the write never told the
// site and the month's ISR window plus stale-while-revalidate kept the old page for one more request
// after it lapsed. These tests pin what a notice must reach; the end-to-end cache behaviour against
// a real `next start` is exercised by the overnight isolation harness, not here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHIVE_ISR_ROUTES, archiveRefreshTargets, isArchivePath, parseRefreshRequest } from "../lib/archive-refresh.ts";
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

test("scope archive reaches every ISR route that renders the archive — found by scanning, not by list", () => {
  // Any page with a route cache that reads the archive (or one event of it) must be in the list, or
  // a publish leaves that page serving the past. Scanned so a new archive page cannot be forgotten.
  const isr = [];
  for (const file of pageFiles(appDir)) {
    const source = readFileSync(file, "utf8");
    if (!/^export const revalidate\s*=/m.test(source)) continue;
    // getEventDetail is reached through react's cache() wrapper on the event page, so match the name.
    if (!/loadFamilyArchive\(|\bgetEventDetail\b/.test(source)) continue;
    isr.push("/" + path.relative(appDir, path.dirname(file)).split(path.sep).join("/"));
  }
  assert.deepEqual([...isr].sort(), [...ARCHIVE_ISR_ROUTES].sort());
  const targets = archiveRefreshTargets();
  for (const route of ARCHIVE_ISR_ROUTES) {
    assert.ok(targets.some((t) => t.path === route && t.type === "page"), `${route} must be revalidated as a page pattern, which covers every concrete path under it`);
  }
});

test("scope archive also names the on-demand pages and clears their shared read", () => {
  const parsed = parseRefreshRequest({ scope: "archive" });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.clearsArchiveMemo, true);
  for (const p of [...ON_DEMAND_ARCHIVE_PATHS, "/preview"]) assert.ok(parsed.targets.some((t) => t.path === p && !t.type), p);
});

test("a month path alone clears the memo too, so /memory cannot lag the month it links to", () => {
  const parsed = parseRefreshRequest({ paths: ["/memory/2026/09"] });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.scope, "paths");
  assert.equal(parsed.clearsArchiveMemo, true);
  assert.deepEqual(parsed.targets, [{ path: "/memory/2026/09" }]);
  assert.equal(isArchivePath("/events/event-1"), true);
  assert.equal(isArchivePath("/memory"), true);
  assert.equal(isArchivePath("/preview/2025"), true);
  assert.equal(isArchivePath("/api/media/x"), false);
  assert.equal(isArchivePath("/memoryx"), false);
  assert.equal(parseRefreshRequest({ paths: ["/api/health"] }).clearsArchiveMemo, false);
});

test("the worker's existing body shape is still accepted unchanged", () => {
  const parsed = parseRefreshRequest({ paths: ["/", "/memory", "/memory/2026", "/memory/2026/08"] });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.targets.length, 4);
});

test("anything else is refused whole rather than half-applied", () => {
  for (const body of [null, {}, { scope: "everything" }, { paths: [] }, { paths: "memory" }, { paths: Array.from({ length: 51 }, (_, i) => `/p${i}`) }, { paths: ["relative"] }]) {
    assert.equal(parseRefreshRequest(body).ok, false, JSON.stringify(body)?.slice(0, 40));
  }
});

test("the route applies the parsed targets, with the pattern type, and clears the memo from the parse", () => {
  const route = readFileSync(path.join(appDir, "api", "internal", "revalidate", "route.ts"), "utf8");
  assert.ok(route.includes("parseRefreshRequest("), "the route must not keep its own copy of the body rules");
  assert.ok(/revalidatePath\(target\.path, target\.type\)/.test(route), "pattern targets must be revalidated with their type");
  assert.ok(/if \(parsed\.clearsArchiveMemo\) invalidateOnDemandArchive\(\)/.test(route));
  assert.ok(/authorized\(request\)/.test(route), "the notice stays behind the ingestion token");
});
