import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  AUTOMATIC_REVIEW_PROVIDERS, CLAUDE_REVIEW_PROVIDER, STORY_DECISION_KINDS, assertAutomaticActor, assertHumanDecisionInput, assertNotAutomaticApproval, blockingHumanDecision, boundContentSha256,
  canonicalOccurredAtUtc, evaluateStoryProtection, mediaContentVersion, reviewerTypeOf, storyContentSha256,
} from "../lib/organizer/story-write-guard.ts";
import { NIANLIFE_DEEPSEEK_MODEL, assertProviderModel, resolveDeepSeekModel } from "../lib/organizer/deepseek-model.ts";

// The protection verdict is decided from the ledger alone. Each case is a production shape seen in
// GUARD-ledger-shape-2026-09-14 (provider/prompt_version/target_kind are real; ids are synthetic).

const aiEvent = (id, fp = `fp-${id}`) => ({ id, organizationFingerprint: fp, createdBy: "ai", organizerVersion: "organizer-v2-t7-subject-gate" });
const row = (targetKind, targetId, decision, provider, promptVersion, reviewedAt) => ({ targetKind, targetId, decision, provider, promptVersion, reviewedAt });

test("an Organizer candidate with only automatic rows is not protected", () => {
  const e = aiEvent("event-v2-a");
  const verdict = evaluateStoryProtection({ event: e }, [row("life_event", e.id, "needs_human_review", "deepseek", "family-writer-v2-calibrated-r2.2", "2026-09-11 01:51:00")]);
  assert.deepEqual(verdict, { protected: false, reasons: [] });
});

test("published through the human release route (no organizer run involved) is protected", () => {
  const e = aiEvent("event-q169-022-x");
  const verdict = evaluateStoryProtection({ event: e }, [
    row("life_event", e.id, "needs_human_review", "claude-code", "queue169-deliver-v1", "2026-09-13 01:06:00"),
    row("life_event", e.id, "approved", "commander-release-2026-09-13", "release-2026-09-13-R2", "2026-09-13 05:10:00"),
  ]);
  assert.equal(verdict.protected, true);
  assert.ok(verdict.reasons.includes("PUBLISHED"));
});

test("the incident shape — approved, then superseded by an automatic needs_human_review — is still protected", () => {
  const e = aiEvent("event-r23-x");
  const verdict = evaluateStoryProtection({ event: e }, [
    row("life_event", e.id, "approved", "deepseek", "family-writer-v2-calibrated-r2.1", "2026-09-05 00:00:00"),
    row("life_event", e.id, "needs_human_review", "deepseek", "family-writer-v2-calibrated-r2.2", "2026-09-13 15:29:00"),
  ]);
  assert.equal(verdict.protected, true);
  assert.ok(verdict.reasons.includes("EVER_APPROVED:life_event"));
  assert.ok(!verdict.reasons.includes("PUBLISHED"));
});

test("the three paused stories: human queue169 decisions protect an unpublished story", () => {
  for (const decision of ["adopt_original", "adopt_revised", "keep_unpublished", "deferred"]) {
    const e = aiEvent("event-v2-paused");
    const verdict = evaluateStoryProtection({ event: e }, [
      row("life_event", e.id, "needs_human_review", "deepseek", "family-writer-v2-calibrated-r2.2", "2026-09-11 02:50:00"),
      row("life_event_queue169", e.id, decision, "human", "queue169-commander-2026-09-13", "2026-09-13 08:40:42"),
    ]);
    assert.equal(verdict.protected, true, decision);
    assert.ok(verdict.reasons.includes(`HUMAN_DECISION:life_event_queue169:human:${decision}`));
  }
});

test("a queue169 decision addressed by fingerprint protects the event with that fingerprint, and an insert before it exists", () => {
  const rows = [row("life_event_queue169", "fingerprint:abc123", "keep_unpublished", "human", "queue169-commander-2026-09-13", "2026-09-13 08:40:42")];
  assert.equal(evaluateStoryProtection({ event: aiEvent("event-v2-new", "abc123") }, rows).protected, true);
  assert.equal(evaluateStoryProtection({ event: null, eventId: "event-v2-new", fingerprints: ["abc123"] }, rows).protected, true, "insert refused");
  assert.equal(evaluateStoryProtection({ event: null, eventId: "event-v2-new", fingerprints: ["other"] }, rows).protected, false);
});

test("media_subject_check is about a photograph, never a story; media_binding is a story decision", () => {
  const e = aiEvent("event-v2-m");
  assert.equal(evaluateStoryProtection({ event: e }, [row("media_subject_check", e.id, "approved", "claude-code", "subject-check-v1", "2026-09-11 15:51:00")]).protected, false);
  const bound = evaluateStoryProtection({ event: e }, [row("media_binding", `${e.id}|media-1`, "rejected", "claude-code", "story-binding-check-v1", "2026-09-12 01:32:00")]);
  assert.equal(bound.protected, true);
  assert.ok(bound.reasons.includes("HUMAN_DECISION:media_binding:claude-code:rejected"));
});

test("an unknown provider protects (allow-list of automatic producers, fail closed)", () => {
  const e = aiEvent("event-v2-u");
  assert.deepEqual([...AUTOMATIC_REVIEW_PROVIDERS], ["deepseek"]);
  for (const provider of ["nianlife-preview", "cowork-a6", "someone-new"]) {
    assert.equal(evaluateStoryProtection({ event: e }, [row("life_event_preview", e.id, "needs_human_review", provider, "x", "2026-09-11 00:00:00")]).protected, true, provider);
  }
});

test("a same-instant conflict that includes approved stays protected; a human-created story with no row is published and protected", () => {
  const e = aiEvent("event-v2-c");
  const tied = evaluateStoryProtection({ event: e }, [
    row("life_event", e.id, "approved", "deepseek", "a", "2026-09-13 15:30:00"),
    row("life_event", e.id, "needs_human_review", "deepseek", "b", "2026-09-13 15:30:00"),
  ]);
  assert.equal(tied.protected, true);
  assert.ok(tied.reasons.includes("SAME_INSTANT_CONFLICT") && !tied.reasons.includes("PUBLISHED"));
  assert.equal(evaluateStoryProtection({ event: { id: "event-user", createdBy: "user" } }, []).protected, true);
});

const content = { title: "标题", story: "正文。", occurredAtUtc: "2025-07-07T00:00:00.000000Z", memoryWeight: "trace", sourceIds: ["s1", "s2"], mediaIds: [], heroMediaId: null };

test("content hash: raw values, fixed order — one space, a reordered source list or a weight change is a new version", () => {
  const base = storyContentSha256(content);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(storyContentSha256({ ...content }), base);
  assert.notEqual(storyContentSha256({ ...content, story: "正文。 " }), base);
  assert.notEqual(storyContentSha256({ ...content, sourceIds: ["s2", "s1"] }), base);
  assert.notEqual(storyContentSha256({ ...content, memoryWeight: "memory" }), base);
  assert.notEqual(storyContentSha256({ ...content, heroMediaId: "m" }), base);
  assert.notEqual(storyContentSha256({ ...content, occurredAtUtc: "2025-07-08T00:00:00.000000Z" }), base);
});

test("occurredAt canonicalizes to one UTC microsecond instant however the driver spells it", () => {
  assert.equal(canonicalOccurredAtUtc("2025-07-07 08:00:00+08"), "2025-07-07T00:00:00.000000Z");
  assert.equal(canonicalOccurredAtUtc("2025-07-07T00:00:00.000Z"), "2025-07-07T00:00:00.000000Z");
  assert.equal(canonicalOccurredAtUtc("2025-07-07T00:00:00.123456Z"), "2025-07-07T00:00:00.123456Z");
  assert.throws(() => canonicalOccurredAtUtc("not a date"), /UNPARSEABLE_OCCURRED_AT/);
});

test("a reason-code list binds content only with exactly one well-formed hash", () => {
  const h = "a".repeat(64);
  assert.equal(boundContentSha256([`content-sha256:${h}`, "release"]), h);
  assert.equal(boundContentSha256([]), null);
  assert.equal(boundContentSha256([`content-sha256:${h}`, `content-sha256:${"b".repeat(64)}`]), null);
  assert.equal(boundContentSha256(["content-sha256:XYZ"]), null);
});

test("automatic writers: only the organizer actor, never approved, never a human provenance", () => {
  assert.doesNotThrow(() => assertAutomaticActor(undefined));
  assert.doesNotThrow(() => assertAutomaticActor("organizer"));
  assert.throws(() => assertAutomaticActor("human"), /ACTOR_NOT_ACCEPTED/);
  assert.throws(() => assertNotAutomaticApproval({ targetKind: "life_event", decision: "approved", provider: "deepseek" }), /AUTOMATIC_APPROVAL_FORBIDDEN/);
  assert.throws(() => assertNotAutomaticApproval({ targetKind: "life_event_queue169", decision: "keep_unpublished", provider: "human" }), /PROVIDER_NOT_AUTOMATIC/);
  assert.doesNotThrow(() => assertNotAutomaticApproval({ targetKind: "daily_trace", decision: "approved", provider: "human" }), "non-story kinds are out of scope");
});

test("human decisions must carry the reviewed hash and a non-automatic operator, and cannot smuggle their own hash code", () => {
  const ok = { eventId: "e", decision: "approved", reviewedContentSha256: "c".repeat(64), operator: "commander", promptVersion: "release-x", policyVersion: "release" };
  assert.doesNotThrow(() => assertHumanDecisionInput(ok));
  assert.throws(() => assertHumanDecisionInput({ ...ok, reviewedContentSha256: "" }), /MISSING_REVIEWED_CONTENT_HASH/);
  assert.throws(() => assertHumanDecisionInput({ ...ok, operator: "deepseek" }), /OPERATOR_NOT_HUMAN/);
  assert.throws(() => assertHumanDecisionInput({ ...ok, reasonCodes: [`content-sha256:${"d".repeat(64)}`] }), /REASON_CODE_RESERVED/);
});

test("2026-09-16 reviewer types: automatic, claude and human are three different things", () => {
  assert.equal(reviewerTypeOf("deepseek"), "automatic");
  assert.equal(reviewerTypeOf(CLAUDE_REVIEW_PROVIDER), "claude");
  assert.equal(reviewerTypeOf("human"), "human");
  // the historical claude-code rows were written through human routes; this change does not re-attribute them
  assert.equal(reviewerTypeOf("claude-code"), "human");
  assert.equal(reviewerTypeOf("nianlife-preview"), "human");
  assert.equal(reviewerTypeOf(undefined), "human", "unknown provenance fails closed as human");
  assert.ok(!AUTOMATIC_REVIEW_PROVIDERS.has(CLAUDE_REVIEW_PROVIDER), "a Claude decision is not an automatic write");
});

test("2026-09-16 a Claude approval protects a story and is reported as CLAUDE_DECISION, not HUMAN_DECISION", () => {
  const e = aiEvent("event-claude-x");
  const verdict = evaluateStoryProtection({ event: e }, [
    row("life_event", e.id, "needs_human_review", "deepseek", "family-writer-v2-calibrated-r2.2", "2026-09-11 01:51:00"),
    row("life_event", e.id, "approved", CLAUDE_REVIEW_PROVIDER, "claude-review-2026-09-16", "2026-09-16 12:00:00"),
  ]);
  assert.equal(verdict.protected, true);
  assert.ok(verdict.reasons.includes("CLAUDE_DECISION:life_event:approved"));
  assert.ok(!verdict.reasons.some((reason) => reason.startsWith("HUMAN_DECISION:")));
});

test("2026-09-16 human precedence: a pending marker does not block Claude, a decided human row does", () => {
  const id = "event-hp";
  const pending = [row("life_event_preview", id, "needs_human_review", "nianlife-preview", "p", "2026-09-10")];
  assert.equal(blockingHumanDecision(pending, STORY_DECISION_KINDS), undefined, "nobody decided yet");
  for (const decision of ["keep_unpublished", "deferred", "adopt_original", "approved", "store_only"]) {
    const decided = [row("life_event_queue169", id, decision, "human", "q", "2026-09-13")];
    assert.ok(blockingHumanDecision(decided, STORY_DECISION_KINDS), `a human ${decision} blocks`);
  }
  const claudeOnly = [row("life_event", id, "approved", CLAUDE_REVIEW_PROVIDER, "c", "2026-09-16")];
  assert.equal(blockingHumanDecision(claudeOnly, STORY_DECISION_KINDS), undefined, "Claude may revise its own earlier decision");
  const photoOnly = [row("media_binding", `${id}|m`, "approved", "human", "b", "2026-09-13")];
  assert.equal(blockingHumanDecision(photoOnly, STORY_DECISION_KINDS), undefined, "a photo pairing is judged separately");
});

test("2026-09-16 picture content version: checksum when there is one, a shape hash otherwise", () => {
  assert.equal(mediaContentVersion({ id: "m" }, "c".repeat(64)), `sha256:${"c".repeat(64)}`);
  assert.equal(mediaContentVersion({ id: "m" }, `sha256:${"c".repeat(64)}`), `sha256:${"c".repeat(64)}`);
  const a = mediaContentVersion({ id: "m", objectKey: "k", width: 10, height: 20 });
  assert.match(a, /^shape:[0-9a-f]{64}$/);
  assert.notEqual(a, mediaContentVersion({ id: "m", objectKey: "k", width: 10, height: 21 }), "a resized picture is a new version");
});

test("no automatic code path references the Claude review methods either", () => {
  const root = process.cwd();
  const offenders = [];
  const scan = (dir, accept) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { scan(full, accept); continue; }
      if (!accept(entry.name)) continue;
      if (/recordClaude(Story|Media)Decision/.test(readFileSync(full, "utf8"))) offenders.push(path.relative(root, full));
    }
  };
  scan(path.join(root, "lib", "organizer"), (name) => /\.(ts|mjs)$/.test(name) && name !== "story-write-guard.ts");
  scan(path.join(root, "scripts"), (name) => /^(organizer-|deepseek-|nianlife-worker|t20c-|month-review|wechat-|quark-)/.test(name));
  assert.deepEqual(offenders, []);
});

test("no automatic code path references the human decision method", () => {
  const root = process.cwd();
  const offenders = [];
  const scan = (dir, accept) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { scan(full, accept); continue; }
      if (!accept(entry.name)) continue;
      if (/recordHumanStoryDecision/.test(readFileSync(full, "utf8"))) offenders.push(path.relative(root, full));
    }
  };
  scan(path.join(root, "lib", "organizer"), (name) => /\.(ts|mjs)$/.test(name) && name !== "story-write-guard.ts");
  scan(path.join(root, "scripts"), (name) => /^(organizer-|deepseek-|nianlife-worker|t20c-|month-review|wechat-|quark-)/.test(name));
  assert.deepEqual(offenders, []);
});

test("DeepSeek model: one pinned id, no fallback, a substituted response is refused", () => {
  assert.equal(NIANLIFE_DEEPSEEK_MODEL, "deepseek-flash");
  assert.equal(resolveDeepSeekModel({}), "deepseek-flash");
  assert.equal(resolveDeepSeekModel({ AI_MODEL: "deepseek-flash" }), "deepseek-flash");
  assert.throws(() => resolveDeepSeekModel({ AI_MODEL: "deepseek-v4-pro" }), /MODEL_NOT_ALLOWED/);
  assert.throws(() => resolveDeepSeekModel({ ORGANIZER_V2_MODEL: "deepseek-v4-pro" }, "ORGANIZER_V2_MODEL"), /MODEL_NOT_ALLOWED/);
  assert.equal(assertProviderModel("deepseek-flash", { model: "deepseek-flash" }), "deepseek-flash");
  assert.equal(assertProviderModel("deepseek-flash", {}), null);
  assert.throws(() => assertProviderModel("deepseek-flash", { model: "deepseek-v4-pro" }), /PROVIDER_MODEL_MISMATCH/);
});
