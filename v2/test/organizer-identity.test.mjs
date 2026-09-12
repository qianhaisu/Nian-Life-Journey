import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  UNKNOWN_SPEAKER_LABEL, displayLabelFor, displayNameVariants, distinctSpeakerCount,
  harvestDisplayNameCandidates, mayNameInNarrative, recoverDisplayNames, resolveSpeaker,
  senderDigestForDisplayName,
} from "../lib/organizer/identity.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
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

// The Markdown export escapes the nanny's trailing dot and the JSON export does not, so the same
// person arrives under two digests. The plain spelling is mapped only inside the conversation the
// equivalence was demonstrated in (2026-09-12, the nursery class group, where both exports cover
// the same day); everywhere else it stays unknown.
test("育儿嫂未转义的显示名只在被证实的那个会话里解析，别处仍是未知", async () => {
  const { FAMILY_REGISTRY } = await import("../lib/organizer/family-registry.ts");
  const { DAYCARE_CONVERSATION } = await import("../lib/organizer/subject-gate.ts");
  const plain = senderDigestForDisplayName("hxx.");
  const escaped = senderDigestForDisplayName(NANNY_EXPORT_NAME);
  assert.notEqual(plain, escaped, "the two spellings must hash apart — that is the whole problem");

  const inDaycare = resolveSpeaker(plain, FAMILY_REGISTRY, { conversationId: DAYCARE_CONVERSATION });
  assert.equal(displayLabelFor(inDaycare), "雪姨");
  assert.equal(inDaycare.canonicalPersonId, "person-xueyi");

  const elsewhere = resolveSpeaker(plain, FAMILY_REGISTRY, { conversationId: "conversation:e6adbcafc3c6e32be0494251" });
  assert.equal(elsewhere.known, false, "小雪微信群 carries the same digest and is NOT part of this mapping");
  assert.equal(displayLabelFor(elsewhere), UNKNOWN_SPEAKER_LABEL);
  assert.equal(resolveSpeaker(plain, FAMILY_REGISTRY).known, false, "a caller that does not say where it is gets nothing");

  // Resolved inside that conversation, the two spellings are one person: same canonical id, so the
  // same speakerKey, which is what corroboration counting groups on.
  assert.equal(inDaycare.speakerKey, resolveSpeaker(escaped, FAMILY_REGISTRY).speakerKey);
  // distinctSpeakerCount() takes no conversation, so it cannot see a scoped entry and would count
  // the two spellings as two speakers. That is not reachable today — an evidence window is built
  // from one conversation, and each export writes only one of the two spellings — but it is the
  // reason this assertion states the limit instead of pretending it away.
  assert.equal(distinctSpeakerCount([plain, escaped], FAMILY_REGISTRY), 2);
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

// ---------------------------------------------------------------- the export's own placeholder
//
// A private-chat export writes the exporting account's own messages as 我. That digest identifies
// the FILE's owner, not a person: another household member's export puts someone else behind the
// same hash. Teddy confirmed on 2026-09-11 that the 阿静 and 陈亚萍 private chats came from his
// WeChat, so the mapping is his — inside those conversations and nowhere else.

const MOTHER_CHAT = "conversation:0567a44e538fc41f22b57097";
const GRANDMOTHER_CHAT = "conversation:5e89f3dacc787d226503906a";
const MAIN_GROUP = "conversation:a673c0e0563be6ecf1867094";
const ME_DIGEST = senderDigestForDisplayName("我");

test("我 resolves to the father inside the two confirmed private chats", () => {
  for (const conversationId of [MOTHER_CHAT, GRANDMOTHER_CHAT]) {
    const speaker = resolveSpeaker(ME_DIGEST, FAMILY_REGISTRY, { conversationId });
    assert.equal(speaker.known, true, conversationId);
    assert.equal(speaker.narrativeLabel, "爸爸");
    assert.equal(speaker.canonicalPersonId, "person-ted", "one person, however the export spelled him");
  }
});

test("我 is unknown in any other conversation, and unknown when nobody says which", () => {
  assert.equal(resolveSpeaker(ME_DIGEST, FAMILY_REGISTRY, { conversationId: MAIN_GROUP }).known, false);
  assert.equal(resolveSpeaker(ME_DIGEST, FAMILY_REGISTRY, { conversationId: "conversation:some-other-export" }).known, false);
  assert.equal(resolveSpeaker(ME_DIGEST, FAMILY_REGISTRY).known, false, "a caller that does not scope gets nothing, never the mapping by default");
});

test("an unscoped mapping still resolves everywhere", () => {
  // Ted's own display name is Ted in every export that contains him; only 我 is file-relative.
  const ted = senderDigestForDisplayName("Ted");
  assert.equal(resolveSpeaker(ted, FAMILY_REGISTRY).narrativeLabel, "爸爸");
  assert.equal(resolveSpeaker(ted, FAMILY_REGISTRY, { conversationId: MAIN_GROUP }).narrativeLabel, "爸爸");
});

test("the father's two digests count as one speaker, not two witnesses", () => {
  const both = [senderDigestForDisplayName("Ted"), ME_DIGEST];
  assert.equal(distinctSpeakerCount(both, FAMILY_REGISTRY), 2, "unscoped call cannot see 我, so it stays its own unknown");
  const keys = new Set(both.map((d) => resolveSpeaker(d, FAMILY_REGISTRY, { conversationId: MOTHER_CHAT }).speakerKey));
  assert.equal(keys.size, 1, "inside the confirmed conversation they are one canonical person");
});

// Teddy confirmed both of these on 2026-09-12. The point of the test is not that they resolve — it
// is that the recorded fact and the spoken word stay apart, and that the mapping does not escape the
// two daycare groups it was confirmed in. A digest is a hash of a display name, so an unscoped entry
// would name any 大兵 in any export the family ever adds.
test("大兵 is recorded as the daycare's director but is only ever called 大兵老师", async () => {
  const { FAMILY_REGISTRY, relationshipForSender } = await import("../lib/organizer/family-registry.ts");
  const { DAYCARE_CONVERSATION } = await import("../lib/organizer/subject-gate.ts");
  const digest = senderDigestForDisplayName("大兵");

  const inClass = resolveSpeaker(digest, FAMILY_REGISTRY, { conversationId: DAYCARE_CONVERSATION });
  assert.equal(inClass.known, true);
  assert.equal(displayLabelFor(inClass), "大兵老师");
  assert.equal(inClass.relationshipToSubject, "teacher", "his reports from the daycare are firsthand observation");
  assert.equal(relationshipForSender(digest), "teacher");

  // The title is a fact about him, not a word any story may use.
  const everyLabel = FAMILY_REGISTRY.participants.map((p) => p.narrativeLabel ?? "");
  assert.ok(!everyLabel.some((l) => l.includes("园长")), "园长 must never be a narrative label");

  // He is himself, not the institution: a class account and 大兵 are two witnesses, not one.
  const nursery = resolveSpeaker(senderDigestForDisplayName("好奇星辰星班"), FAMILY_REGISTRY, { conversationId: DAYCARE_CONVERSATION });
  assert.equal(nursery.canonicalPersonId, "person-nursery");
  assert.equal(inClass.canonicalPersonId, "person-dabing");
  assert.notEqual(inClass.canonicalPersonId, nursery.canonicalPersonId);

  // Scoped: the same digest outside the two daycare groups is nobody.
  const elsewhere = resolveSpeaker(digest, FAMILY_REGISTRY, { conversationId: "conversation:0567a44e538fc41f22b57097" });
  assert.equal(elsewhere.known, false, "the parents' private chat is not where this was confirmed");
  assert.equal(displayLabelFor(elsewhere), UNKNOWN_SPEAKER_LABEL);
  assert.equal(resolveSpeaker(digest, FAMILY_REGISTRY).known, false, "a caller that does not say where it is gets nothing");

  // The JSON conversation this round's import creates must already be in scope, or its rows arrive unnamed.
  const inSmallGroupJson = resolveSpeaker(digest, FAMILY_REGISTRY, { conversationId: "conversation:87c42fdc94895ff6b94222da" });
  assert.equal(displayLabelFor(inSmallGroupJson), "大兵老师");
});

test("吴艳 is a caregiver, never a medical role, and only in 张小年小群", async () => {
  const { FAMILY_REGISTRY, relationshipForSender } = await import("../lib/organizer/family-registry.ts");
  const { DAYCARE_CONVERSATION } = await import("../lib/organizer/subject-gate.ts");
  const digest = senderDigestForDisplayName("吴艳");

  const inSmallGroup = resolveSpeaker(digest, FAMILY_REGISTRY, { conversationId: "conversation:87c42fdc94895ff6b94222da" });
  assert.equal(inSmallGroup.known, true);
  assert.equal(displayLabelFor(inSmallGroup), "吴艳");
  assert.equal(inSmallGroup.relationshipToSubject, "caregiver");
  assert.equal(relationshipForSender(digest), "caregiver");
  for (const banned of ["nurse", "doctor", "clinician", "medical", "hospital"]) {
    assert.notEqual(inSmallGroup.relationshipToSubject, banned);
  }

  // She does not speak in the class group, so she is not mapped there.
  assert.equal(resolveSpeaker(digest, FAMILY_REGISTRY, { conversationId: DAYCARE_CONVERSATION }).known, false);
  assert.equal(resolveSpeaker(digest, FAMILY_REGISTRY).known, false);

  // The @-mention spelling is text inside someone else's message, never a sender, so it maps to nobody.
  assert.equal(resolveSpeaker(senderDigestForDisplayName("好奇星·安小苗｜吴艳"), FAMILY_REGISTRY,
    { conversationId: "conversation:87c42fdc94895ff6b94222da" }).known, false);
});
