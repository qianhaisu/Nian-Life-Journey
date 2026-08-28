import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

test("migration models assets and locations without binary columns", async () => {
  const sql = await read("drizzle/0000_real_data_foundation.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS media_assets/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS media_locations/);
  assert.match(sql, /UNIQUE \(media_asset_id, provider, variant\)/);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS media \(/);
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
