/**
 * Tests for tryAutoReview logic extracted from organizer-month-write.mjs.
 * The function itself is not exported, so we exercise the same decision logic inline.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const AUTO_REVIEW_SUBJECT_SIGNALS = [
  /张年|小年年|宝宝|小朋友/,
  /睡觉|吃饭|喝奶|玩耍|洗澡|学会|走路|说话|长大|成长|发育/,
  /妈妈|爸爸|雪姨|奶奶|外婆|外公|爷爷/,
  /幼儿园|托班|乳儿班|老师/,
  /今天|这天/,
];

const MEDIA_PLACEHOLDER = /\[?(图片|视频|语音|文件|链接|表情|media)\]?/g;

function classify(title, story) {
  const combined = (title ?? "") + " " + (story ?? "");
  const cleaned = combined.replace(MEDIA_PLACEHOLDER, "").replace(/\s+/g, " ").trim();
  if (cleaned.length < 15) return { gate: "not-substantive" };
  if (!AUTO_REVIEW_SUBJECT_SIGNALS.some((p) => p.test(combined))) return { gate: "subject-unclear" };
  return { gate: "pass", cleaned };
}

// Simulate tryAutoReview with injected dependencies
async function tryAutoReview(eventId, title, story, { getVersion, recordDecision }) {
  const combined = (title ?? "") + " " + (story ?? "");
  const cleaned = combined.replace(MEDIA_PLACEHOLDER, "").replace(/\s+/g, " ").trim();
  if (cleaned.length < 15) return { skipped: "not-substantive" };
  if (!AUTO_REVIEW_SUBJECT_SIGNALS.some((p) => p.test(combined))) return { skipped: "subject-unclear" };
  let version;
  try { version = await getVersion(eventId); }
  catch (err) { return { skipped: `sha256-fetch-failed: ${String(err?.message ?? err).slice(0, 80)}` }; }
  if (!version) return { skipped: "event-not-found-after-write" };
  try {
    const result = await recordDecision({ eventId, reviewedContentSha256: version.contentSha256 });
    return { decision: "approved", idempotent: result.idempotent };
  } catch (err) {
    const code = err?.code ?? String(err?.message ?? err).match(/^([A-Z_]+)/)?.[1] ?? "";
    if (code === "HUMAN_DECISION_PRESENT") return { skipped: "human-protected" };
    if (code === "STALE_REVIEW_CONTENT") return { skipped: "stale-content" };
    if (code === "CLAUDE_DECISION_CONFLICT") return { skipped: "already-reviewed-this-version" };
    return { skipped: `review-error: ${String(err?.message ?? err).slice(0, 80)}` };
  }
}

describe("tryAutoReview", () => {
  const noop = () => {};
  const stubVersion = async () => ({ contentSha256: "abc123" });
  const stubDecision = async () => ({ idempotent: false });

  it("skips when story is not substantive (< 15 chars after stripping media)", async () => {
    const result = await tryAutoReview("id1", "ok", "[图片]", { getVersion: noop, recordDecision: noop });
    assert.equal(result.skipped, "not-substantive");
  });

  it("skips when subject signals absent", async () => {
    // No 张年/宝宝/妈妈/今天/etc. in either title or story
    const result = await tryAutoReview("id2", "天气报告", "阳光明媚，气温二十三度，空气质量优良，适合外出活动", { getVersion: noop, recordDecision: noop });
    assert.equal(result.skipped, "subject-unclear");
  });

  it("skips when sha256 fetch throws", async () => {
    const boom = async () => { throw new Error("connection refused"); };
    const result = await tryAutoReview("id3", "张年今天", "张年今天走路走得很稳，大家都很高兴", { getVersion: boom, recordDecision: noop });
    assert.ok(result.skipped.startsWith("sha256-fetch-failed"));
  });

  it("skips when sha256 fetch returns null (event not found)", async () => {
    const result = await tryAutoReview("id4", "张年", "张年今天学会了自己喝水，妈妈很开心", { getVersion: async () => null, recordDecision: noop });
    assert.equal(result.skipped, "event-not-found-after-write");
  });

  it("returns approved on success", async () => {
    const result = await tryAutoReview("id5", "张年", "张年今天和妈妈在一起很开心，学会说话了", { getVersion: stubVersion, recordDecision: stubDecision });
    assert.equal(result.decision, "approved");
    assert.equal(result.idempotent, false);
  });

  it("returns approved with idempotent=true on repeat call", async () => {
    const result = await tryAutoReview("id6", "张年", "张年今天和妈妈在一起很开心，学会说话了", {
      getVersion: stubVersion,
      recordDecision: async () => ({ idempotent: true }),
    });
    assert.equal(result.decision, "approved");
    assert.equal(result.idempotent, true);
  });

  it("skips human-protected stories", async () => {
    const err = Object.assign(new Error("HUMAN_DECISION_PRESENT"), { code: "HUMAN_DECISION_PRESENT" });
    const result = await tryAutoReview("id7", "张年", "张年今天在幼儿园表现很好，老师很开心", {
      getVersion: stubVersion,
      recordDecision: async () => { throw err; },
    });
    assert.equal(result.skipped, "human-protected");
  });

  it("skips on CLAUDE_DECISION_CONFLICT (already reviewed this version)", async () => {
    const err = Object.assign(new Error("CLAUDE_DECISION_CONFLICT"), { code: "CLAUDE_DECISION_CONFLICT" });
    const result = await tryAutoReview("id8", "张年", "张年今天在幼儿园表现很好，老师很开心", {
      getVersion: stubVersion,
      recordDecision: async () => { throw err; },
    });
    assert.equal(result.skipped, "already-reviewed-this-version");
  });
});
