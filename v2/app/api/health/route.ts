import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

// Which build is answering. 2026-09-13: a scan taken right after a deploy read the same 242/327
// as before the change and was nearly reported as "the fix did not ship" — nothing on the site
// said which code produced the HTML being measured. `sha` is the commit the image was built from
// (Dockerfile build arg; null for a build that was not given one), `id` is Next's own BUILD_ID,
// which every rendered page also carries in its flight data, so a page can be matched to the
// build that rendered it rather than assumed to be current.
function buildInfo() {
  let id: string | null = null;
  try { id = readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim() || null; } catch { id = null; }
  return { sha: process.env.NIANLIFE_BUILD_SHA?.trim() || null, id };
}

// Minimal connectivity probe for Cowork's巡检, not a full readiness contract. Never cacheable —
// a stale "ok" is worse than a slow real check.
export async function GET() {
  const startedAt = Date.now();
  const build = buildInfo();
  try {
    const [{ count: rawSourceCount }] = await getDb().select({ count: sql<number>`count(*)` }).from(t.rawSources);
    const [{ count: mediaCount }] = await getDb().select({ count: sql<number>`count(*)` }).from(t.media);
    return NextResponse.json(
      { ok: true, db: "connected", rawSourceCount: Number(rawSourceCount), mediaCount: Number(mediaCount), latencyMs: Date.now() - startedAt, build },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, db: "error", message: error instanceof Error ? error.message : "unknown", build },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
