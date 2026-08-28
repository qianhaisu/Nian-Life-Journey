import { promises as fs } from "node:fs";
import path from "node:path";
import type { MediaAsset, MediaLocation, MediaVariant } from "@/lib/types";

export type HotStorageObject = { providerRef: string; mimeType: string; fileSize?: number; width?: number; height?: number };
export type HotStorageInput = { key: string; body: Uint8Array; mimeType: string };

export interface HotStorage {
  put(input: HotStorageInput): Promise<HotStorageObject>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  url(location: MediaLocation): string | null;
}

function safeKey(key: string) {
  const normalized = key.replaceAll("\\", "/");
  if (!normalized.startsWith("media/") || normalized.includes("..")) throw new Error("Unsafe storage key");
  return normalized;
}

// The local adapter is intentionally credential-free and is also the staging
// implementation used by the development repository.
export class LocalHotStorage implements HotStorage {
  private readonly root = path.join(process.cwd(), ".data");

  async put(input: HotStorageInput) {
    const key = safeKey(input.key);
    await fs.mkdir(path.dirname(path.join(this.root, key)), { recursive: true });
    await fs.writeFile(path.join(this.root, key), input.body);
    return { providerRef: key, mimeType: input.mimeType, fileSize: input.body.byteLength };
  }

  async get(key: string) {
    try { return await fs.readFile(path.join(this.root, safeKey(key))); }
    catch { return null; }
  }

  async delete(key: string) { await fs.rm(path.join(this.root, safeKey(key)), { force: true }); }
  url(location: MediaLocation) { return location.provider === "hot" && location.variant !== "original" && location.status === "ready" ? "/api/media/" + location.mediaAssetId + "?variant=" + location.variant : null; }
}

type R2Config = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; publicBaseUrl?: string };

export function getR2Config(env: NodeJS.ProcessEnv = process.env): R2Config {
  const required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`R2 storage is selected but missing: ${missing.join(", ")}`);
  return {
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: env.R2_BUCKET!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    publicBaseUrl: env.R2_PUBLIC_BASE_URL,
  };
}

export class R2HotStorage implements HotStorage {
  private readonly config: R2Config;
  private readonly client: Promise<{ send(command: unknown): Promise<unknown> }>;

  constructor(config = getR2Config()) {
    this.config = config;
    this.client = import("@aws-sdk/client-s3").then(({ S3Client }) => new S3Client({ endpoint: config.endpoint, region: "auto", forcePathStyle: true, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }));
  }

  async put(input: HotStorageInput) {
    const key = safeKey(input.key);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.client).send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: input.body, ContentType: input.mimeType }));
    return { providerRef: key, mimeType: input.mimeType, fileSize: input.body.byteLength };
  }

  async get(key: string) {
    try {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const result = await (await this.client).send(new GetObjectCommand({ Bucket: this.config.bucket, Key: safeKey(key) })) as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } };
      if (!result.Body) return null;
      return result.Body.transformToByteArray ? result.Body.transformToByteArray() : null;
    } catch { return null; }
  }

  async delete(key: string) { const { DeleteObjectCommand } = await import("@aws-sdk/client-s3"); await (await this.client).send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: safeKey(key) })); }
  url(location: MediaLocation) {
    if (location.provider !== "hot" || location.variant === "original" || location.status !== "ready") return null;
    return this.config.publicBaseUrl ? `${this.config.publicBaseUrl.replace(/\/$/, "")}/${encodeURI(location.providerRef)}` : null;
  }
}

export function createHotStorage(env: NodeJS.ProcessEnv = process.env): HotStorage {
  return env.MEDIA_STORAGE_PROVIDER === "r2" ? new R2HotStorage(getR2Config(env)) : new LocalHotStorage();
}

export const hotStorage = createHotStorage();

export function preferredVariant(asset: MediaAsset, requested: MediaVariant = "web"): MediaVariant[] {
  if (asset.mediaType === "video") return requested === "preview" ? ["preview", "poster"] : ["poster"];
  if (asset.mediaType === "document" || asset.mimeType === "application/pdf") return ["document_preview"];
  if (requested === "original") return ["original"];
  return requested === "thumbnail" ? ["thumbnail", "web"] : ["web", "thumbnail"];
}

export function selectLocation(locations: MediaLocation[], asset: MediaAsset, requested: MediaVariant = "web") {
  const variants = preferredVariant(asset, requested);
  if (requested === "original") return locations.find((location) => location.variant === "original" && location.provider === "quark" && location.status === "archived") ?? null;
  return variants.map((variant) => locations.find((location) => location.provider === "hot" && location.variant === variant && location.status === "ready")).find(Boolean) ?? null;
}

export function derivativePlan(asset: MediaAsset): Array<{ variant: MediaVariant; maxWidth: number }> {
  if (asset.mediaType === "video") return [{ variant: "poster", maxWidth: 1280 }];
  if (asset.mediaType === "document" || asset.mimeType === "application/pdf") return [{ variant: "document_preview", maxWidth: 1280 }];
  return [{ variant: "thumbnail", maxWidth: 480 }, { variant: "web", maxWidth: 1280 }];
}
