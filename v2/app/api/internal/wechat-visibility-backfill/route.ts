import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";

// Temporary, scoped fix-forward route for the 2026-09-01 broken-WeChat-photo investigation.
// wechat-import.ts hardcoded visibility:"private" for every WeChat RawSource/Media row with no
// promotion step afterward, which (a) propagated into LifeEvent/DailyTrace visibility via the
// "private if any source is private" rule and (b) made every WeChat photo permanently invisible
// to /api/media/[id]'s fail-closed private gate. The code default is fixed separately in
// wechat-import.ts; this route backfills already-persisted rows. Scope is deliberately narrow:
// - Only raw_sources with source_type = 'wechat' (never medical_document/checkup_document, and
//   wechat sources always carry contentTypes ["family"], never "health" — see isMedicalSource).
// - life_events/daily_traces are promoted only when EVERY linked source is wechat-sourced; any
//   record mixed with a non-wechat (so potentially genuinely private) source is left untouched.
// - care_episodes are never touched — visibility is hardcoded "private" there regardless of
//   source, by design, and this route contains no write to that table.
// GET runs the read-only audit (before-counts). POST runs the actual backfill transactionally
// and returns before/after counts. Both are Bearer-gated by MEDIA_DIAG_TOKEN. Remove this route
// and the env var once the investigation is closed.
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const expected = process.env.MEDIA_DIAG_TOKEN;
  const auth = request.headers.get("authorization");
  return Boolean(expected) && auth === `Bearer ${expected}`;
}

const allWechatSources = sql`
  jsonb_array_length(source_ids) > 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(source_ids) AS sid
    WHERE NOT EXISTS (SELECT 1 FROM raw_sources rs WHERE rs.id = sid AND rs.source_type = 'wechat')
  )
`;

async function count(db: ReturnType<typeof getDb>, query: ReturnType<typeof sql>) {
  const result = await db.execute(query);
  return Number((result.rows[0] as { n: number | string }).n);
}

async function audit(db: ReturnType<typeof getDb>) {
  return {
    rawSourcesWechatPrivate: await count(db, sql`SELECT count(*)::int AS n FROM raw_sources WHERE source_type = 'wechat' AND visibility = 'private'`),
    mediaWechatPrivate: await count(db, sql`SELECT count(*)::int AS n FROM media m JOIN raw_sources rs ON rs.id = m.raw_source_id WHERE rs.source_type = 'wechat' AND m.visibility = 'private'`),
    lifeEventsAllWechatPrivate: await count(db, sql`SELECT count(*)::int AS n FROM life_events WHERE visibility = 'private' AND (${allWechatSources})`),
    lifeEventsMixedPrivate_untouched: await count(db, sql`SELECT count(*)::int AS n FROM life_events WHERE visibility = 'private' AND NOT (${allWechatSources})`),
    dailyTracesAllWechatPrivate: await count(db, sql`SELECT count(*)::int AS n FROM daily_traces WHERE visibility = 'private' AND (${allWechatSources})`),
    dailyTracesMixedPrivate_untouched: await count(db, sql`SELECT count(*)::int AS n FROM daily_traces WHERE visibility = 'private' AND NOT (${allWechatSources})`),
    careEpisodesTotal_neverTouched: await count(db, sql`SELECT count(*)::int AS n FROM care_episodes`),
  };
}

export async function GET(request: Request) {
  if (!authorized(request)) return new NextResponse("Not found", { status: 404 });
  const db = getDb();
  return NextResponse.json({ before: await audit(db) });
}

export async function POST(request: Request) {
  if (!authorized(request)) return new NextResponse("Not found", { status: 404 });
  const url = new URL(request.url);
  if (url.searchParams.get("confirm") !== "yes") return NextResponse.json({ error: "pass ?confirm=yes to execute the backfill" }, { status: 400 });

  const db = getDb();
  const before = await audit(db);
  const updated = await db.transaction(async (tx) => {
    const rawSources = await tx.update(t.rawSources).set({ visibility: "family" }).where(and(eq(t.rawSources.sourceType, "wechat"), eq(t.rawSources.visibility, "private"))).returning({ id: t.rawSources.id });
    const media = await tx.execute(sql`
      UPDATE media SET visibility = 'family'
      WHERE visibility = 'private' AND raw_source_id IN (SELECT id FROM raw_sources WHERE source_type = 'wechat')
      RETURNING id
    `);
    const lifeEvents = await tx.execute(sql`
      UPDATE life_events SET visibility = 'family'
      WHERE visibility = 'private' AND (${allWechatSources})
      RETURNING id
    `);
    const dailyTraces = await tx.execute(sql`
      UPDATE daily_traces SET visibility = 'family'
      WHERE visibility = 'private' AND (${allWechatSources})
      RETURNING id
    `);
    return { rawSources: rawSources.length, media: media.rows.length, lifeEvents: lifeEvents.rows.length, dailyTraces: dailyTraces.rows.length };
  });
  const after = await audit(db);
  return NextResponse.json({ before, updated, after });
}
