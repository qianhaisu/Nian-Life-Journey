import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ingestQuarkFile, type QuarkFile } from "@/lib/ingest/quark";

function authorized(request: Request) {
  const expected = process.env.INGESTION_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected); const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { file?: QuarkFile; profileId?: string; contributorId?: string; visibility?: "private" | "family" | "public" };
  if (!body.file || !body.profileId || !body.contributorId) return NextResponse.json({ error: "file, profileId and contributorId are required" }, { status: 400 });
  if (body.file.providerRef.length > 512 || !body.file.filename) return NextResponse.json({ error: "Invalid Quark file metadata" }, { status: 400 });
  const result = await ingestQuarkFile(body.file, { profileId: body.profileId, contributorId: body.contributorId, visibility: body.visibility ?? "family" });
  return NextResponse.json(result, { status: 201 });
}
