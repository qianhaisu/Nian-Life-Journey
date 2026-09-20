import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { getStorageForProvider, resolveReadPreference } from "@/lib/storage/hot-storage";
import type { MediaProvider } from "@/lib/types";

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

/**
 * Can the site actually serve a photograph right now?
 *
 * Why this exists (2026-09-20). For about 2.5 hours every photograph on nianlife.cn timed out
 * while this endpoint kept answering `ok: true` and Docker kept the container marked healthy — the
 * check counted Postgres rows and never touched object storage, which was the half that was
 * broken. Counting rows says the archive still knows about 11,554 photos; it says nothing about
 * whether one of them can be delivered.
 *
 * It reads one byte of one real derivative, through the same getStorageForProvider() routing the
 * delivery route uses, so it fails exactly when delivery fails.
 *
 * It deliberately does NOT affect `ok`. Docker's HEALTHCHECK marks the container unhealthy on a
 * non-2xx here (see Dockerfile), and scripts/deploy-ecs-public.sh's swap waits for healthy before
 * finishing — so letting a transient object-storage blip fail this response would turn a storage
 * hiccup into a blocked or rolled-back deploy. `ok` stays a statement about the database; `media`
 * is a separate reading for whoever is looking.
 */
async function mediaProbe(): Promise<{ reachable: boolean; provider: string | null; latencyMs: number | null; error?: string }> {
  const startedAt = Date.now();
  try {
    // Probe the tier the site actually serves from, not whichever row comes back first. The
    // database holds both "oss" and "hot" rows for most photographs and selectLocation() picks by
    // resolveReadPreference(); a bare `limit 1` picked a "hot" row on the first deploy of this
    // probe and reported the site unreachable while every photograph was loading fine — "hot"
    // resolves to local disk in this deployment and those bytes live in OSS. A probe that cries
    // wolf is worse than no probe.
    const preference = resolveReadPreference();
    const ready = and(eq(t.mediaLocations.status, "ready"), eq(t.mediaLocations.variant, "web"));
    const pick = async (provider?: string) => {
      const [found] = await getDb()
        .select({ provider: t.mediaLocations.provider, providerRef: t.mediaLocations.providerRef })
        .from(t.mediaLocations)
        .where(provider ? and(ready, eq(t.mediaLocations.provider, provider)) : ready)
        .limit(1);
      return found;
    };
    const row = (await pick(preference)) ?? (await pick());
    if (!row) return { reachable: false, provider: null, latencyMs: null, error: "no ready web derivative to probe" };

    const storage = getStorageForProvider(row.provider as MediaProvider);
    // One byte, not the whole object — this runs every 30s and a web derivative averages 120 KB.
    // A backend with no ranged read falls back to a full fetch, which is why the timeout is here.
    const signal = AbortSignal.timeout(Number(process.env.HEALTH_MEDIA_TIMEOUT_MS ?? 3000));
    const bytes = storage.getRange
      ? await storage.getRange(row.providerRef, 0, 0, signal)
      : await storage.getStream(row.providerRef, signal);
    if (!bytes) return { reachable: false, provider: row.provider, latencyMs: Date.now() - startedAt, error: "object storage returned nothing" };
    // Draining matters: an unread stream is a checked-out socket, which is the very leak that
    // caused the outage this probe exists to catch.
    await new Response(bytes).arrayBuffer();
    return { reachable: true, provider: row.provider, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { reachable: false, provider: null, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : "unknown" };
  }
}

// Minimal connectivity probe for Cowork's巡检, not a full readiness contract. Never cacheable —
// a stale "ok" is worse than a slow real check.
export async function GET() {
  const startedAt = Date.now();
  const build = buildInfo();
  try {
    const [{ count: rawSourceCount }] = await getDb().select({ count: sql<number>`count(*)` }).from(t.rawSources);
    const [{ count: mediaCount }] = await getDb().select({ count: sql<number>`count(*)` }).from(t.media);
    const media = await mediaProbe();
    return NextResponse.json(
      { ok: true, db: "connected", media, rawSourceCount: Number(rawSourceCount), mediaCount: Number(mediaCount), latencyMs: Date.now() - startedAt, build },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, db: "error", message: error instanceof Error ? error.message : "unknown", build },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
