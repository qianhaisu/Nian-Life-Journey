import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { MediaLocation } from "@/lib/types";
import type { HotStorage, HotStorageInput } from "./storage-types";
import { safeKey } from "./storage-types";

// Phase 3B1 (docs/migration-C-readiness.md follow-up): the OSS tier for media the app has not
// yet moved off R2. Talks to Alibaba Cloud OSS through its S3-compatible API — the same
// @aws-sdk/client-s3 library R2HotStorage already uses in hot-storage.ts, just pointed at a
// different endpoint/region/credential set. Never exposes an object URL to a page: url() always
// returns null, because delivery goes through /api/media/[id] the same way "hot" locations do
// (see app/api/media/[id]/route.ts's getStorageForProvider routing).
export type OssConfig = { endpoint: string; region: string; bucket: string; accessKeyId: string; accessKeySecret: string };

export function getOssConfig(env: NodeJS.ProcessEnv = process.env): OssConfig {
  const required = ["OSS_ENDPOINT", "OSS_REGION", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET", "OSS_BUCKET"] as const;
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`OSS storage is selected but missing: ${missing.join(", ")}`);
  return {
    // Accepts either a public endpoint (oss-cn-hangzhou.aliyuncs.com) or Alibaba Cloud's
    // VPC-internal one (oss-cn-hangzhou-internal.aliyuncs.com) — this file has no opinion on
    // which; that choice belongs to whoever deploys the worker that talks to OSS.
    endpoint: env.OSS_ENDPOINT!,
    region: env.OSS_REGION!,
    bucket: env.OSS_BUCKET!,
    accessKeyId: env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: env.OSS_ACCESS_KEY_SECRET!,
  };
}

export type OssSendableClient = { send(command: unknown): Promise<unknown> };

export class OssStorage implements HotStorage {
  private readonly config: OssConfig;
  private readonly client: Promise<OssSendableClient>;

  // The optional second argument exists only so tests can inject a fake `{ send }` client instead
  // of a real S3Client — every real Command class (PutObjectCommand etc.) is still the genuine
  // @aws-sdk/client-s3 one built by the methods below, so a test asserting on `command.input` is
  // asserting on the actual command the SDK would send, not a hand-rolled stand-in for it.
  constructor(config = getOssConfig(), client?: Promise<OssSendableClient>) {
    this.config = config;
    this.client = client ?? import("@aws-sdk/client-s3").then(({ S3Client }) => new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.accessKeySecret },
    }));
  }

  async put(input: HotStorageInput) {
    const key = safeKey(input.key);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const body = input.body instanceof Uint8Array ? input.body : Readable.from(input.body);
    const fileSize = input.fileSize ?? (input.body instanceof Uint8Array ? input.body.byteLength : undefined);
    await (await this.client).send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body as any, ContentLength: fileSize, ContentType: input.mimeType }));
    return { providerRef: key, mimeType: input.mimeType, fileSize, checksum: input.checksum };
  }

  async get(key: string) {
    try {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const result = await (await this.client).send(new GetObjectCommand({ Bucket: this.config.bucket, Key: safeKey(key) })) as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } };
      if (!result.Body) return null;
      return result.Body.transformToByteArray ? result.Body.transformToByteArray() : null;
    } catch { return null; }
  }

  async getStream(key: string) {
    try {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const result = await (await this.client).send(new GetObjectCommand({ Bucket: this.config.bucket, Key: safeKey(key) })) as { Body?: { transformToWebStream?: () => ReadableStream<Uint8Array> } };
      if (!result.Body?.transformToWebStream) return null;
      return result.Body.transformToWebStream();
    } catch { return null; }
  }

  async delete(key: string) { const { DeleteObjectCommand } = await import("@aws-sdk/client-s3"); await (await this.client).send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: safeKey(key) })); }

  async verify(key: string, checksum: string) {
    try {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const result = await (await this.client).send(new GetObjectCommand({ Bucket: this.config.bucket, Key: safeKey(key) })) as { Body?: AsyncIterable<Uint8Array> };
      if (!result.Body) return { exists: false, checksumVerified: false };
      const hash = createHash("sha256");
      let fileSize = 0;
      for await (const chunk of result.Body) { hash.update(chunk); fileSize += chunk.byteLength; }
      return { exists: true, checksumVerified: hash.digest("hex") === checksum.replace(/^sha256:/i, "").toLowerCase(), fileSize };
    } catch { return { exists: false, checksumVerified: false }; }
  }

  // Never a page-facing URL — an OSS-backed derivative is only ever reached through
  // /api/media/[id], same as a "hot" one. See the file-level comment above.
  url(_location: MediaLocation) { return null; }
}
