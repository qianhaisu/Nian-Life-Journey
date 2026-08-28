"use server";

import { createHash } from "node:crypto";
import { appendUpload, newId, undoOrganization } from "@/lib/db/repository";
import { organizeSources } from "@/lib/organizer/rule-based";
import { createDerivatives, sourceImageMetadata } from "@/lib/media/processing";
import { mediaDeliveryUrl } from "@/lib/media/paths";
import { hotStorage } from "@/lib/storage/hot-storage";
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

  for (const file of files) {
    const rule = allowed.get(file.type);
    if (!rule || file.size > rule[1] * 1024 * 1024) throw new Error(file.name + " 的格式或大小不符合要求");
    const mediaId = newId("media");
    const assetId = newId("asset");
    const filename = safeName(file.name);
    const bytes = Buffer.from(await file.arrayBuffer());
    const type = file.type.startsWith("video/") ? "video" : file.type === "application/pdf" ? "document" : "photo";
    const now = new Date().toISOString();
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `media/original/${assetId}/${filename}`;
    await hotStorage.put({ key: objectKey, body: bytes, mimeType: file.type });
    const dimensions: { width?: number; height?: number } = type === "photo" ? await sourceImageMetadata(bytes) : {};
    const asset: MediaAsset = { id: assetId, profileId: "profile-zhangnian", rawSourceId: sourceId, mediaType: type, mimeType: file.type, width: dimensions.width, height: dimensions.height, originalFilename: file.name, checksum, archiveStatus: "awaiting_archive", createdAt: now };
    assets.push(asset);
    locations.push({ id: newId("location"), mediaAssetId: assetId, provider: "hot", variant: "original", providerRef: objectKey, mimeType: file.type, fileSize: file.size, width: dimensions.width, height: dimensions.height, status: "awaiting_archive", createdAt: now, updatedAt: now });
    try {
      for (const derivative of await createDerivatives(asset, bytes)) {
        const extension = derivative.mimeType === "image/webp" ? "webp" : "svg";
        const derivativeKey = `media/derivatives/${assetId}/${derivative.variant}.${extension}`;
        await hotStorage.put({ key: derivativeKey, body: derivative.body, mimeType: derivative.mimeType });
        locations.push({ id: newId("location"), mediaAssetId: assetId, provider: "hot", variant: derivative.variant, providerRef: derivativeKey, mimeType: derivative.mimeType, fileSize: derivative.body.byteLength, width: derivative.width, height: derivative.height, status: "ready", createdAt: now, updatedAt: now });
      }
    } catch {
      for (const variant of type === "photo" ? ["thumbnail", "web"] as const : type === "video" ? ["poster"] as const : ["document_preview"] as const) locations.push({ id: newId("location"), mediaAssetId: assetId, provider: "hot", variant, providerRef: "", status: "pending", createdAt: now, updatedAt: now });
    }
    const width = dimensions.width ?? (type === "document" ? 960 : 1280);
    const height = dimensions.height ?? (type === "document" ? 1280 : type === "video" ? 720 : 900);
    const firstVariant = type === "photo" ? "web" : type === "video" ? "poster" : "document_preview";
    media.push({ id: mediaId, profileId: "profile-zhangnian", rawSourceId: sourceId, mediaAssetId: assetId, type, src: mediaDeliveryUrl(mediaId, firstVariant), objectKey, originalFilename: file.name, mimeType: file.type, fileSize: file.size, alt: note || file.name, takenAt: capturedAt, visibility, width, height });
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
