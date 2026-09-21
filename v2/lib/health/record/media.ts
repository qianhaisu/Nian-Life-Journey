// Private storage for uploaded report images. The ORIGINAL bytes are kept (content-addressed by SHA-256, so a retry writes the
// same file); a bounded preview thumbnail is derived separately and is never used in place of the original.
// Type and size are decided from the actual bytes (decoded by sharp), not from the filename or the client's Content-Type.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";

export class RecordError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

export const IMAGE_LIMITS = { maxFiles: 8, maxFileBytes: 12 * 1024 * 1024, maxTotalBytes: 40 * 1024 * 1024 };
const EXT: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp", gif: "gif" };
const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
export const HASH_RE = /^[0-9a-f]{64}$/;

export interface InspectedImage { sha256: string; ext: string; mime: string; bytes: number; width: number; height: number; name: string; data: Buffer; thumb: Buffer }

const cleanName = (n: string) => n.replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_").slice(0, 80) || "图片";

export async function inspectImage(name: string, data: Buffer): Promise<InspectedImage> {
  const label = cleanName(name);
  if (data.length === 0) throw new RecordError(400, "bad_image", `“${label}”是空文件，请重新选择。`);
  if (data.length > IMAGE_LIMITS.maxFileBytes) throw new RecordError(413, "image_too_large", `“${label}”超过 ${IMAGE_LIMITS.maxFileBytes / 1048576} MB，请压缩后再传。`);
  let meta: Metadata;
  try { meta = await sharp(data).metadata(); } catch { throw new RecordError(400, "bad_image", `“${label}”不是可识别的图片，请换一张（支持 JPG、PNG、WebP、GIF）。`); }
  const ext = meta.format ? EXT[meta.format] : undefined;
  if (!ext || !meta.width || !meta.height) throw new RecordError(400, "bad_image", `“${label}”的格式不支持（支持 JPG、PNG、WebP、GIF；手机相册的 HEIC 请先转成 JPG）。`);
  let thumb: Buffer;
  try { thumb = await sharp(data).rotate().resize(480, 480, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer(); }
  catch { throw new RecordError(400, "bad_image", `“${label}”的图片数据不完整，无法打开，请重新选择。`); }
  const swap = (meta.orientation ?? 1) >= 5; // EXIF 5-8 are rotated 90/270: report the displayed size
  return { sha256: createHash("sha256").update(data).digest("hex"), ext, mime: MIME[ext], bytes: data.length, width: swap ? meta.height : meta.width, height: swap ? meta.width : meta.height, name: label, data, thumb };
}

export class OriginalsStore {
  constructor(private root: string, private hooks: { failWrite?: () => boolean } = {}) {}
  private file(kind: "originals" | "thumbs", sha: string, ext: string) { return path.join(this.root, kind, `${sha}.${ext}`); }
  private async put(file: string, data: Buffer) {
    try { if ((await stat(file)).size === data.length) return; } catch { /* not there yet */ }
    if (this.hooks.failWrite?.()) throw new RecordError(500, "storage_failed", "原图没有保存成功，请稍后重试。");
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(tmp, data); await rename(tmp, file); }
    catch { await rm(tmp, { force: true }); throw new RecordError(500, "storage_failed", "原图没有保存成功，请稍后重试。"); }
  }
  async save(img: InspectedImage) {
    await this.put(this.file("originals", img.sha256, img.ext), img.data);
    await this.put(this.file("thumbs", img.sha256, "jpg"), img.thumb);
  }
  /** Only ever builds a path from a validated hash and an extension from our own allow-list. */
  async read(sha: string, ext: string, thumb: boolean): Promise<{ data: Buffer; mime: string } | null> {
    if (!HASH_RE.test(sha) || !MIME[ext]) return null;
    try {
      if (thumb) return { data: await readFile(this.file("thumbs", sha, "jpg")), mime: "image/jpeg" };
      return { data: await readFile(this.file("originals", sha, ext)), mime: MIME[ext] };
    } catch { return null; }
  }
}
