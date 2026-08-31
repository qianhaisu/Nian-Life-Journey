import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

test("migration models assets, locations, and the display-layer media table without binary columns", async () => {
  const sql = await read("drizzle/0000_platform_foundation.sql");
  assert.match(sql, /CREATE TABLE "media_assets"/);
  assert.match(sql, /CREATE TABLE "media_locations"/);
  assert.match(sql, /UNIQUE\("media_asset_id","provider","variant"\)/);
  // Display-layer Media (src/thumbnailSrc/alt/...) now has its own table — added this slice to
  // close the schema/type drift where it was a Store field with no PostgreSQL table at all.
  assert.match(sql, /CREATE TABLE "media"/);
  assert.doesNotMatch(sql, /\bbytea\b/i, "media tables must stay metadata-only — no binary columns");
});

test("runtime boundaries keep Quark out of page requests", async () => {
  const route = await read("app/api/media/[id]/route.ts");
  const connector = await read("tools/quark-connector/README.md");
  assert.match(route, /locationForMedia/);
  assert.match(connector, /not a web runtime dependency/);
  assert.match(connector, /explicit folder/);
});

test("ingestion endpoint is independently authenticated", async () => {
  const route = await read("app/api/internal/ingest/route.ts");
  assert.match(route, /INGESTION_TOKEN/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /toQuarkStructuredError/);
});

test("Quark authorization diagnostics are read-only and separately protected", async () => {
  const route = await read("app/api/internal/quark/status/route.ts");
  assert.match(route, /INGESTION_TOKEN/);
  assert.match(route, /QuarkCliAdapter/);
  assert.match(route, /checkAuth/);
  assert.match(route, /officialCode/);
  assert.doesNotMatch(route, /login|--token|cookie|account/);
});
