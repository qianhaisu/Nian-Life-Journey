import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

// Minimal connectivity probe for Cowork's巡检, not a full readiness contract. Never cacheable —
// a stale "ok" is worse than a slow real check.
export async function GET() {
  const startedAt = Date.now();
  try {
    const [{ count: rawSourceCount }] = await getDb().select({ count: sql<number>`count(*)` }).from(t.rawSources);
    const [{ count: mediaCount }] = await getDb().select({ count: sql<number>`count(*)` }).from(t.media);
    return NextResponse.json(
      { ok: true, db: "connected", rawSourceCount: Number(rawSourceCount), mediaCount: Number(mediaCount), latencyMs: Date.now() - startedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, db: "error", message: error instanceof Error ? error.message : "unknown" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
