import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  UNKNOWN_SPEAKER_LABEL, displayLabelFor, displayNameVariants, distinctSpeakerCount,
  harvestDisplayNameCandidates, mayNameInNarrative, recoverDisplayNames, resolveSpeaker,
  senderDigestForDisplayName,
} from "../lib/organizer/identity.ts";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";

const NANNY_EXPORT_NAME = "hxx" + String.fromCharCode(92) + ".";
const sha = (v) => createHash("sha256").update(v, "utf8").digest("hex");

test("senderDigestForDisplayName reproduces the importer's hash chain exactly", () => {
  // Mirrors lib/ingest/wechat-markdown.ts (senderId) + lib/ingest/wechat-import.ts (senderDigest).
  const expected = sha(`sender:${sha("Ted").slice(0, 24)}`);
  assert.equal(senderDigestForDisplayName("Ted"), expected);
});

test("recovery matches forward only: an unknown speaker stays unknown", () => {
  const known = [senderDigestForDisplayName("Ted"), senderDigestForDisplayName("阿静"), "0".repeat(64)];
  const recovered = recoverDisplayNames(known, ["Ted", "阿静", "完全没出现过的名字"]);
  assert.equal(recovered.get(senderDigestForDisplayName("Ted")), "Ted");
  assert.equal(recovered.get(senderDigestForDisplayName("阿静")), "阿静");
  assert.equal(recovered.has("0".repeat(64)), false, "an unmatched digest must never be resolved");
  assert.equal(recovered.size, 2);
});

// The archive's second-largest speaker (3,140 messages) only matched in its escaped spelling.
test("a markdown-escaped display name is recovered from its unescaped mention", () => {
  const digest = senderDigestForDisplayName(NANNY_EXPORT_NAME);
  assert.ok(displayNameVariants("hxx").includes(NANNY_EXPORT_NAME));
  assert.equal(recoverDisplayNames([digest], ["hxx"]).get(digest), NANNY_EXPORT_NAME);
});

test("candidates are harvested from mentions, quoted replies and withdrawal lines", () => {
  const candidates = harvestDisplayNameCandidates([
    "@hxx\. 晚上吃啥",
    "> 苏静: 我们几点到？",
    '"Ted" 撤回了一条消息',
  ]);
  assert.ok(candidates.has("hxx"));
  assert.ok(candidates.has("苏静"));
  assert.ok(candidates.has("Ted"));
});

const registry = {
  participants: [
    { sourceParticipantDigest: senderDigestForDisplayName("Ted"), displayName: "Ted", canonicalPersonId: "person-a", relationshipToSubject: "father", narrativeLabel: "爸爸" },
    { sourceParticipantDigest: senderDigestForDisplayName("阿静"), displayName: "阿静", canonicalPersonId: "person-b", relationshipToSubject: "mother", narrativeLabel: "妈妈" },
    // Same human, later display name. Canonical id keeps them one person.
    { sourceParticipantDigest: senderDigestForDisplayName("静静"), displayName: "静静", canonicalPersonId: "person-b", relationshipToSubject: "mother", narrativeLabel: "妈妈" },
    // Recovered name, but the family has not confirmed who this is.
    { sourceParticipantDigest: senderDigestForDisplayName(NANNY_EXPORT_NAME), displayName: NANNY_EXPORT_NAME },
  ],
};

test("a mapped speaker resolves to its narrative label; an unmapped one is explicitly unknown", () => {
  const ted = resolveSpeaker(senderDigestForDisplayName("Ted"), registry);
  assert.equal(displayLabelFor(ted), "爸爸");
  assert.ok(mayNameInNarrative(ted));

  const stranger = resolveSpeaker("f".repeat(64), registry);
  assert.equal(stranger.known, false);
  assert.equal(displayLabelFor(stranger), UNKNOWN_SPEAKER_LABEL);
  assert.equal(mayNameInNarrative(stranger), false, "an unmapped speaker may never be named in a story");
});

test("a recovered display name alone does not authorise naming the person in a story", () => {
  const hxx = resolveSpeaker(senderDigestForDisplayName(NANNY_EXPORT_NAME), registry);
  assert.equal(hxx.known, true);
  assert.equal(mayNameInNarrative(hxx), false);
  assert.equal(hxx.relationshipToSubject, undefined, "relationship is never inferred");
});

test("displayName changes but the canonical person stays one speaker", () => {
  const before = resolveSpeaker(senderDigestForDisplayName("阿静"), registry);
  const after = resolveSpeaker(senderDigestForDisplayName("静静"), registry);
  assert.notEqual(before.displayName, after.displayName);
  assert.equal(before.speakerKey, after.speakerKey);
  assert.equal(distinctSpeakerCount([before.senderDigest, after.senderDigest], registry), 1);
});

test("爸爸 and 妈妈 independently reporting the same milestone counts as two speakers", () => {
  const digests = [senderDigestForDisplayName("Ted"), senderDigestForDisplayName("阿静")];
  assert.equal(distinctSpeakerCount(digests, registry), 2);
});

test("two unknown speakers stay two speakers and are never merged into one generic sender", () => {
  assert.equal(distinctSpeakerCount(["a".repeat(64), "b".repeat(64)], undefined), 2);
});

// End-to-end against the Evidence Builder: two speakers in one window stay distinguishable, and a
// photo from one speaker does not silently become the other speaker's evidence.
test("one speaker's photo and another's unrelated text stay separate speakers in the window", () => {
  const src = (o) => ({ id: o.id, profileId: "p", sourceType: "wechat", contentTypes: ["family"], contributorId: "contributor-system", capturedAt: o.capturedAt, text: o.text ?? "", mediaIds: o.mediaIds ?? [], visibility: "family", metadata: { senderDigest: o.sender }, sourceLabel: "conv", contributorRole: undefined });
  const [window] = buildEvidenceWindows("conv-two-speakers", "p", [
    src({ id: "a", sender: senderDigestForDisplayName("Ted"), capturedAt: "2026-08-20T10:00:00+08:00", mediaIds: ["photo-1"] }),
    src({ id: "b", sender: senderDigestForDisplayName("阿静"), capturedAt: "2026-08-20T10:01:00+08:00", text: "快递到了吗" }),
  ], { dailyTraces: [], lifeEvents: [] });
  assert.equal(window.stats.senderCount, 2);
  assert.equal(distinctSpeakerCount(window.items.map((i) => i.senderDigest), registry), 2);
  const binding = window.mediaBindings.find((b) => b.mediaId === "photo-1");
  assert.ok(binding.confidence < 0.75, `an unrelated speaker's text must not strongly bind the photo (got ${binding.confidence})`);
});

// --- Verified family registry -------------------------------------------------------------------
test("the verified registry resolves all three confirmed speakers and nobody else", async () => {
  const { FAMILY_REGISTRY, relationshipForSender } = await import("../lib/organizer/family-registry.ts");
  const ted = resolveSpeaker(senderDigestForDisplayName("Ted"), FAMILY_REGISTRY);
  const mother = resolveSpeaker(senderDigestForDisplayName("阿静"), FAMILY_REGISTRY);
  const nanny = resolveSpeaker(senderDigestForDisplayName(NANNY_EXPORT_NAME), FAMILY_REGISTRY);
  assert.equal(displayLabelFor(ted), "爸爸");
  assert.equal(displayLabelFor(mother), "妈妈");
  assert.equal(displayLabelFor(nanny), "雪姨");
  assert.equal(mother.canonicalPersonId, "person-sujing");
  assert.equal(relationshipForSender(senderDigestForDisplayName(NANNY_EXPORT_NAME)), "nanny");
  const stranger = resolveSpeaker("c".repeat(64), FAMILY_REGISTRY);
  assert.equal(stranger.known, false);
  assert.equal(displayLabelFor(stranger), UNKNOWN_SPEAKER_LABEL);
  assert.equal(relationshipForSender("c".repeat(64)), undefined);
});

test("父母与育儿嫂的转述都算亲历观察，未知发言人不算", async () => {
  const { classifyTier } = await import("../lib/organizer/evidence/tier.ts");
  const base = { id: "s", profileId: "p", sourceType: "wechat", contentTypes: ["family"], contributorId: "c", capturedAt: "2026-08-20T10:00:00+08:00", mediaIds: [], visibility: "family", sourceLabel: "conv" };
  assert.equal(classifyTier({ ...base, contributorRole: "father" }), "firsthand_observation");
  assert.equal(classifyTier({ ...base, contributorRole: "mother" }), "firsthand_observation");
  assert.equal(classifyTier({ ...base, contributorRole: "nanny" }), "firsthand_observation");
  assert.equal(classifyTier({ ...base, contributorRole: undefined }), "reported_speech");
});

test("三位家人各自的描述算三个见证人，同一人的两个显示名只算一个", async () => {
  const { FAMILY_REGISTRY } = await import("../lib/organizer/family-registry.ts");
  const digests = [senderDigestForDisplayName("Ted"), senderDigestForDisplayName("阿静"), senderDigestForDisplayName(NANNY_EXPORT_NAME)];
  assert.equal(distinctSpeakerCount(digests, FAMILY_REGISTRY), 3);
  assert.equal(distinctSpeakerCount([digests[1], digests[1]], FAMILY_REGISTRY), 1);
});
