"use server";

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { appendUpload, newId, undoOrganization } from "@/lib/db/repository";
import { organizeSources } from "@/lib/organizer/rule-based";
import type { Media, MediaAsset, MediaLocation, RawSource, SourceType, Visibility } from "@/lib/types";

const allowed = new Map<string, [string, number]>([
  ["image/jpeg", ["family_photo", 15]], ["image/png", ["family_photo", 15]], ["image/webp", ["family_photo", 15]],
  ["image/heic", ["family_photo", 15]], ["video/mp4", ["family_video", 200]], ["video/quicktime", ["family_video", 200]],
  ["application/pdf", ["medical_document", 20]],
]);
const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);

export async function captureSources(formData: FormData) {
  const capturedAt = String(formData.get("capturedAt") || new Date().toISOString());
  const contributorId = String(formData.get("contributorId") || "contributor-dad");
  const kind = String(formData.get("kind") || "family_photo");
  const visibility = kind === "medical_document" ? "private" : (String(formData.get("visibility") || "family") as Visibility);
  const note = String(formData.get("text") || "").trim();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (!files.length && !note) throw new Error("请选择文件或写下一句话");
  const sourceId = newId("source");
  const media: Media[] = [];
  const assets: MediaAsset[] = [];
  const locations: MediaLocation[] = [];
  const mediaDir = path.join(process.cwd(), ".data", "media");
  await fs.mkdir(mediaDir, { recursive: true });

  for (const file of files) {
    const rule = allowed.get(file.type);
    if (!rule || file.size > rule[1] * 1024 * 1024) throw new Error(file.name + " 的格式或大小不符合要求");
    const mediaId = newId("media");
    const assetId = newId("asset");
    const filename = assetId + "-" + safeName(file.name);
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(mediaDir, filename), bytes);
    const type = file.type.startsWith("video/") ? "video" : "photo";
    const now = new Date().toISOString();
    const objectKey = "media/" + filename;
    assets.push({ id: assetId, profileId: "profile-zhangnian", rawSourceId: sourceId, mediaType: type, mimeType: file.type, originalFilename: file.name, checksum: createHash("sha256").update(bytes).digest("hex"), createdAt: now });
    locations.push({ id: newId("location"), mediaAssetId: assetId, provider: "hot", variant: "original", providerRef: objectKey, mimeType: file.type, fileSize: file.size, status: "awaiting_archive", createdAt: now, updatedAt: now });
    const variants = type === "photo" ? ["thumbnail", "web"] as const : ["poster"] as const;
    for (const variant of variants) locations.push({ id: newId("location"), mediaAssetId: assetId, provider: "hot", variant, providerRef: objectKey, mimeType: file.type, status: "pending", createdAt: now, updatedAt: now });
    media.push({ id: mediaId, profileId: "profile-zhangnian", rawSourceId: sourceId, mediaAssetId: assetId, type, src: "/api/media/" + mediaId, objectKey, originalFilename: file.name, mimeType: file.type, fileSize: file.size, alt: note || file.name, takenAt: capturedAt, visibility, width: 1200, height: 900 });
  }

  const sourceType = (kind === "daycare" ? "daycare_photo" : kind) as SourceType;
  const source: RawSource = { id: sourceId, profileId: "profile-zhangnian", sourceType, contentTypes: kind === "medical_document" ? ["health"] : kind === "daycare" ? ["daycare", "daily"] : ["daily", "family"], contributorId, capturedAt, importedAt: new Date().toISOString(), text: note || undefined, mediaIds: media.map((item) => item.id), sourceLabel: kind === "daycare" ? "托班记录" : kind === "medical_document" ? "医疗资料" : "家庭记录", visibility, status: "uploaded", originalFilename: files.length === 1 ? files[0].name : undefined, metadata: { uploadCount: files.length, storage: "hot-staging", archiveStatus: files.length ? "awaiting_archive" : "not_applicable" } };
  await appendUpload({ source, media, assets, locations });
  const result = await organizeSources([sourceId]);
  return { sourceId, result, count: files.length + (note ? 1 : 0) };
}

export async function undoCapture(sourceId: string, eventId: string) {
  await undoOrganization([sourceId], eventId);
  return { ok: true };
}
