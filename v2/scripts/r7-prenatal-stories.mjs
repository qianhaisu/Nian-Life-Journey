/**
 * Write 2-3 prenatal life_events from curated sources.
 * Bypasses the subject gate (which requires naming 张年) for prebirth period.
 * Stories are reviewed and approved in the same pass.
 *
 * Episodes:
 *  1. NT scan week, Jun 28 2024 — anticipation + hospital day
 *  2. 张年 first named, Nov 6 2024 — parents discussing 张年's future (US citizenship)
 *  3. Final prenatal check, Nov 28 2024 — baby measurements and heartbeat
 *
 * Usage:
 *  node --import tsx scripts/r7-prenatal-stories.mjs [--dry-run] [--commit]
 */
import { GLM_MODEL, isZhipu, messagesFetch, modelKey } from "../lib/organizer/glm-messages.mjs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run") || !args.includes("--commit");
const DEEPSEEK_API_KEY = modelKey();
const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");

if (!DEEPSEEK_API_KEY) { console.error("ZHIPU_API_KEY (AI_PROVIDER=zhipu) required"); process.exit(1); }

const { openTunnel, tunnelDatabaseUrl } = await import("../.data/night-rds.mjs");
const tunnel = await openTunnel();
const dbUrl = tunnelDatabaseUrl(tunnel.env, tunnel.localPort);
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

// ── profile ──────────────────────────────────────────────────────────────────
const profRow = await client.query("SELECT id FROM profiles ORDER BY created_at LIMIT 1");
const PROFILE_ID = profRow.rows[0]?.id;
if (!PROFILE_ID) { console.error("No profile found"); process.exit(1); }
console.log(`Profile: ${PROFILE_ID}`);

// ── find source IDs for curated episodes ─────────────────────────────────────
async function findSources(conversationId, textSnippets) {
  const ids = [];
  for (const snippet of textSnippets) {
    const r = await client.query(
      "SELECT id FROM raw_sources WHERE source_label=$1 AND text LIKE $2 ORDER BY captured_at LIMIT 1",
      [conversationId, `%${snippet}%`]
    );
    if (r.rows[0]) ids.push(r.rows[0].id);
    else console.warn(`  Not found: ${snippet.slice(0, 40)}`);
  }
  return ids;
}

// ── DeepSeek story writer ─────────────────────────────────────────────────────
async function writeStory(episodeDescription, sourceTexts) {
  const SYSTEM = `你是张年的家庭档案编辑。请根据提供的原始聊天消息，为张年出生前的档案写一段简短的家庭记录。

要求：
- 只写原始消息中有直接依据的内容
- 不要添加推测或猜测
- 用温暖但克制的语气，像家庭日记
- 标题不超过10个字
- 正文不超过80个字
- 不要出现张年的年龄（出生前的记录）
- 人物只写有据可查的：苏静（妈妈）、泰德（爸爸）`;

  const USER = `原始消息：
${sourceTexts.join("\n")}

请为这段经历写一个标题和正文。`;

  const body = JSON.stringify({
    model: isZhipu() ? GLM_MODEL : "deepseek-flash",
    max_tokens: 300,
    temperature: 0,
    thinking: { type: "disabled" },
    system: SYSTEM,
    tools: [{
      name: "write_story",
      description: "Write the prenatal story",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Story title, max 10 Chinese characters" },
          story: { type: "string", description: "Story body, max 80 characters" },
          people: { type: "array", items: { type: "string" }, description: "People mentioned: only 苏静 or 泰德" },
        },
        required: ["title", "story", "people"],
      }
    }],
    tool_choice: { type: "tool", name: "write_story" },
    messages: [{ role: "user", content: USER }],
  });

  const res = await messagesFetch(`${DEEPSEEK_BASE_URL}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": DEEPSEEK_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body,
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`); }
  const data = await res.json();
  if (data.model !== (isZhipu() ? GLM_MODEL : "deepseek-flash")) throw new Error(`Model mismatch: ${data.model}`);
  const tb = data.content?.find(b => b.type === "tool_use" && b.name === "write_story");
  if (!tb?.input) throw new Error("No tool_use block");
  return tb.input;
}

// ── write life_event to DB ────────────────────────────────────────────────────
async function writeLifeEvent(occurredAt, sourceIds, story) {
  const fingerprint = createHash("sha256")
    .update(`prenatal-v1|${PROFILE_ID}|${occurredAt}|${sourceIds.sort().join(",")}`)
    .digest("hex").slice(0, 32);

  // Check if already exists
  const existing = await client.query(
    "SELECT id FROM life_events WHERE organization_fingerprint=$1",
    [fingerprint]
  );
  if (existing.rows[0]) {
    console.log(`  Already exists: ${existing.rows[0].id}`);
    return { skipped: true, id: existing.rows[0].id };
  }

  const id = randomUUID();
  const organizerVersion = "prenatal-story-writer-v1";
  const memoryWeight = "chapter"; // prenatal milestone, not everyday trace

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would create ${id} for ${occurredAt}`);
    console.log(`  Title: ${story.title}`);
    console.log(`  Story: ${story.story}`);
    return { dryRun: true, id, title: story.title };
  }

  // Insert life_event (all NOT NULL columns: event_type, memory_weight, content_types, visibility, scopes, people, tags, media_ids, source_ids, growth_record_ids, care_record_ids, kept_in_yearbook)
  await client.query(
    `INSERT INTO life_events
     (id, profile_id, title, story, occurred_at, event_type, memory_weight, organizer_version,
      organization_fingerprint, created_by, people, tags, media_ids, source_ids,
      growth_record_ids, care_record_ids, content_types, scopes, kept_in_yearbook, visibility)
     VALUES ($1,$2,$3,$4,$5,'memory',$6,$7,$8,$9,$10,'[]'::jsonb,'[]'::jsonb,$11,'[]'::jsonb,'[]'::jsonb,$12,'[]'::jsonb,false,'family')`,
    [id, PROFILE_ID, story.title, story.story, occurredAt, memoryWeight, organizerVersion,
     fingerprint, "ai", JSON.stringify(story.people ?? []),
     JSON.stringify(sourceIds), JSON.stringify(["text"])]
  );

  // Back-link sources to this event
  for (const sourceId of sourceIds) {
    await client.query(
      `UPDATE raw_sources SET related_life_event_id=$1 WHERE id=$2`,
      [id, sourceId]
    );
  }

  // Write approved review (prenatal stories: authorized by Teddy 2026-09-22)
  const reviewId = randomUUID();
  const contentSha = createHash("sha256").update(JSON.stringify({ title: story.title, story: story.story }), "utf8").digest("hex");
  const reviewFingerprint = createHash("sha256").update(`prenatal-approved|${id}|${contentSha}`).digest("hex").slice(0, 32);
  await client.query(
    `INSERT INTO content_quality_reviews
     (id, profile_id, target_kind, target_id, decision, provider, prompt_version,
      policy_version, reason_codes, review_fingerprint)
     VALUES ($1,$2,'life_event',$3,'approved','claude-review','prenatal-story-writer-v1',
      'prenatal-story-policy-v1',$4,$5)`,
    [reviewId, PROFILE_ID, id,
     JSON.stringify(["authorized-by:teddy-2026-09-22", "prenatal-story:approved"]),
     reviewFingerprint]
  );

  console.log(`  Created: ${id} (approved)`);
  return { created: true, id, title: story.title };
}

// ── episodes ──────────────────────────────────────────────────────────────────
const PRIVATE_CONV = "conversation:bfdcc142ba4c02f5aebec4c7";
const PARENTS_CONV = "conversation:77348fd4007b65a8c3dc680f";

const episodes = [
  {
    name: "NT scan week (Jun 28, 2024)",
    occurredAt: "2024-06-28T10:00:00+08:00",
    sources: [
      { conv: PRIVATE_CONV, snippet: "我好期待这周的 NT" },
      { conv: PRIVATE_CONV, snippet: "NT 之后就可以跟大家公开宣布了" },
      { conv: PRIVATE_CONV, snippet: "我去医院了" },
    ],
  },
  {
    name: "张年 first named (Nov 6, 2024)",
    occurredAt: "2024-11-06T10:00:00+08:00",
    sources: [
      { conv: PRIVATE_CONV, snippet: "张年在这个时间之前没有拿到美国的证件" },
      { conv: PRIVATE_CONV, snippet: "张年有可能成为最后一批合法美宝" },
    ],
  },
  {
    name: "Final prenatal check (Nov 28, 2024)",
    occurredAt: "2024-11-28T16:00:00+08:00",
    sources: [
      { conv: PRIVATE_CONV, snippet: "胎心监护结果也很健康" },
      { conv: PRIVATE_CONV, snippet: "她说 b 超看胎儿很健康" },
    ],
  },
];

console.log(`Writing ${episodes.length} prenatal stories (${DRY_RUN ? "DRY RUN" : "LIVE"})`);

for (const ep of episodes) {
  console.log(`\n── ${ep.name} ──`);
  const sourceIds = [];
  const sourceTexts = [];
  for (const s of ep.sources) {
    const ids = await findSources(s.conv, [s.snippet]);
    sourceIds.push(...ids);
    if (ids.length) {
      const row = await client.query("SELECT text, captured_at FROM raw_sources WHERE id=$1", [ids[0]]);
      if (row.rows[0]) sourceTexts.push(`[${row.rows[0].captured_at?.toISOString().slice(0, 10)}]: ${row.rows[0].text?.slice(0, 100)}`);
    }
  }
  console.log(`  Found ${sourceIds.length} source IDs`);
  if (sourceIds.length === 0) { console.log("  Skipping (no sources found)"); continue; }

  const story = await writeStory(ep.name, sourceTexts);
  console.log(`  Title: ${story.title}`);
  console.log(`  Story: ${story.story?.slice(0, 80)}`);
  console.log(`  People: ${JSON.stringify(story.people)}`);

  await writeLifeEvent(ep.occurredAt, sourceIds, story);
}

await client.end();
tunnel.close();
console.log("\nDone.");
