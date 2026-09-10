import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { MediaAsset, MediaLocation, MediaProvider, MediaVariant } from "@/lib/types";
import { getOssConfig, OssStorage } from "./oss-storage";
import type { HotStorage, HotStorageInput } from "./storage-types";
import { safeKey } from "./storage-types";

// Re-exported so every existing `import { type HotStorage } from "@/lib/storage/hot-storage"`
// (and the sibling Hot*Object/Body/Verification types) keeps working unchanged — the interface
// itself moved to storage-types.ts only so oss-storage.ts could depend on it without a circular
// import back into this file.
export type { HotStorage, HotStorageObject, HotStorageBody, HotStorageInput, HotStorageVerification } from "./storage-types";

// The local adapter is intentionally credential-free and is also the staging
// implementation used by the development repository.
export class LocalHotStorage implements HotStorage {
  private readonly root = path.join(process.cwd(), ".data");

  async put(input: HotStorageInput) {
    const key = safeKey(input.key);
    const target = path.join(this.root, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    if (input.body instanceof Uint8Array) await fs.writeFile(target, input.body);
    else await pipeline(Readable.from(input.body), createWriteStream(target));
    return { providerRef: key, mimeType: input.mimeType, fileSize: input.fileSize ?? (input.body instanceof Uint8Array ? input.body.byteLength : undefined), checksum: input.checksum };
  }

  async get(key: string) {
    try { return await fs.readFile(path.join(this.root, safeKey(key))); }
    catch { return null; }
  }

  async getStream(key: string) {
    try {
      await fs.access(path.join(this.root, safeKey(key)));
      return Readable.toWeb(createReadStream(path.join(this.root, safeKey(key)))) as ReadableStream<Uint8Array>;
    } catch { return null; }
  }

  async getRange(key: string, start: number, end: number) {
    try {
      const target = path.join(this.root, safeKey(key));
      await fs.access(target);
      return Readable.toWeb(createReadStream(target, { start, end })) as ReadableStream<Uint8Array>;
    } catch { return null; }
  }

  async delete(key: string) { await fs.rm(path.join(this.root, safeKey(key)), { force: true }); }
  async verify(key: string, checksum: string) {
    try {
      const stream = createReadStream(path.join(this.root, safeKey(key)));
      const hash = createHash("sha256");
      let fileSize = 0;
      for await (const chunk of stream) { hash.update(chunk); fileSize += chunk.byteLength; }
      return { exists: true, checksumVerified: hash.digest("hex") === checksum.replace(/^sha256:/i, "").toLowerCase(), fileSize };
    } catch { return { exists: false, checksumVerified: false }; }
  }
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
    const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
    this.client = Promise.all([import("@aws-sdk/client-s3"), import("@smithy/node-http-handler"), import("https-proxy-agent")]).then(([{ S3Client }, { NodeHttpHandler }, { HttpsProxyAgent }]) => new S3Client({
      endpoint: config.endpoint,
      region: "auto",
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestHandler: proxyUrl ? new NodeHttpHandler({ httpsAgent: new HttpsProxyAgent(proxyUrl) }) : undefined,
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
  url(location: MediaLocation) {
    if (location.provider !== "hot" || location.variant === "original" || location.status !== "ready") return null;
    return this.config.publicBaseUrl ? `${this.config.publicBaseUrl.replace(/\/$/, "")}/${encodeURI(location.providerRef)}` : null;
  }
}

// Phase 3B1-fix (2026-09-08, total-review finding): MEDIA_STORAGE_PROVIDER used to decide BOTH
// "which tier should a new derivative target" AND "which physical backend serves provider 'hot'"
// — the same switch. That was a real bug: setting MEDIA_STORAGE_PROVIDER=oss to start routing new
// writes to OSS also flipped this function's `=== "r2"` check to false, silently downgrading every
// EXISTING provider:"hot" row (real R2 data) to LocalHotStorage — those rows would 404 in
// production the moment OSS was turned on, R2 credentials or not. HOT_STORAGE_BACKEND is a
// separate, explicit switch for the physical backend behind "hot", decoupled from what new writes
// target. When unset it falls back to the old rule so nothing already deployed changes behavior:
// MEDIA_STORAGE_PROVIDER === "r2" → r2, anything else → local.
export function resolveHotBackend(env: NodeJS.ProcessEnv = process.env): "r2" | "local" {
  if (env.HOT_STORAGE_BACKEND === "r2") return "r2";
  if (env.HOT_STORAGE_BACKEND === "local") return "local";
  return env.MEDIA_STORAGE_PROVIDER === "r2" ? "r2" : "local";
}

export function createHotStorage(env: NodeJS.ProcessEnv = process.env): HotStorage {
  return resolveHotBackend(env) === "r2" ? new R2HotStorage(getR2Config(env)) : new LocalHotStorage();
}

export const hotStorage = createHotStorage();

// OSS is a genuinely separate tier, constructed lazily (only when something actually needs it, so
// an app with no OSS_* vars configured never pays getOssConfig()'s throw just for importing this
// module).
let ossSingleton: HotStorage | undefined;
// Test-only seam: getOssStorage()'s default path constructs a real S3Client via a real dynamic
// import, which a fake-client write-path test (e.g. "ingestQuarkFile actually tags a location
// oss") needs to bypass without touching the network. No production call site ever calls this.
let ossStorageOverrideForTests: HotStorage | undefined;
export function __setOssStorageForTests(storage: HotStorage | undefined) { ossStorageOverrideForTests = storage; }
export function getOssStorage(env: NodeJS.ProcessEnv = process.env): HotStorage {
  if (ossStorageOverrideForTests) return ossStorageOverrideForTests;
  if (!ossSingleton) ossSingleton = new OssStorage(getOssConfig(env));
  return ossSingleton;
}

// Which provider a NEW write should target — independent from which backend an EXISTING
// location's own `provider` field should be read through (that's getStorageForProvider below,
// keyed off the row itself, never off this). Defaults to "hot" so an unset/misspelled env value
// behaves exactly like today: new writes keep going to R2/local, tagged "hot".
export function activeMediaProvider(env: NodeJS.ProcessEnv = process.env): "hot" | "oss" {
  return env.MEDIA_STORAGE_PROVIDER === "oss" ? "oss" : "hot";
}

// Every read of an actual object must go through this, keyed off the MediaLocation's own
// `provider` — never off activeMediaProvider() or a single fixed instance. During migration the
// database holds a mix of "hot" (R2/legacy) and "oss" rows at once; which one a given row reads
// through is a property of that row, not of today's write-target setting. This routes correctly
// ONLY if both switches are actually set for the deployment's real state: HOT_STORAGE_BACKEND must
// still point at wherever the existing "hot" rows' bytes really live (see resolveHotBackend's
// comment above) even after MEDIA_STORAGE_PROVIDER=oss starts sending new writes elsewhere — an
// OSS deployment that still has real R2 data needs HOT_STORAGE_BACKEND=r2 kept explicitly, not
// left unset. Until Phase 3B2 migrates the awaiting_archive → Quark staging pipeline off "hot"
// (lib/archive/quark-archive.ts, app/actions.ts's original write), an OSS environment must keep
// valid R2 credentials configured regardless of HOT_STORAGE_BACKEND's value, because that staging
// tier is unconditionally "hot" today.
export function getStorageForProvider(provider: MediaProvider, env: NodeJS.ProcessEnv = process.env): HotStorage {
  if (provider === "oss") return getOssStorage(env);
  if (provider === "hot") return hotStorage;
  throw new Error(`getStorageForProvider: no object storage backend for provider "${provider}"`);
}

export function preferredVariant(asset: MediaAsset, requested: MediaVariant = "web"): MediaVariant[] {
  if (asset.mediaType === "video") return requested === "preview" ? ["preview", "poster"] : ["poster"];
  if (asset.mediaType === "document" || asset.mimeType === "application/pdf") return ["document_preview"];
  if (requested === "original") return ["original"];
  return requested === "thumbnail" ? ["thumbnail", "web"] : ["web", "thumbnail"];
}

/**
 * Which tier a READ should try first when a derivative exists at both. Defaults to "oss", which is
 * the migration's intent and the behaviour before this switch existed.
 *
 * It exists because a tier can be reachable, correctly configured, holding the right bytes, and
 * still refuse to serve them. On 2026-09-11 every photograph on the private site returned 404
 * "Media derivative is not ready"; the database was correct (both tiers ready, refs well-formed),
 * DNS and TLS were fine, and OSS itself answered `UserDisable` / HTTP 403 to GetObject, HeadObject
 * and ListObjectsV2 alike — an account-level suspension, not a missing object. The bytes were
 * still in R2, byte-for-byte, but nothing could ask for them because tier preference was a
 * constant.
 *
 * This is deliberately an OPERATOR switch, not an automatic failover. A read that silently falls
 * back on error hides exactly this class of outage — the site would look fine while its storage
 * account was gone, and nobody would go and fix it. Someone has to decide to flip it, and to flip
 * it back.
 */
export function resolveReadPreference(env: NodeJS.ProcessEnv = process.env): "oss" | "hot" {
  return env.MEDIA_READ_PREFERENCE === "hot" ? "hot" : "oss";
}

// Phase 3B1: a derivative can now exist at either tier while migration is in progress. For each
// candidate variant (in preference order), the preferred tier's copy wins when both exist and are
// ready, and the other tier is used when only it has one. `original` is unaffected: it is never
// served to a public page from either tier, only from the archived Quark copy, exactly as before.
export function selectLocation(locations: MediaLocation[], asset: MediaAsset, requested: MediaVariant = "web", preference: "oss" | "hot" = resolveReadPreference()) {
  const variants = preferredVariant(asset, requested);
  if (requested === "original") return locations.find((location) => location.variant === "original" && location.provider === "quark" && location.status === "archived") ?? null;
  const [first, second] = preference === "hot" ? ["hot", "oss"] as const : ["oss", "hot"] as const;
  const ready = (variant: MediaVariant, provider: string) =>
    locations.find((location) => location.provider === provider && location.variant === variant && location.status === "ready");
  return variants
    .map((variant) => ready(variant, first) ?? ready(variant, second))
    .find(Boolean) ?? null;
}

export function derivativePlan(asset: MediaAsset): Array<{ variant: MediaVariant; maxWidth: number }> {
  if (asset.mediaType === "video") return [{ variant: "poster", maxWidth: 1280 }];
  if (asset.mediaType === "document" || asset.mimeType === "application/pdf") return [{ variant: "document_preview", maxWidth: 1280 }];
  return [{ variant: "thumbnail", maxWidth: 480 }, { variant: "web", maxWidth: 1280 }];
}
