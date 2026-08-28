import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getConnectorState } from "@/lib/db/repository";
import { QuarkCliAdapter } from "@/tools/quark-connector/cli-adapter";

function authorized(request: Request) {
  const expected = process.env.INGESTION_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected); const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profileId = new URL(request.url).searchParams.get("profileId") || "profile-zhangnian";
  const adapter = new QuarkCliAdapter({ sessionInput: "Nian Life V2 Quark authorization status" });
  const auth = await adapter.checkAuth();
  const connector = await getConnectorState("quark", profileId);
  return NextResponse.json({
    status: auth.status,
    code: auth.code,
    officialCode: auth.officialCode,
    officialMessage: auth.officialMessage,
    message: auth.message,
    connector: connector ? { status: connector.status, pendingArchiveCount: connector.pendingArchiveCount, lastSuccessfulSync: connector.lastSuccessfulSync, updatedAt: connector.updatedAt } : undefined,
  }, { status: auth.status === "unavailable" ? 503 : 200 });
}