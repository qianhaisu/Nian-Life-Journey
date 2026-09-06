#!/usr/bin/env node
// A-6: writes the "trace layer" marker for 2025 store_only life_events whose subject is clearly
// 张年 and whose text reads fine years later. Does NOT touch life_events.* or existing
// content_quality_reviews rows.
//
// targetKind is deliberately 'life_event_trace', NOT 'life_event': lib/organizer/quality-review.ts's
// indexReviews() builds a Map keyed by `${targetKind}:${targetId}` from an UNORDERED
// `select().from(contentQualityReviews)` (no ORDER BY in postgres-repository.ts) and the last row
// read wins on that key. A second row keyed 'life_event:<id>' for an already-reviewed life_event
// would race the real T20-C decision for that same map key — decision='trace_eligible' doesn't
// normalize to a QualityDecision, so if it happened to win the race the event would flip to
// 'needs_human_review' and silently vanish from B-17's `traceEvents` filter (`=== "store_only"`),
// which is the opposite of this task's goal. 'life_event_trace' is an entirely separate map key,
// so this can never collide with or overwrite any real review regardless of row order.
// promptVersion is still 'a6-trace-layer-v1' for its own sake (readable audit trail, keeps the
// (targetKind, targetId, promptVersion) unique index meaningful) but no longer needs to avoid a
// real prompt version, since targetKind already guarantees isolation.
// B track reads eligibility with: target_kind='life_event_trace' and target_id=<life_event.id> and
// provider='cowork-a6' and decision='trace_eligible'.
//
//   node --import tsx -r dotenv/config scripts/a6-trace-layer-write.mjs --commit dotenv_config_path=.env.local
//
// Without --commit, prints counts per month and exits (dry run).
import { randomUUID } from "node:crypto";
import pg from "pg";

const COMMIT = process.argv.includes("--commit");
const PROFILE_ID = "profile-zhangnian";
const PROMPT_VERSION = "a6-trace-layer-v1";
const POLICY_VERSION = "trace-layer-v1";
const PROVIDER = "cowork-a6";

// id -> reason code. Absence from this map (for a store_only 2025 life_event) = excluded from the
// trace layer; excluded items get no row (see A-6 rule: "宁可没有，不要错的").
// EXCLUDE reason codes kept in comments next to each month for the audit trail in STATUS.md;
// this file only needs the INCLUDE set since that's the only thing persisted.
const INCLUDE = {
  // 2025-01 (10/18 store_only)
  "event-v2-a7e2fe96502d78436131daa90946263b": "about_child_specific_incident",
  "event-v2-648f93de4ac88c7d54823a34431d958f": "about_child_specific_fact",
  "event-v2-ae2d380cd8d8a70445e4c6730715a483": "about_child_caregiving",
  "event-v2-74ac4388491171296f7704b15f6eaee0": "about_child_warm_moment",
  "event-v2-195eda67a027157029c248f7a8f0979a": "about_child_daily_texture",
  "event-v2-5c640a2d69b4bc1418beb77dbb7a875a": "about_child_family_moment",
  "event-v2-86c96b61c1758e3c66657a6d82261c1e": "about_child_specific_fact",
  "event-v2-00f6dd289e7a0e5378d76f35c12e3d53": "about_child_family_moment",
  "event-v2-51d95017d8e243a8d3900d56654be54b": "about_child_caregiving",
  "event-v2-6f2cd69a38f8db0b1f7c6490498bf0a4": "about_child_caregiving",
  // 2025-02 (13/19 store_only)
  "event-v2-eb9ec8e0bb414860bf00053e867e9a73": "about_child_caregiving",
  "event-v2-0521a98a08498906d97a0a935703f1fe": "about_child_family_moment",
  "event-v2-bd9f33c663f08cc3917f90bac1858298": "about_child_caregiving",
  "event-v2-92ed9049516629401b7b4756b06fe8f5": "about_child_milestone_adjacent",
  "event-v2-3e77b3997bee32f644bd6b594eb86ef2": "about_child_specific_incident",
  "event-v2-0ba5865d766b491b71284bb43b306752": "about_child_caregiving",
  "event-v2-0636f655470f4d8093d6f65937f10f74": "about_child_daily_texture",
  "event-v2-d01dbf181374f2fa4d94a00a2a8fc8df": "about_child_family_moment",
  "event-v2-25af4e0e05bc565c8c58456781758566": "about_child_family_moment",
  "event-v2-c9eaf4b0e2e900880d33c73bfc926bc6": "about_child_family_moment",
  "event-v2-ae40d73e611bc36918edc24096527c14": "about_child_daily_texture",
  "event-v2-c21f0871b6bb4fe4d7b07bd314ff27fe": "about_child_specific_moment",
  "event-v2-fa4d930aacf3771ca9625e812d9d7713": "about_child_family_moment",
  // 2025-03 (10/11 store_only)
  "event-v2-4b5416f09f3c613a13e9bdfb06bffda2": "about_child_medical",
  "event-v2-3ee8e4e59714106ba555d839353183ac": "about_child_specific_incident",
  "event-v2-44158735a93e95a120e50dc4aee5a143": "about_child_specific_moment",
  "event-v2-7ea89d3ffc4b17fe3a3eab06d2466974": "about_child_family_humor",
  "event-v2-514a8a7c0936e74d174ffaf5defc26ee": "about_child_specific_detail",
  "event-v2-622965f7004e805787f437c5e644f9a3": "about_child_family_humor",
  "event-v2-46e1bd58fbfdd5ab2616bee2c955d26c": "about_child_specific_incident",
  "event-v2-4e37e3cf5d8a6ee00e70b1037e9e26e4": "about_child_family_moment",
  "event-v2-dae7da08b6680539ed79aa54f730a77a": "about_child_growth_observation",
  "event-v2-6ff7b91da245c42f2ea7b29f8fd47f95": "about_child_milestone_adjacent",
  // 2025-04 (3/4 store_only)
  "event-v2-c891d40614fc2536e19c49f27854c415": "about_child_medical",
  "event-v2-0020a0a535d2df7edecc421e7e354176": "about_child_caregiving",
  "event-v2-05d33b31a5c0104c44242af6d7294576": "about_child_family_humor",
  // 2025-05 (7/9 store_only)
  "event-v2-beeba87f031fda79f899381fc0f5866d": "about_child_caregiving",
  "event-v2-a92d19fe9711d1ff742a59389137739d": "about_child_daily_texture",
  "event-v2-a5c851c03f7ace2345a01142676f8bdb": "about_child_caregiving",
  "event-v2-5395f2ec69ae1c37828e25c743d6a6ec": "about_child_caregiving",
  "event-v2-e4bc91ca07c250e3ded122928fea0142": "about_child_daily_texture",
  "event-v2-fdcc3b88c51b2ea9216486b3153f6576": "about_child_family_moment",
  "event-v2-d52904825cb8c01595fea7d23c433379": "about_child_specific_moment",
  // 2025-06 (9/12 store_only — verification benchmark month)
  "event-v2-b574a4aad0315bcec991d9b1052ae45f": "about_child_caregiving",
  "event-v2-e9099a2c4a64380c5a35040d0dc42825": "about_child_daily_texture",
  "event-v2-21fe2b70ff9fbe0f740cde8fee9c500d": "about_child_safety_concern",
  "event-v2-e4cc80ff646bfaa689e0d744fddab8d7": "about_child_specific_moment",
  "event-v2-8bf77ff3ed20f8713d1496c68665b0b3": "about_child_caregiving",
  "event-v2-3122505362580e0a1a822071d016f71d": "about_child_family_humor",
  "event-v2-bbaa7e18a90c816f92b0b8afcf3ce306": "about_child_daily_texture",
  "event-v2-ce8e958b092dac1c97d039482620ab13": "about_child_activity",
  "event-v2-08aeb20bd787d87c92c1924eb607e5db": "about_child_activity",
  // 2025-07 (26/30 store_only)
  "event-v2-1548e3bce63de19bccdec6e872c57777": "about_child_caregiving",
  "event-v2-1d4e0304b12f758ebc362e8d22a28422": "about_child_gift",
  "event-v2-8af5f505435e64773dadcbe07bc2ea25": "about_child_emotional_bond",
  "event-v2-ab1d3c5273049d116f27d24c5759b8cf": "about_child_gift",
  "event-v2-481f8a519820a6fdc61416167ada5710": "about_child_specific_detail",
  "event-v2-4e3063768a446be02ad84d22e3ffb10c": "about_child_emotional_bond",
  "event-v2-7cfe201959d573357970d0281af0f600": "about_child_growth_observation",
  "event-v2-4cf9eec8aed8f8b0a3d4cb7b3f6bb254": "about_child_protective_concern",
  "event-v2-3f5f8c04b3e839e83a4ab9ae795558c5": "about_child_feeding_milestone",
  "event-v2-20042ff0e45543a90381b52ba40854ed": "about_child_specific_detail",
  "event-v2-7fe69908a74f3a62ca72f349af035c5a": "about_child_medical",
  "event-v2-db75dc3ae9e3527cf46b2aa6e2fcd4af": "about_child_family_humor",
  "event-v2-a1bc8cf2c3ec3edefbc638654e3a188c": "about_child_family_humor",
  "event-v2-1b9f0147bedc51f9f28c79b9215578bd": "about_child_family_humor",
  "event-v2-91dbac3a57e6c3e93a19b75bbfb8ec43": "about_child_daily_texture",
  "event-v2-f091b13c72b11cec0bfe79e13ab295ae": "about_child_gift",
  "event-v2-8eec35cd507364672cb54b8d650034fc": "about_child_specific_detail",
  "event-v2-0598facd2fd54cc195cd5b55612ecf43": "about_child_daily_texture",
  "event-v2-5ab04411ee074f3fc8935a9815bafe19": "about_child_activity",
  "event-v2-80a84ebe1fe4941830d2d1f9e65e196d": "about_child_caregiving",
  "event-v2-d4c80a5b27ef9cfe3c6c44e1e0681b13": "about_child_medical",
  "event-v2-ea997f824f1f7b57473b653054edf59d": "about_child_activity",
  "event-v2-ea97c4761e86d5a7a2979bcc894967cc": "about_child_specific_moment",
  "event-v2-0aeb920bd9a0264b21e69794e7dec9ce": "about_child_caregiving",
  "event-v2-334de43635683116d1b8068ea8ec99c8": "about_child_daily_texture",
  "event-v2-1dde15faf52cba6190c98a08275d0165": "about_child_specific_detail",
  // 2025-08 (22/30 store_only)
  "event-v2-56db16cee2557d6968b84ed298f3babf": "about_child_daily_texture",
  "event-v2-7313d7e7d07dd2478eb3a54826322b0e": "about_child_caregiving",
  "event-v2-db5e188ddd2110e3ee0d5071c42ea98c": "about_child_medical",
  "event-v2-076b8e6b254f9922f848939481ac0ca9": "about_child_feeding",
  "event-v2-41864f169d75f7e6061095c600302bbb": "about_child_feeding",
  "event-v2-1b1456f0162c63692016a53dd7cfae8b": "about_child_feeding",
  "event-v2-53484d3757d62c4d771ac11b66830ad1": "about_child_daily_texture",
  "event-v2-80feefe1aba8df1032741b18f0421cbe": "about_child_specific_detail",
  "event-v2-9b52e23ae0dc3c34a4d2ec29e363b169": "about_child_family_humor",
  "event-v2-09f631c7fb0ba9285ce15484ae8bcea1": "about_child_milestone_adjacent",
  "event-v2-d20195db1e60db79c9a87642ba0f3e17": "about_child_daily_texture",
  "event-v2-7b4a4af399ef9183a3ff2dd005198ef0": "about_child_emotional_bond",
  "event-v2-ea6038d3607a3876da3a775e6792c313": "about_child_personality_trace",
  "event-v2-1a2c34bcc6983e55da09e9d8e42b11e5": "about_child_emotional_bond",
  "event-v2-5b4999fc99fa641ed5461f74ebc614ce": "about_child_parenting_intention",
  "event-v2-9232d050358d47b06ff30c9d4d22a4a9": "about_child_family_humor",
  "event-v2-d865de6673bdca12efbfaa09855f483f": "about_child_milestone_adjacent",
  "event-v2-b50c2109b675db42959a4cdf55469be6": "about_child_family_humor",
  "event-v2-cb523d72a806dba9970acdb004c2aa96": "about_child_personality_trace",
  "event-v2-4cd747443677d76411b43edc83723150": "about_child_medical",
  "event-v2-fe6b9494082f2bb7535556892c56b20d": "about_child_environment",
  "event-v2-12b3f5ae099250d9d84f83e977a17419": "about_child_specific_detail",
  // 2025-09 (19/25 store_only)
  "event-v2-1db183b6cbc13a53a7ce50b3b81bddaa": "about_child_feeding",
  "event-v2-3692c9fef43dca8b7effb1657107f488": "about_child_medical",
  "event-v2-73d88c28be4dcb5884ec5ec92ab9007e": "about_child_environment",
  "event-v2-3198063beb5ac6f17f2450f3ce92ff75": "about_child_family_humor",
  "event-v2-ed0694cec7a8994e71814ffd04aea73e": "about_child_activity",
  "event-v2-2a496db12506c76b0d6834d1cbef94e6": "about_child_pet_anecdote",
  "event-v2-5362e714d2bac5de66e9895d2cf0a5e7": "about_child_specific_detail",
  "event-v2-b0c5c007ec49e49f62904f16d2a73b5b": "about_child_specific_detail",
  "event-v2-dc0f2e6ac6503a3d3cc5fd907b8b6abf": "about_child_daily_texture",
  "event-v2-345f4f51e779e016f6ac04ae8f666e93": "about_child_emotional_reflection",
  "event-v2-65a8ad9f3dcafe69331c3ca9517a0399": "about_child_developmental",
  "event-v2-47e6374ced73542d4e8646aa2fc3e019": "about_child_medical",
  "event-v2-46c0de5adf00e70277d0054f25637bb5": "about_child_activity",
  "event-v2-8eb03cb30f5c133f94b4cd40e2091987": "about_child_family_humor",
  "event-v2-d13e7b1e10c86b53bd8d4060484336d0": "about_child_family_humor",
  "event-v2-ca9d0b532ddbbb1c3373946e25605097": "about_child_safety_note",
  "event-v2-003043314c6b7b2213d9148b18d08124": "about_child_emotional_attentiveness",
  "event-v2-4023fb349137b074a2185319843fe00d": "about_child_daily_texture",
  "event-v2-722bb49cf704adb4331245cabb87d00e": "about_child_daily_texture",
  // 2025-10 (19/22 store_only)
  "event-v2-2c6811fb8c03473ebc37b30e5d45a0ef": "about_child_specific_moment",
  "event-v2-fda2287f81bc28d6bc26f9ca6fec3de6": "about_child_specific_detail",
  "event-v2-e8aa933558b8ce662945afb379437578": "about_child_family_humor",
  "event-v2-2e68d02550a6f69a124ac83411cb4681": "about_child_caregiving",
  "event-v2-9302f77c4b1b90da900eece507542778": "about_child_caregiving",
  "event-v2-975305f61765d8ab110254acbc6efb0f": "about_child_family_humor",
  "event-v2-41b034dbcb40771b7c9f6b6ec90dd858": "about_child_developmental",
  "event-v2-3268ca3b7053492bd6f3451f68acec98": "about_child_specific_moment",
  "event-v2-ad97e1df5a96b7aa0678e4220f91318d": "about_child_specific_detail",
  "event-v2-21715f4b9f36bcf4ae2335aadcc6c847": "about_child_activity",
  "event-v2-774b20dd3cb45459340a61d4b778a3e6": "about_child_specific_moment",
  "event-v2-ca00160d4302c7ca3d684e07755c6f04": "about_child_emotional_bond",
  "event-v2-44c2ecd22a9f5b53fc4670e532d40b76": "about_child_caregiving",
  "event-v2-5cecff0d5b46a55ec84aa12f32b21f6b": "about_child_specific_moment",
  "event-v2-894d097e030784a545111b16b2b05574": "about_child_developmental",
  "event-v2-0ef4c22ce53c1012e7d7c5675d80ab56": "about_child_specific_detail",
  "event-v2-74f6e8987b62e147d4cecc00c0f35da3": "about_child_family_humor",
  "event-v2-f76df5a3722a675dc5651c68fe25226b": "about_child_emotional_bond",
  "event-v2-90c0878ec2c34ac2947a4a42b8354c5a": "about_child_specific_detail",
  // 2025-11 (15/18 store_only)
  "event-v2-684cf92c6e0ab38d4ab474870f307fb7": "about_child_family_humor",
  "event-v2-d820e147a2139b68ab747d523492eef0": "about_child_caregiving",
  "event-v2-9a9c0b4448cf9cc9f5626c86d10406f3": "about_child_concern_check",
  "event-v2-aa24066543d034acb87a5306e4c6e273": "about_child_emotional_reflection",
  "event-v2-b8e90609fe1cba8fd54344eb30612494": "about_child_caregiving",
  "event-v2-684d5ffa2d4c3ba76abbf4646d612ec8": "about_child_activity",
  "event-v2-e2376ea93eeef32ecc904923c839654c": "about_child_daily_texture",
  "event-v2-8519289cd3533ae864c5eb9e222b54c7": "about_child_emotional_bond",
  "event-v2-258ca6fbc9e26ec161cc9ed93ebe04d4": "about_child_caregiving",
  "event-v2-3c040188518be8659c1b235a9a7a40f5": "about_child_family_humor",
  "event-v2-4afe59e9d10cd01b07582015adc4a2fa": "about_child_travel_prep",
  "event-v2-3058e68ffbf0c9be315a18144735a9c0": "about_child_caregiving",
  "event-v2-c7d9bcdea7a70e1d7bfcdf71bed916c3": "about_child_daily_texture",
  "event-v2-c4a997639da5dd83fcc452eade0e0deb": "about_child_family_humor",
  "event-v2-60e42a6fb004e65e232d8f5af84859c4": "about_child_travel_prep",
  // 2025-12 (14/19 store_only)
  "event-v2-ac5684588b743c71879cd2d8e8e92572": "about_child_emotional_reflection",
  "event-v2-e81953ccf857a74892f61aaf9ea88086": "about_child_travel_prep",
  "event-v2-aa8973a75fee2a6d956016466560fd3c": "about_child_emotional_bond",
  "event-v2-ee7eb301eab0eb904b89b6cec1dc46bc": "about_child_daily_texture",
  "event-v2-8b68d515333b2079bd8b5d7a77d4653a": "about_child_gift",
  "event-v2-bd5e97cf28a796e0e7082187feb803a4": "about_child_family_moment",
  "event-v2-15a7c9b7227a03d9d7b602b3d3a0b2ca": "about_child_family_moment",
  "event-v2-da378406ffab8d7fd9ac4e435b8c0927": "about_child_gift",
  "event-v2-e58bdd60fd653cca5e68a484cfc949d9": "about_child_specific_moment",
  "event-v2-e338c4b24a02bd96c07fa74b64218f1d": "about_child_specific_detail",
  "event-v2-bb4201bedc139222859afa09925ec5c7": "about_child_travel_prep",
  "event-v2-35438d0ac104436c0557114f700e300e": "about_child_activity",
  "event-v2-5a0176d78b16c3dbcffabadb3508c3f4": "about_child_daily_texture",
  "event-v2-e8b70500b3804523b9a459ae988bb542": "about_child_emotional_reflection",
};

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const ids = Object.keys(INCLUDE);
console.log(`A-6 trace-layer candidates: ${ids.length} life_events`);

if (!COMMIT) {
  console.log("Dry run — pass --commit to write. No rows written.");
  await client.end();
  process.exit(0);
}

let inserted = 0, skipped = 0;
for (const id of ids) {
  const reasonCode = INCLUDE[id];
  const res = await client.query(
    `insert into content_quality_reviews
       (id, profile_id, target_kind, target_id, decision, reason_codes, provider, model, prompt_version, policy_version, review_fingerprint)
     values ($1, $2, 'life_event_trace', $3, 'trace_eligible', $4::jsonb, $5, null, $6, $7, $8)
     on conflict (target_kind, target_id, prompt_version) do nothing`,
    [randomUUID(), PROFILE_ID, id, JSON.stringify([reasonCode]), PROVIDER, PROMPT_VERSION, POLICY_VERSION, `a6-trace:${id}`],
  );
  if (res.rowCount > 0) inserted++; else skipped++;
}

console.log(`inserted: ${inserted}, already present (skipped): ${skipped}`);
await client.end();
