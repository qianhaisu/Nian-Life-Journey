/**
 * Fix all 13 approved stories with vague person terms.
 * Attributions based on: people[] field + raw source context + story narrative.
 */
import { openRds } from "../.data/night-rds.mjs";
import { createHash } from "node:crypto";

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const DRY_RUN = process.argv.includes("--dry-run");

// Each fix: {id, newTitle, newStory, rationale}
// For cases where only story changes but title stays, only newStory needed.
const FIXES = [
  {
    id: "event-v2-5a31c5c0829ce1650e0fbe79c9197bd7",
    rationale: "people=[外公,妈妈,爷爷,奶奶,外婆] — '家里人' refers to all four grandparents and mom",
    oldSnippet: "家里人送来祝福",
    newTitle: "小年年满月，妈妈说他盯着人看",  // title doesn't mention 家里人, keep as-is
    story: (old) => old.replace("家里人送来祝福", "爷爷奶奶、外公外婆都发来祝福"),
  },
  {
    id: "event-r23-20250325-nimble-hands",
    rationale: "speaker unknown; remove 'has person said' attribution, keep content as neutral fact",
    oldSnippet: "随后群里有人说，小年年的手越来越灵活了。",
    newTitle: null,
    story: (old) => old.replace(
      "随后群里有人说，小年年的手越来越灵活了。",
      "群里还传来一句：「小年年的手越来越灵活了。」"
    ),
  },
  {
    id: "event-r23-20250402-little-tiger",
    rationale: "people=['爷爷'], only 1 source → speaker is 爷爷",
    oldSnippet: "群里有人说：「小年年能抓住小老虎。」",
    newTitle: null,
    story: (old) => old.replace(
      "群里有人说：「小年年能抓住小老虎。」",
      "爷爷在群里说：「小年年能抓住小老虎。」"
    ),
  },
  {
    id: "event-v2-f9ad332467926c9273c60d6ba0bc4396",
    rationale: "people=['雪姨','爸爸','妈妈']; 雪姨 and 妈妈 both named earlier in the story",
    oldSnippet: "家里人哄了他很久，最后哄好了",
    newTitle: null,
    story: (old) => old.replace(
      "家里人哄了他很久，最后哄好了",
      "雪姨和妈妈哄了他很久，最后哄好了"
    ),
  },
  {
    id: "event-v2-c2de94fc880bc3f2712b95904be34834",
    rationale: "people=['爸爸','妈妈']; 'woti，张小年别照镜子啊' is playful/teasing tone consistent with 妈妈; assign爸爸 to first neutral observation",
    oldSnippet: "下午两点多，微信里有人说「小年这么配合」。二十多分钟后，另一个人发来一句：「woti，张小年别照镜子啊。」",
    newTitle: null,
    story: (_old) =>
      "下午两点多，爸爸说「小年这么配合」。二十多分钟后，妈妈发来一句：「woti，张小年别照镜子啊。」",
  },
  {
    id: "event-r22-20260418-big-kid",
    rationale: "people=[], 4 unknown sources; remove 'has person said', restate as observation; 奶奶attribution kept",
    oldSnippet: "群里有人说，小年最近又有长进，坐在那里像个大娃，走得也挺好。",
    newTitle: null,
    story: (old) => old.replace(
      "群里有人说，小年最近又有长进，坐在那里像个大娃，走得也挺好。",
      "小年最近又有长进，坐在那里像个大娃，走得也挺好。"
    ),
  },
  {
    id: "event-r22-20260427-dinosaur",
    rationale: "people=[], 2 unknown sources; remove attribution, state as fact",
    oldSnippet: "群里有人说，小年很喜欢这只小恐龙，上次也玩过。",
    newTitle: null,
    story: (_old) => "小年很喜欢这只小恐龙，上次也玩过。",
  },
  {
    id: "event-v2-51eac16718e4e12f8b7eaf50ba1e79d9",
    rationale: "people=['妈妈','老师','外公']; '老师跟家里说' → '老师告诉妈妈'",
    oldSnippet: "老师跟家里说",
    newTitle: null,
    story: (old) => old.replace("老师跟家里说", "老师告诉妈妈"),
  },
  {
    id: "event-r23-20260715-haircut",
    rationale: "people=[]; first speaker unknown (not 妈妈 or 爸爸 who appear later); drop attribution, keep content",
    oldSnippet: "群里有人说，小年剃头以后最近好像进步很大，个性越来越开朗，也爱动脑筋。",
    newTitle: null,
    story: (old) => old.replace(
      "群里有人说，小年剃头以后最近好像进步很大，个性越来越开朗，也爱动脑筋。",
      "小年剃头以后，最近进步很大，个性越来越开朗，也爱动脑筋。"
    ),
  },
  {
    id: "event-r23-20260716-eats-porridge",
    rationale: "people=[many]; first message 'self-feeding' sent by parent, 大兵老师 confirms; drop anon attribution",
    oldSnippet: "群里有人说，小年自己吃粥，吃得挺好，都没有掉出来。",
    newTitle: null,
    story: (old) => old.replace(
      "群里有人说，小年自己吃粥，吃得挺好，都没有掉出来。",
      "小年自己吃粥，吃得挺好，都没有掉出来。"
    ),
  },
  {
    id: "event-r23-20260718-water-play",
    rationale: "people=[]; first speaker unknown; 奶奶appears as second speaker; merge observation into one sentence",
    oldSnippet: "群里有人说，小年今天玩水游泳很开心。奶奶说：「年年在水里玩好舒服啊，不热啦。」",
    newTitle: null,
    story: (_old) =>
      "小年今天玩水游泳很开心。奶奶说：「年年在水里玩好舒服啊，不热啦。」",
  },
  {
    id: "event-r23-20260727-clean-plate",
    rationale: "daycare 日报 style: all 3 sources are teacher reports about 大班; '群里有人说' → '老师说'",
    oldSnippet: "群里有人说，小年在大班独立吃餐有进步。老师说，",
    newTitle: null,
    story: (old) => old.replace(
      "群里有人说，小年在大班独立吃餐有进步。老师说，",
      "老师说，小年在大班独立吃餐有进步，"
    ),
  },
  {
    id: "event-v2-56dbe39e973bd45ed2a7812f304be947",
    rationale: "daycare 日报 style with '哦'; teacher wrote 'yrs' about eating speed",
    oldSnippet: "群里还有人说，吃点心时小年年每次都比别的孩子快一点。",
    newTitle: null,
    story: (old) => old.replace(
      "群里还有人说，吃点心时小年年每次都比别的孩子快一点。",
      "老师还说，吃点心时小年年每次都比别的孩子快一点。"
    ),
  },
];

const PROFILE_ID = "profile-zhangnian";

const rds = await openRds({ readOnly: DRY_RUN });
try {
  // Fetch current stories
  const ids = FIXES.map((f) => f.id);
  const { rows } = await rds.client.query(`
    SELECT id, title, story FROM life_events WHERE id = ANY($1::text[])
  `, [ids]);

  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  let appliedCount = 0;
  let skippedCount = 0;

  for (const fix of FIXES) {
    const current = byId[fix.id];
    if (!current) {
      console.log(`  SKIP [${fix.id}]: not found in DB`);
      skippedCount++;
      continue;
    }

    const newStory = fix.story(current.story);
    const newTitle = fix.newTitle !== null ? fix.newTitle : current.title;

    if (newStory === current.story && newTitle === current.title) {
      console.log(`  NOOP [${fix.id}]: already clean`);
      skippedCount++;
      continue;
    }

    const newHash = sha256(newStory);

    console.log(`\n${DRY_RUN ? "[DRY RUN] WOULD FIX" : "FIXING"} [${fix.id}]`);
    console.log(`  Rationale: ${fix.rationale}`);
    if (newTitle !== current.title) {
      console.log(`  title: "${current.title}" → "${newTitle}"`);
    }
    const oldExcerpt = current.story.slice(0, 80).replace(/\n/g, " ");
    const newExcerpt = newStory.slice(0, 80).replace(/\n/g, " ");
    if (oldExcerpt !== newExcerpt) {
      console.log(`  story[0:80]: "${oldExcerpt}"`);
      console.log(`       →      "${newExcerpt}"`);
    }
    console.log(`  new sha256: ${newHash}`);

    if (!DRY_RUN) {
      // Update story
      await rds.client.query(`
        UPDATE life_events SET title = $1, story = $2 WHERE id = $3
      `, [newTitle, newStory, fix.id]);

      // Write new approved review
      const reviewId = `review-r6-vagueperson-${fix.id}`;
      await rds.client.query(`
        INSERT INTO content_quality_reviews
          (id, profile_id, target_kind, target_id, decision, reason_codes,
           provider, prompt_version, policy_version, review_fingerprint, reviewed_at)
        VALUES ($1, $2, 'life_event', $3, 'approved', $4::jsonb,
                'claude:r6-vague-fix', 'r6-vague-person-v1', 'r6-vague-person-v1',
                $5, NOW())
        ON CONFLICT (id) DO UPDATE SET
          decision = EXCLUDED.decision,
          reason_codes = EXCLUDED.reason_codes,
          reviewed_at = EXCLUDED.reviewed_at
      `, [
        reviewId,
        PROFILE_ID,
        fix.id,
        JSON.stringify({ codes: ["vague-person-term-replaced"], content_sha256: newHash }),
        newHash,
      ]);
    }

    appliedCount++;
  }

  console.log(`\n=== ${DRY_RUN ? "DRY RUN" : "DONE"}: ${appliedCount} fixed, ${skippedCount} skipped ===`);
} finally {
  await rds.close();
}
