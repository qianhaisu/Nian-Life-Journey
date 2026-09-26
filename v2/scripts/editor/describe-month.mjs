// 给一个月候选内容里「机器写的天」已挂上的照片补画面描述（写稿要用）。
//
//   node --import tsx scripts/editor/describe-month.mjs --candidate=<media-month 产出的 YYYY-MM.media.json> --files=<缩略图缓存目录>
//
// 已有描述的不再调用：旧识图缓存（day-writer 读的 months/*/vision-cache.json）和 v2/data/photo-descriptions.json 都算。
// 新描述存进 v2/data/photo-descriptions.json（入库留证），并镜像一份到识图缓存目录下的 zz-describe-month/vision-cache.json，
// day-writer 的 loadVisionDescriptions 原样就能读到，不改写稿流程。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describePhotos, DESCRIBE_PROMPT_VERSION } from "./photo-classify.mjs";
import { loadVisionDescriptions } from "./day-writer.mjs";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const CANDIDATE = arg("candidate");
const FILES = arg("files");
const REPO_V2 = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const STORE = path.join(REPO_V2, "data/photo-descriptions.json");
const HISTORY = "C:/Users/teddy/NianlifeOps/memory-tab-20260917/10-history-rollout/months";
const MIRROR = path.join(HISTORY, "zz-describe-month", "vision-cache.json");

if (!CANDIDATE || !FILES) { console.error("用法：--candidate=<file> --files=<dir>"); process.exit(2); }
const content = JSON.parse(fs.readFileSync(CANDIDATE, "utf8"));
const wanted = [...new Set(content.days.filter((d) => d._source === "machine").flatMap((d) => d.expandedMediaIds ?? []))];
const known = loadVisionDescriptions();
const store = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, "utf8")) : { schema: 1, items: {} };
const fileFor = (id) => path.join(FILES, `${createHash("sha256").update(id).digest("hex").slice(0, 20)}.img`);
const todo = wanted.filter((id) => !known.has(id) && !store.items[id]?.description);
const missingFile = todo.filter((id) => !fs.existsSync(fileFor(id)));
const items = todo.filter((id) => fs.existsSync(fileFor(id))).map((id) => ({ id, file: fileFor(id) }));
console.log(`[describe ${content.month}] 已挂上 ${wanted.length} 张，已有描述 ${wanted.length - todo.length}，待描述 ${items.length}，缺缩略图 ${missingFile.length}`);

if (items.length) {
  const { model, results } = await describePhotos(items);
  const at = new Date().toISOString();
  const disk = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, "utf8")) : { schema: 1, items: {} };
  for (const it of items) disk.items[it.id] = { ...results[it.id], model, promptVersion: DESCRIBE_PROMPT_VERSION, analysedAt: at };
  fs.writeFileSync(STORE, JSON.stringify(disk, null, 1) + "\n", "utf8");
  const mirror = fs.existsSync(MIRROR) ? JSON.parse(fs.readFileSync(MIRROR, "utf8")) : {};
  for (const it of items) {
    const r = results[it.id];
    if (!r?.description) continue;
    mirror[r.bytesSha256] = { mediaId: it.id, mediaKind: r.mediaKind, description: r.description, source: `${model} (describe-month ${content.month})`, model, analysedAt: at };
  }
  fs.mkdirSync(path.dirname(MIRROR), { recursive: true });
  fs.writeFileSync(MIRROR, JSON.stringify(mirror, null, 1) + "\n", "utf8");
  const failed = items.filter((it) => !results[it.id]?.description);
  console.log(`[describe ${content.month}] 新描述 ${items.length - failed.length}，失败 ${failed.length}（模型 ${model}）`);
}
