import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { getR2Config } from "@/lib/storage/hot-storage";

// Temporary, read-only diagnostic route for the 2026-09-01 broken-photo investigation.
// Bearer-gated by MEDIA_DIAG_TOKEN (a token minted solely for this investigation). Returns
// existence/status/size facts only — never row content, credentials, or media bytes. Remove
// this route and the MEDIA_DIAG_TOKEN env var once the investigation is closed.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const expected = process.env.MEDIA_DIAG_TOKEN;
  const auth = request.headers.get("authorization");
  if (!expected || auth !== `Bearer ${expected}`) return new NextResponse("Not found", { status: 404 });

  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  if (!idsParam) return NextResponse.json({ error: "missing ids query param" }, { status: 400 });
  const ids = [...new Set(idsParam.split(",").map((value) => value.trim()).filter(Boolean))];

  const db = getDb();
  const mediaRows = await db.select().from(t.media).where(inArray(t.media.id, ids));
  const assetIds = [...new Set(mediaRows.map((row) => row.mediaAssetId).filter((value): value is string => Boolean(value)))];
  const assetRows = assetIds.length ? await db.select().from(t.mediaAssets).where(inArray(t.mediaAssets.id, assetIds)) : [];
  const locationRows = assetIds.length ? await db.select().from(t.mediaLocations).where(inArray(t.mediaLocations.mediaAssetId, assetIds)) : [];

  const { S3Client, HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const config = getR2Config();
  const client = new S3Client({ endpoint: config.endpoint, region: "auto", forcePathStyle: true, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });

  async function headObject(key: string) {
    try {
      const result = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      return { exists: true, size: result.ContentLength ?? null, contentType: result.ContentType ?? null };
    } catch (error) {
      return { exists: false, errorName: error instanceof Error ? error.name : "unknown" };
    }
  }

  const results = [];
  for (const id of ids) {
    const media = mediaRows.find((row) => row.id === id);
    if (!media) { results.push({ id, mediaFound: false }); continue; }
    const asset = assetRows.find((row) => row.id === media.mediaAssetId);
    const locations = locationRows.filter((row) => row.mediaAssetId === media.mediaAssetId);
    const webLocation = locations.find((row) => row.provider === "hot" && row.variant === "web");
    const r2 = webLocation ? await headObject(webLocation.providerRef) : null;
    results.push({
      id,
      mediaFound: true,
      mediaVisibility: media.visibility,
      mediaAssetId: media.mediaAssetId,
      assetFound: Boolean(asset),
      assetArchiveStatus: asset?.archiveStatus ?? null,
      assetHasChecksum: Boolean(asset?.checksum),
      locations: locations.map((row) => ({ provider: row.provider, variant: row.variant, status: row.status, mimeType: row.mimeType, fileSize: row.fileSize })),
      r2,
    });
  }

  return NextResponse.json({ requested: ids.length, found: mediaRows.length, results });
}
