#!/usr/bin/env node
// DeepSeek Organizer quality gate benchmark.
//
// Selects real evidence windows from the imported WeChat corpus, runs them through the production
// pipeline (Recall -> DeepSeek Memory Editor -> H1-H9 Validator) with persist disabled, and writes a
// report. Real chat text is NEVER written to stdout or into the repo: the detailed report goes to
// --out, which must be a path outside the repository.
//
//   node --import tsx scripts/deepseek-quality-bench.mjs --out <abs-path.json> [--limit=30]
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";

for (const file of [".env", ".env.local"]) if (existsSync(file)) config({ path: file, override: true });

const { buildEvidenceWindows, windowFingerprint, WINDOW_POLICY_VERSION } = await import("../lib/organizer/evidence/window.ts");
const { runPipeline } = await import("../lib/organizer/pipeline.ts");
const { createDeepSeekMemoryEditor } = await import("../lib/organizer/deepseek-editor.ts");
const { recallScore } = await import("../lib/organizer/recall.ts");

const args = process.argv.slice(2);
const outArg = args.find((a) => a.startsWith("--out="))?.slice("--out=".length);
if (!outArg) { console.error("--out=<absolute path outside the repo> is required"); process.exit(1); }
const outPath = path.resolve(outArg);
if (outPath.startsWith(path.resolve(process.cwd(), ".."))
  && !path.relative(path.resolve(process.cwd(), ".."), outPath).startsWith("..")) {
  console.error("Refusing to write real chat content inside the repository. Use a scratchpad path.");
  process.exit(1);
}

const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "崽", "宝宝", "年年"] };

// Targeted probes: each is a small, indexed LIKE lookup, never a full-table scan.
//
// `mode` decides the evidence window built around the seed, and the two modes test different things:
//   tight   — the seed message plus anything within +/-3 minutes, capped at 6 items. This reproduces
//             the live-site failure mode, where a lone adult-logistics message became a LifeEvent
//             titled with its own raw text. A tight negative window MUST end as store_only.
//   natural — the real +/-90 minute conversation window. A negative seed here is a *mixed* window:
//             the correct behaviour is not "reject the window" but "drop the adult message and keep
//             only the child facts", which `leakedNegativeSeed` checks explicitly.
const PROBES = [
  { label: "neg:adult_shift", expect: "unrelated", mode: "tight", like: "%换了%公司%" },
  { label: "neg:bring_for_friend", expect: "unrelated", mode: "tight", like: "%带骑行包%" },
  { label: "neg:wifi", expect: "unrelated", mode: "tight", like: "%wifi%" },
  { label: "neg:wifi_cn", expect: "unrelated", mode: "tight", like: "%网络%密码%" },
  { label: "neg:glass", expect: "unrelated", mode: "tight", like: "%装玻璃%" },
  { label: "neg:hotel_location", expect: "unrelated", mode: "tight", like: "%位置%酒店%" },
  { label: "neg:forwarded_link", expect: "unrelated", mode: "tight", like: "%http%" },
  { label: "neg:recalled", expect: "unrelated", mode: "tight", like: "%撤回%" },
  { label: "neg:sticker", expect: "unrelated", mode: "tight", like: "%[表情包]%" },
  { label: "neg:media_placeholder", expect: "unrelated", mode: "tight", like: "%[media]%" },
  { label: "neg:video_path", expect: "unrelated", mode: "tight", like: "%[视频文件](media/%" },
  { label: "neg:takeout", expect: "unrelated", mode: "tight", like: "%晚上要吃吗%" },
  { label: "mix:adult_shift", expect: "mixed", mode: "natural", like: "%换了%公司%" },
  { label: "mix:bring_for_friend", expect: "mixed", mode: "natural", like: "%带骑行包%" },
  { label: "mix:forwarded_link", expect: "mixed", mode: "natural", like: "%http%" },
  { label: "mix:video_path", expect: "mixed", mode: "natural", like: "%[视频文件](media/%" },
  { label: "pos:crawl", expect: "related", mode: "natural", like: "%会爬%" },
  { label: "pos:first", expect: "related", mode: "natural", like: "%第一次%" },
  { label: "pos:learned", expect: "related", mode: "natural", like: "%学会%" },
  { label: "pos:video_grandpa", expect: "related", mode: "natural", like: "%爷爷%视频%" },
  { label: "pos:named_child", expect: "related", mode: "natural", like: "%张小年%" },
  { label: "pos:named_child2", expect: "related", mode: "natural", like: "%小年%" },
  { label: "pos:sleep", expect: "related", mode: "natural", like: "%睡%" },
  { label: "pos:hand", expect: "related", mode: "natural", like: "%玩手%" },
  { label: "pos:stand", expect: "related", mode: "natural", like: "%扶墙站%" },
  { label: "pos:teeth", expect: "related", mode: "natural", like: "%牙%" },
  { label: "bound:zai", expect: "boundary", mode: "tight", like: "%崽%" },
  { label: "bound:baby", expect: "boundary", mode: "tight", like: "%宝宝%" },
  { label: "bound:pickup", expect: "boundary", mode: "tight", like: "%接%回来%" },
  { label: "bound:eat", expect: "boundary", mode: "tight", like: "%吃%" },
  { label: "bound:pronoun", expect: "boundary", mode: "tight", like: "%他%" },
  { label: "bound:photo_only", expect: "boundary", mode: "tight", like: "%[图片]%" },
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const PROFILE_ID = "profile-zhangnian";
const seen = new Set();
const seeds = [];

for (const probe of PROBES) {
  const { rows } = await client.query(
    `select id, captured_at, source_label, metadata from raw_sources
     where profile_id = $1 and source_type = 'wechat' and deleted_at is null and text ilike $2
     order by captured_at desc limit 3`,
    [PROFILE_ID, probe.like],
  );
  for (const row of rows) {
    const key = `${probe.mode}:${row.source_label}:${row.captured_at.toISOString().slice(0, 13)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    seeds.push({ probe, seed: row });
    break;
  }
}

console.log(`Selected ${seeds.length} seed windows from ${PROBES.length} probes.`);

const editor = createDeepSeekMemoryEditor(process.env, SUBJECT);
console.log(`Provider: ${JSON.stringify(editor.describe())}`);

const results = [];
for (const { probe, seed } of seeds) {
  // Pull the seed's local neighbourhood only: same conversation, bounded interval, hard row cap.
  const tight = probe.mode === "tight";
  const { rows } = await client.query(
    `select id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids,
            source_label, visibility, metadata
     from raw_sources
     where profile_id = $1 and source_label = $2 and deleted_at is null
       and captured_at between $3::timestamptz - $4::interval and $3::timestamptz + $4::interval
     order by captured_at limit $5`,
    [PROFILE_ID, seed.source_label, seed.captured_at, tight ? "3 minutes" : "90 minutes", tight ? 6 : 40],
  );

  const sources = rows.map((row) => ({
    id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types,
    contributorId: row.contributor_id, capturedAt: row.captured_at.toISOString(), text: row.text ?? "",
    mediaIds: row.media_ids ?? [], visibility: row.visibility, metadata: row.metadata,
    sourceLabel: row.source_label, contributorRole: "family",
  }));

  const windows = buildEvidenceWindows(seed.source_label, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] });
  const window = windows.find((w) => w.items.some((item) => item.sourceId === seed.id)) ?? windows[0];
  if (!window) continue;

  const fingerprint = windowFingerprint(window, { policyVersion: WINDOW_POLICY_VERSION, promptVersion: editor.promptVersion, modelVersion: editor.model }, new Map());
  const started = Date.now();
  const result = await runPipeline(window, {
    subject: SUBJECT, provider: editor, windowFingerprint: fingerprint, persist: false,
    context: { existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [] },
  });

  const entry = {
    probe: probe.label, expect: probe.expect, windowId: window.windowId, seedId: seed.id,
    messageCount: window.stats.messageCount, mediaCount: window.stats.imageCount,
    recallScore: recallScore(window, SUBJECT), skippedByRecall: result.skippedByRecall,
    subjectRelevance: result.verdict?.subjectRelevance,
    subjectRelevanceDetail: undefined,
    action: result.outcome.action, reasonCodes: result.reasonCodes, degradeReason: result.degradeReason,
    worthinessScore: result.outcome.worthinessScore, selectionReason: result.outcome.selectionReason,
    latencyMs: Date.now() - started,
    // For a mixed window: did any kept fact/quote actually come from the unrelated seed message?
    leakedNegativeSeed: (() => {
      if (probe.expect !== "mixed") return null;
      const seedItem = window.items.find((item) => item.sourceId === seed.id);
      if (!seedItem) return null;
      const refs = new Set([
        ...(result.verdict?.coreFacts ?? []).flatMap((f) => f.evidenceRefs),
        ...(result.verdict?.quotableLines ?? []).map((q) => q.evidenceRef),
      ]);
      return [...refs].some((ref) => ref.startsWith(`${seedItem.itemId}#`));
    })(),
    // Detailed evidence + facts go to the out-file only.
    _detail: { evidenceTexts: window.items.map((i) => i.text), coreFacts: result.verdict?.coreFacts ?? [], quotableLines: result.verdict?.quotableLines ?? [] },
  };
  results.push(entry);
  console.log(`  ${probe.label.padEnd(24)} recall=${entry.recallScore} rel=${entry.subjectRelevance ?? "-"} action=${entry.action} score=${entry.worthinessScore} ${entry.latencyMs}ms`);
}

await client.end();

const visible = results.filter((r) => r.action === "life_event_candidate" || r.action === "daily_trace");
const summary = {
  provider: editor.describe(),
  total: results.length,
  calls: editor.stats.length,
  failedCalls: editor.stats.filter((s) => !s.ok).length,
  retries: editor.stats.reduce((n, s) => n + s.retries, 0),
  inputTokens: editor.stats.reduce((n, s) => n + s.inputTokens, 0),
  outputTokens: editor.stats.reduce((n, s) => n + s.outputTokens, 0),
  byAction: results.reduce((acc, r) => ({ ...acc, [r.action]: (acc[r.action] ?? 0) + 1 }), {}),
  negativeCount: results.filter((r) => r.expect === "unrelated").length,
  negativesPublished: results.filter((r) => r.expect === "unrelated" && (r.action === "life_event_candidate" || r.action === "daily_trace")).length,
  mixedCount: results.filter((r) => r.expect === "mixed").length,
  mixedLeaked: results.filter((r) => r.leakedNegativeSeed === true).length,
  positivesHandled: results.filter((r) => r.expect === "related" && r.action !== "failed").length,
  boundaryPromoted: results.filter((r) => r.expect === "boundary" && r.action === "life_event_candidate").length,
  visibleCount: visible.length,
};

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));

await writeFile(outPath, JSON.stringify({ summary, results, callStats: editor.stats }, null, 2), "utf8");
console.log(`\nDetailed report (contains real chat text) written to: ${outPath}`);
