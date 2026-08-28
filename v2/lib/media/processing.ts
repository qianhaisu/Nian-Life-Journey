import sharp from "sharp";
import type { MediaAsset, MediaVariant } from "@/lib/types";

export type DerivativeOutput = { variant: MediaVariant; body: Uint8Array; mimeType: string; width: number; height: number };

const videoPlaceholder = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#28251f"/><circle cx="640" cy="360" r="72" fill="#d8bd75"/><path d="m615 320 72 40-72 40z" fill="#28251f"/><text x="640" y="500" fill="#f6f0e5" font-family="sans-serif" font-size="28" text-anchor="middle">视频预览稍后可用</text></svg>`;
const documentPlaceholder = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 1280"><rect width="960" height="1280" fill="#eee6d8"/><rect x="180" y="160" width="600" height="820" fill="#fbf8f0" stroke="#28251f"/><path d="M260 360h440M260 440h440M260 520h320" stroke="#8c806e" stroke-width="18"/><text x="480" y="1090" fill="#28251f" font-family="sans-serif" font-size="30" text-anchor="middle">文档预览</text></svg>`;

export async function sourceImageMetadata(bytes: Uint8Array) {
  const metadata = await sharp(bytes).metadata();
  const rotates = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
  return { width: rotates ? metadata.height : metadata.width, height: rotates ? metadata.width : metadata.height };
}

export async function createDerivatives(asset: MediaAsset, bytes: Uint8Array): Promise<DerivativeOutput[]> {
  if (asset.mediaType === "video") return [{ variant: "poster", body: Buffer.from(videoPlaceholder), mimeType: "image/svg+xml", width: 1280, height: 720 }];
  if (asset.mediaType === "document") return [{ variant: "document_preview", body: Buffer.from(documentPlaceholder), mimeType: "image/svg+xml", width: 960, height: 1280 }];
  const image = sharp(bytes).rotate();
  const outputs: DerivativeOutput[] = [];
  for (const [variant, width] of [["thumbnail", 480], ["web", 1280]] as const) {
    const result = await image.clone().resize({ width, fit: "inside", withoutEnlargement: true }).webp({ quality: variant === "thumbnail" ? 78 : 84 }).toBuffer({ resolveWithObject: true });
    outputs.push({ variant, body: result.data, mimeType: "image/webp", width: result.info.width, height: result.info.height });
  }
  return outputs;
}
