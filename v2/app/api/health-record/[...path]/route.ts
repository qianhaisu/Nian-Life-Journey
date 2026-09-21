import { createHealthRecordHandler } from "@/lib/health/record/http";

// HEALTH-03 record API. Off unless HEALTH_RECORD_* is configured (see docs/health-tracking-batch-03-report-2026-09-21.md).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handle = createHealthRecordHandler();
type Ctx = { params: Promise<{ path: string[] }> };
const run = async (req: Request, ctx: Ctx) => handle(req, (await ctx.params).path);
export const GET = run;
export const POST = run;
export const DELETE = run;
