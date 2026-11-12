import { SECTIONS } from "@/lib/features";
import { createHealthRecordHandler } from "@/lib/health/record/http";

// HEALTH-03 record API. Off when SECTIONS.health is false or HEALTH_RECORD_* is unconfigured (see docs/health-tracking-batch-03-report-2026-09-21.md).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handle = createHealthRecordHandler();
type Ctx = { params: Promise<{ path: string[] }> };
const disabled = () =>
  Response.json({ ok: false, code: "disabled", message: "健康记录没有启用。" }, { status: 404, headers: { "cache-control": "no-store" } });
const run = async (req: Request, ctx: Ctx) => {
  if (!SECTIONS.health) return disabled();
  return handle(req, (await ctx.params).path);
};
export const GET = run;
export const POST = run;
export const PUT = run;
export const PATCH = run;
export const DELETE = run;
