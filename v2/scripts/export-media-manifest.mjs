import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Phase 3B2: no in-repo consumer parses media-manifest.json back (searched: only package.json's
// `media:manifest` script and this file itself reference it — grep -rln "media-manifest" excludes
// no other hits), so there is nothing to keep byte-for-byte compatible. Still, the shape change
// below is real: `derivatives` used to be `{ [variant]: MediaLocation }` — one location per
// variant, silently overwriting if two rows shared a variant (Object.fromEntries keeps only the
// LAST duplicate key). During an OSS migration a "web" derivative can legitimately exist at BOTH
// "hot" and "oss" simultaneously (one not yet cut over), and silently dropping one would make this
// manifest lie about what object storage actually holds. `derivatives` is now
// `{ [variant]: MediaLocation[] }` — every hot/oss row for that variant, never just the last one
// seen. `version` bumped to 2 so a future consumer can detect the shape change from the file
// itself rather than assuming the old single-object-per-variant shape.
const root = process.cwd();
const store = JSON.parse(await readFile(path.join(root, ".data", "nian-life.json"), "utf8"));
const manifest = (store.mediaAssets ?? []).map((asset) => {
  const derivativeLocations = (store.mediaLocations ?? []).filter((location) => location.mediaAssetId === asset.id && (location.provider === "hot" || location.provider === "oss") && location.variant !== "original");
  const derivatives = {};
  for (const location of derivativeLocations) {
    if (!derivatives[location.variant]) derivatives[location.variant] = [];
    derivatives[location.variant].push(location);
  }
  return {
    mediaAssetId: asset.id,
    checksum: asset.checksum,
    original: (store.mediaLocations ?? []).find((location) => location.mediaAssetId === asset.id && location.provider === "quark" && location.variant === "original") ?? null,
    derivatives,
    archiveState: asset.archiveStatus ?? "awaiting_archive",
    lifeEventLinks: (store.events ?? []).filter((event) => event.mediaIds.some((mediaId) => (store.media ?? []).some((media) => media.id === mediaId && media.mediaAssetId === asset.id))).map((event) => event.id),
  };
});
const destination = path.join(root, "media-manifest.json");
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify({ version: 2, generatedAt: new Date().toISOString(), assets: manifest }, null, 2), "utf8");
console.log("Wrote " + destination);
