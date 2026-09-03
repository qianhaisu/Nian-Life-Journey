#!/usr/bin/env node
// READ-ONLY against production: pulls the real Store once through the real PostgreSQL repository
// (same mapping, same publication gate the site uses) and writes it to .data/nian-life.json so the
// local dev server can render REAL production data through the JSON backend at interactive speed.
// The previous local JSON store is backed up beside it first. Never writes to the database.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

process.env.REPOSITORY_BACKEND = "postgres";
if (!process.env.DATABASE_URL) { console.error("Need DATABASE_URL (run with dotenv over v2/.env.local)."); process.exit(1); }

const { getStore } = await import("../lib/db/repository.ts");

const dataDir = path.join(process.cwd(), ".data");
const storeFile = path.join(dataDir, "nian-life.json");

console.log("Reading full production store through the real repository (this can take minutes)…");
const started = Date.now();
const store = await getStore();
console.log(`getStore() done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`profile=${store.profile.id} events(publishable)=${store.events.length} traces(publishable)=${store.dailyTraces.length} media=${store.media.length} rawSources=${store.rawSources.length} reviews=${store.qualityReviews.length} locations=${store.mediaLocations.length}`);

mkdirSync(dataDir, { recursive: true });
if (existsSync(storeFile)) {
  const backup = path.join(dataDir, `nian-life.json.bak-p1a2-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  copyFileSync(storeFile, backup);
  console.log(`backed up previous local store → ${backup}`);
}
writeFileSync(storeFile, JSON.stringify(store, null, 1), "utf8");
console.log(`wrote ${storeFile}`);
process.exit(0);
