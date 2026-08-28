import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const store = JSON.parse(await readFile(path.join(root, ".data", "nian-life.json"), "utf8"));
const manifest = (store.mediaAssets ?? []).map((asset) => ({
  mediaAssetId: asset.id,
  checksum: asset.checksum,
  quark: (store.mediaLocations ?? []).filter((location) => location.mediaAssetId === asset.id && location.provider === "quark"),
  hot: (store.mediaLocations ?? []).filter((location) => location.mediaAssetId === asset.id && location.provider === "hot"),
  lifeEventIds: (store.events ?? []).filter((event) => event.mediaIds.some((mediaId) => (store.media ?? []).some((media) => media.id === mediaId && media.mediaAssetId === asset.id))).map((event) => event.id),
}));
const destination = path.join(root, "media-manifest.json");
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), assets: manifest }, null, 2), "utf8");
console.log("Wrote " + destination);
