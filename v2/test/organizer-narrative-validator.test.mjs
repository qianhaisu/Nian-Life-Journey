import test from "node:test";
import assert from "node:assert/strict";
import { validateNarrative } from "../lib/organizer/narrative-validator.ts";
import { ageAt, isAssertable, mediaTierFor, mayIllustrateStory, packageHasAssertableMaterial } from "../lib/organizer/writer-v2.ts";

// The Narrative Validator is the deterministic gate between the Writer and 张年's archive. These
// tests are the failure taxonomy it exists to stop, each one written as the thing a fluent model
// would plausibly produce.

const person = (label, digest) => ({ speakerDigest: digest, known: true, canonicalPersonId: `person-${label}`, narrativeLabel: label, relationshipToSubject: "parent" });

function pkg(overrides = {}) {
  return {
    packageVersion: "verified-memory-evidence-package-v1",
    windowId: "window:test", windowFingerprint: "f".repeat(32),
    selectedBy: { policyId: "worthiness-v6-grounded", action: "life_event_candidate", worthinessScore: 61 },
    identity: {
      profileId: "profile-zhangnian",
      subject: { primaryName: "张年", aliases: ["小年"], narrativeLabel: "张年" },
      people: [person("妈妈", "d-mum"), person("雪姨", "d-nanny")],
    },
    time: { lifeDate: "2025-09-10", activityDate: "2025-09-10", occurredWindow: { from: "2025-09-10T07:00:00Z", to: "2025-09-10T08:00:00Z" }, ageAtEvent: "8 个月" },
    claims: [
      { claimId: "claim-0", text: "小年不扶着也能站几秒", assertionStatus: "supported_assertion", polarity: "affirmative", observationMode: "observed_firsthand", subjectResolved: true, subjectBasis: "explicit_in_span", speakers: [person("雪姨", "d-nanny")], sourceIds: ["src-1"], evidenceRefs: ["i1#s0"], spans: [{ ref: "i1#s0", text: "他现在不扶着站都能站个几秒" }], assertable: true },
      { claimId: "claim-1", text: "小年会自己走了", assertionStatus: "question", polarity: "affirmative", observationMode: "question", subjectResolved: true, subjectBasis: "explicit_in_span", speakers: [person("妈妈", "d-mum")], sourceIds: ["src-2"], evidenceRefs: ["i2#s0"], spans: [{ ref: "i2#s0", text: "他会自己走了？" }], assertable: false },
      { claimId: "claim-2", text: "小年还不会叫妈", assertionStatus: "supported_assertion", polarity: "negated", observationMode: "observed_firsthand", subjectResolved: true, subjectBasis: "explicit_in_span", speakers: [person("妈妈", "d-mum")], sourceIds: ["src-3"], evidenceRefs: ["i3#s0"], spans: [{ ref: "i3#s0", text: "但还不会叫妈" }], assertable: true },
    ],
    quotes: [{ quoteId: "quote-0", text: "他现在不扶着站都能站个几秒", speaker: person("雪姨", "d-nanny"), sourceId: "src-1", evidenceRef: "i1#s0" }],
    longitudinal: [],
    media: [
      { mediaId: "m-confirmed", tier: "confirmed", confidence: 0.95, boundItemId: "i1", boundSourceId: "src-1", contentDescribed: false },
      { mediaId: "m-sameday", tier: "day_level", confidence: 0.4, boundItemId: "i9", boundSourceId: "src-9", contentDescribed: false },
    ],
    ...overrides,
  };
}

function out(overrides = {}) {
  return {
    contractVersion: "writer-v2-output-contract-v1",
    insufficient: false,
    title: "不扶着也能站一会儿",
    story: "雪姨说他现在不扶着也能站上几秒。妈妈那天在群里问了好几遍细节，雪姨又补了一句他站得挺稳当的样子。",
    narrativeClaims: [{ text: "他现在不扶着也能站几秒", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }],
    usedClaimIds: ["claim-0"], usedQuoteIds: [], usedMediaIds: [],
    ...overrides,
  };
}

const codes = (r) => r.issues.map((i) => i.code);

test("a well-supported story passes", () => {
  const r = validateNarrative({ pkg: pkg(), output: out() });
  assert.equal(r.ok, true, `unexpected issues: ${JSON.stringify(r.issues)}`);
});

test("declining to write is a complete, valid answer", () => {
  const r = validateNarrative({ pkg: pkg(), output: { contractVersion: "writer-v2-output-contract-v1", insufficient: true, narrativeClaims: [], usedClaimIds: [], usedQuoteIds: [], usedMediaIds: [] } });
  assert.equal(r.ok, true);
});

test("a question may never support a stated fact", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({
    narrativeClaims: [{ text: "他已经会自己走了", supportedByClaimIds: ["claim-1"], supportedBySourceIds: ["src-2"] }],
    usedClaimIds: ["claim-1"],
  }) });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes("narrative_claim_cites_question"), codes(r).join(","));
});

test("a narrative claim with no support at all is rejected", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({
    narrativeClaims: [{ text: "那天下午阳光很好", supportedByClaimIds: [], supportedBySourceIds: [] }],
  }) });
  assert.ok(codes(r).includes("unsupported_narrative_claim"));
});

test("used evidence must be a subset of the package", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({ usedClaimIds: ["claim-0", "claim-99"], usedQuoteIds: ["quote-9"], usedMediaIds: ["m-nope"] }) });
  const c = codes(r);
  assert.ok(c.includes("used_claim_not_in_package"));
  assert.ok(c.includes("used_quote_not_in_package"));
  assert.ok(c.includes("used_media_not_in_package"));
});

test("a quote must appear verbatim in the evidence", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({ story: "雪姨说「他现在已经能自己站很久了」，大家都很高兴地看着他。" }) });
  assert.ok(codes(r).includes("unsupported_quote"), codes(r).join(","));
});

test("an invented milestone is rejected when the evidence never says it", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({ title: "第一次不扶着站起来", story: "他第一次不扶着站了起来，雪姨说他能站上好几秒钟，家里人都围过来看他。" }) });
  assert.ok(codes(r).includes("invented_milestone"), codes(r).join(","));
});

test("a not-yet state must not be written as an achievement", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({
    story: "他已经会叫妈妈了，这一天雪姨在群里说了好几遍，大家都觉得他长大了不少呢。",
    narrativeClaims: [{ text: "他已经会叫妈妈了", supportedByClaimIds: ["claim-2"], supportedBySourceIds: ["src-3"] }],
    usedClaimIds: ["claim-2"],
  }) });
  assert.ok(codes(r).includes("negated_state_written_as_achieved"), codes(r).join(","));
});

test("a person who is not in the package may not appear in the story", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({ story: "奶奶说他现在不扶着也能站上几秒，雪姨在旁边看着他，大家都觉得他稳当了不少。" }) });
  assert.ok(codes(r).includes("unsupported_person"), codes(r).join(","));
});

test("a same-day photo can never be the evidence for a sentence", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({
    narrativeClaims: [{ text: "他站着的样子被拍了下来", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"], supportedByMediaIds: ["m-sameday"] }],
    usedMediaIds: ["m-sameday"],
  }) });
  assert.ok(codes(r).includes("weak_media_used_as_event_evidence"), codes(r).join(","));
});

test("a confirmed-binding photo may support a sentence", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({
    narrativeClaims: [{ text: "他站着的样子被拍了下来", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"], supportedByMediaIds: ["m-confirmed"] }],
    usedMediaIds: ["m-confirmed"],
  }) });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("unsupported emotion, causality and clichés are rejected", () => {
  const emo = validateNarrative({ pkg: pkg(), output: out({ story: "他现在不扶着也能站几秒，他一定很开心，雪姨也在旁边看着他慢慢站稳了呢。" }) });
  assert.ok(codes(emo).includes("unsupported_emotional_inference"), codes(emo).join(","));

  const causal = validateNarrative({ pkg: pkg(), output: out({ story: "他现在不扶着也能站几秒，这标志着他真正长大了，雪姨在旁边一直看着他站稳。" }) });
  assert.ok(codes(causal).includes("unsupported_causal_link"), codes(causal).join(","));

  const cliche = validateNarrative({ pkg: pkg(), output: out({ story: "他现在不扶着也能站几秒，这一天值得被记住，雪姨在旁边看着他一点点站稳了。" }) });
  assert.ok(codes(cliche).includes("cliche"), codes(cliche).join(","));
});

// The exact string the first Writer v2 shadow produced. Asked to be careful about an unresolved
// subject, the model narrated the caution instead of omitting the material.
test("the pipeline's own reasoning must never reach the family", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({
    story: "妈妈提到，他现在不扶着也能站几秒。家里聊起他已经学会欢迎欢迎，但这句话说的是谁，没法确认。",
  }) });
  assert.ok(codes(r).includes("pipeline_reasoning_in_prose"), codes(r).join(","));

  for (const leak of ["证据不足，所以只写到这里。", "系统无法归属这句话。", "这条 claim 的置信度不高。"]) {
    const one = validateNarrative({ pkg: pkg(), output: out({ story: `他现在不扶着也能站几秒。${leak}` }) });
    assert.ok(codes(one).includes("pipeline_reasoning_in_prose"), `${leak} -> ${codes(one).join(",")}`);
  }
});

test("ordinary careful phrasing is not mistaken for pipeline language", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({
    story: "雪姨说他现在不扶着也能站上几秒，站得还挺稳，妈妈在群里追着问了好几句细节。",
  }) });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("there is no story-length floor — few facts may honestly mean a short page", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({ story: "他现在不扶着也能站几秒。" }) });
  assert.ok(!codes(r).some((c) => c.startsWith("story_too")), codes(r).join(","));
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

// ---------------------------------------------------------------- package helpers

test("assertability requires a supported assertion about a resolved subject, and ignores polarity", () => {
  assert.equal(isAssertable({ assertionStatus: "supported_assertion", subject: { resolved: true } }), true);
  assert.equal(isAssertable({ assertionStatus: "question", subject: { resolved: true } }), false);
  assert.equal(isAssertable({ assertionStatus: "supported_assertion", subject: { resolved: false } }), false);
});

test("media tiers: same-day is never enough to illustrate a story", () => {
  assert.equal(mediaTierFor(0.95, "i1"), "confirmed");
  assert.equal(mediaTierFor(0.8, "i1"), "strong_contextual");
  assert.equal(mediaTierFor(0.4, "i1"), "day_level");
  assert.equal(mediaTierFor(0.95, undefined), "unbound");
  assert.equal(mayIllustrateStory("confirmed"), true);
  assert.equal(mayIllustrateStory("strong_contextual"), true);
  assert.equal(mayIllustrateStory("day_level"), false);
  assert.equal(mayIllustrateStory("month_level"), false);
  assert.equal(mayIllustrateStory("unbound"), false);
});

test("age is expressed the way a family says it, and is absent when the birth date is not known", () => {
  assert.equal(ageAt("2025-01-15", "2026-08-22"), "1 岁 7 个月");
  assert.equal(ageAt("2025-01-15", "2025-09-10"), "7 个月");
  assert.equal(ageAt("2025-01-15", "2026-01-15"), "1 岁");
  assert.equal(ageAt(undefined, "2026-08-22"), undefined);
});

test("a package with nothing assertable must not be sent to the Writer", () => {
  const questionsOnly = pkg({ claims: [{ ...pkg().claims[1] }] });
  assert.equal(packageHasAssertableMaterial(questionsOnly), false);
  assert.equal(packageHasAssertableMaterial(pkg()), true);
});
