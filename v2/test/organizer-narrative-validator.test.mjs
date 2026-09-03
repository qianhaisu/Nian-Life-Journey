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

// ---------------------------------------------------------------- hardening 2026-09-03 (Phase C)

const innerClaim = { claimId: "claim-3", text: "小年想回杭州雪姨身边", assertionStatus: "supported_assertion", polarity: "affirmative", observationMode: "reported", subjectResolved: true, subjectBasis: "explicit_in_span", speakers: [person("雪姨", "d-nanny")], sourceIds: ["src-4"], evidenceRefs: ["i4#s0"], spans: [{ ref: "i4#s0", text: "张小年想回到杭州，雪姨身边了" }], assertable: true };

// Decision 3: an inner state is always somebody's reading of the child. The exact shape the first
// shadow produced — 「张小年想回到杭州雪姨身边。」 — with the attribution dropped.
test("an inner state stated as flat fact is rejected; the attributed form passes", () => {
  const flat = validateNarrative({ pkg: pkg({ claims: [...pkg().claims, innerClaim] }), output: out({
    title: "想回杭州的一天", story: "张小年想回到杭州雪姨身边。他现在不扶着也能站几秒。",
    narrativeClaims: [{ text: "张小年想回到杭州雪姨身边", supportedByClaimIds: ["claim-3"], supportedBySourceIds: ["src-4"] }, { text: "他现在不扶着也能站几秒", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }],
    usedClaimIds: ["claim-3", "claim-0"],
  }) });
  assert.ok(codes(flat).includes("inner_state_stated_as_fact"), codes(flat).join(","));

  const attributed = validateNarrative({ pkg: pkg({ claims: [...pkg().claims, innerClaim] }), output: out({
    title: "雪姨觉得他想回杭州了", story: "雪姨说，张小年想回到杭州她身边了。这天他不扶着也能站上几秒。",
    narrativeClaims: [{ text: "雪姨说张小年想回到杭州她身边", supportedByClaimIds: ["claim-3"], supportedBySourceIds: ["src-4"] }, { text: "他不扶着也能站几秒", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }],
    usedClaimIds: ["claim-3", "claim-0"],
  }) });
  assert.equal(attributed.ok, true, JSON.stringify(attributed.issues));

  for (const flatSentence of ["他太爱妈妈了", "他不喜欢戴帽子", "他饿了，一直哭", "他很开心"]) {
    const one = validateNarrative({ pkg: pkg(), output: out({ story: `他现在不扶着也能站几秒。${flatSentence}。` }) });
    assert.ok(codes(one).includes("inner_state_stated_as_fact"), `${flatSentence} -> ${codes(one).join(",")}`);
  }
  // Observable actions and 可爱 must not trip it.
  const action = validateNarrative({ pkg: pkg(), output: out({ story: "他现在不扶着也能站几秒，站起来的时候特别可爱，妈妈追着问了好几句。" }) });
  assert.equal(action.ok, true, JSON.stringify(action.issues));
});

test("an attribution must be supported by material that person actually produced", () => {
  // claim-0 was said by 雪姨. Putting it in 妈妈's mouth is invention with a name on it.
  const r = validateNarrative({ pkg: pkg(), output: out({
    story: "妈妈发现他现在不扶着也能站几秒，站得还挺稳当的。",
    narrativeClaims: [{ text: "妈妈发现他现在不扶着也能站几秒", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }],
  }) });
  assert.ok(codes(r).includes("misattributed_speaker"), codes(r).join(","));

  const right = validateNarrative({ pkg: pkg(), output: out({
    story: "雪姨发现他现在不扶着也能站几秒，站得还挺稳当的。",
    narrativeClaims: [{ text: "雪姨发现他现在不扶着也能站几秒", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }],
  }) });
  assert.equal(right.ok, true, JSON.stringify(right.issues));
});

test("a verbatim quote may not launder an unresolved-subject or hypothetical line onto the page", () => {
  const laundered = pkg({
    claims: [...pkg().claims, { claimId: "claim-4", text: "他已经学会欢迎欢迎", assertionStatus: "supported_assertion", polarity: "affirmative", observationMode: "reported", subjectResolved: false, subjectBasis: "unresolved_no_antecedent", speakers: [person("妈妈", "d-mum")], sourceIds: ["src-5"], evidenceRefs: ["i5#s0"], spans: [{ ref: "i5#s0", text: "他已经学会欢迎欢迎了" }], assertable: false }],
    quotes: [...pkg().quotes, { quoteId: "quote-1", text: "他已经学会欢迎欢迎了", speaker: person("妈妈", "d-mum"), sourceId: "src-5", evidenceRef: "i5#s0" }],
  });
  const r = validateNarrative({ pkg: laundered, output: out({
    story: "他现在不扶着也能站几秒。妈妈说「他已经学会欢迎欢迎了」。",
    usedQuoteIds: ["quote-1"],
  }) });
  const c = codes(r);
  assert.ok(c.includes("unsupported_quote"), c.join(","));
  assert.ok(c.includes("quote_from_unassertable_material"), c.join(","));

  // The same quote from an assertable line is fine.
  const fine = validateNarrative({ pkg: pkg(), output: out({ story: "雪姨说「他现在不扶着站都能站个几秒」，妈妈追着问了几句细节。", usedQuoteIds: ["quote-0"] }) });
  assert.equal(fine.ok, true, JSON.stringify(fine.issues));
});

test("a claim resolved to someone other than 张年 can never support a sentence", () => {
  const other = pkg({ claims: [{ ...pkg().claims[0], subjectId: "person-cousin" }] });
  const r = validateNarrative({ pkg: other, output: out() });
  assert.ok(codes(r).includes("narrative_claim_cites_other_subject"), codes(r).join(","));
  assert.equal(isAssertable({ assertionStatus: "supported_assertion", subject: { resolved: true, subjectId: "person-cousin" } }, "profile-zhangnian"), false);
  assert.equal(isAssertable({ assertionStatus: "supported_assertion", subject: { resolved: true, subjectId: "profile-zhangnian" } }, "profile-zhangnian"), true);
});

test("a plan cited as support is rejected even when the story frames it", () => {
  const planned = pkg({ claims: [...pkg().claims, { claimId: "claim-5", text: "周末带小年去打疫苗", assertionStatus: "plan_or_hypothetical", polarity: "affirmative", observationMode: "reported", subjectResolved: true, subjectBasis: "explicit_in_span", speakers: [person("妈妈", "d-mum")], sourceIds: ["src-6"], evidenceRefs: ["i6#s0"], spans: [{ ref: "i6#s0", text: "周末带他去打疫苗吧" }], assertable: false }] });
  const r = validateNarrative({ pkg: planned, output: out({
    story: "他现在不扶着也能站几秒。周末去打了疫苗。",
    narrativeClaims: [{ text: "他现在不扶着也能站几秒", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }, { text: "周末去打了疫苗", supportedByClaimIds: ["claim-5"], supportedBySourceIds: ["src-6"] }],
  }) });
  assert.ok(codes(r).includes("narrative_claim_cites_plan_or_hypothetical"), codes(r).join(","));
});

test("a before/after contrast needs both halves evidenced", () => {
  const oneFact = validateNarrative({ pkg: pkg(), output: out({
    story: "从以前扶着都站不住，到现在不扶着也能站几秒，雪姨看着他站稳。",
    narrativeClaims: [{ text: "从以前扶着都站不住，到现在不扶着也能站几秒", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }],
  }) });
  assert.ok(codes(oneFact).includes("unsupported_longitudinal_contrast"), codes(oneFact).join(","));

  const withBaseline = validateNarrative({ pkg: pkg({ longitudinal: [{ contextId: "ctx-0", kind: "earlier_capability_baseline", text: "扶着沙发能站一下", lifeDate: "2025-08-20", sourceIds: ["src-0"], assertable: false }] }), output: out({
    story: "从以前扶着都站不住，到现在不扶着也能站几秒，雪姨看着他站稳。",
    narrativeClaims: [{ text: "从以前扶着都站不住，到现在不扶着也能站几秒", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }],
  }) });
  assert.equal(withBaseline.ok, true, JSON.stringify(withBaseline.issues));

  // 从 on its own is ordinary Chinese, not a contrast.
  const plain = validateNarrative({ pkg: pkg(), output: out({ story: "他从沙发边站起来，不扶着也能站几秒，雪姨在旁边看着。" }) });
  assert.equal(plain.ok, true, JSON.stringify(plain.issues));
});

test("a story dated to a day the package does not cover is rejected", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({ story: "8月3日那天他现在不扶着也能站几秒，雪姨看着他站稳。" }) });
  assert.ok(codes(r).includes("unsupported_time_statement"), codes(r).join(","));
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

// ---- v2.2: what the calibration round 3 shadow taught the validator

test("v2.2: the family's 「你」 may not be resolved into a named person", () => {
  const p = pkg({
    claims: [
      { claimId: "claim-0", text: "家人说小年太爱对方了", assertionStatus: "supported_assertion", polarity: "affirmative", observationMode: "reported", subjectResolved: true, subjectBasis: "antecedent_in_neighbour", subjectId: "profile-zhangnian", speakers: [person("妈妈", "d-mum")], sourceIds: ["src-1"], evidenceRefs: ["i1#s0"], spans: [{ ref: "i1#s0", text: "哈哈，他太爱你了" }], assertable: true },
    ],
    quotes: [{ quoteId: "quote-0", text: "哈哈，他太爱你了", speaker: person("妈妈", "d-mum"), sourceId: "src-1", evidenceRef: "i1#s0" }],
  });
  const bad = validateNarrative({ pkg: p, output: out({
    title: "妈妈说他太爱妈妈了", story: "妈妈笑着说，他太爱妈妈了。",
    narrativeClaims: [{ text: "妈妈笑着说，他太爱妈妈了", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }],
  }) });
  assert.ok(codes(bad).includes("second_person_resolved_to_person"), codes(bad).join(","));
  const alsoBad = validateNarrative({ pkg: p, output: out({
    title: "妈妈说他太爱雪姨了", story: "妈妈笑着说，他太爱雪姨了。",
    narrativeClaims: [{ text: "妈妈笑着说，他太爱雪姨了", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }],
  }) });
  assert.ok(codes(alsoBad).includes("second_person_resolved_to_person"), codes(alsoBad).join(","));
  const fine = validateNarrative({ pkg: p, output: out({
    title: "妈妈笑着说他太黏人", story: "妈妈笑着说了一句「哈哈，他太爱你了」。",
    narrativeClaims: [{ text: "妈妈笑着说了一句「哈哈，他太爱你了」", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"], supportedByQuoteIds: ["quote-0"] }],
    usedQuoteIds: ["quote-0"],
  }) });
  assert.equal(fine.ok, true, JSON.stringify(fine.issues));
  // When the line itself names the person, the page may too.
  const named = validateNarrative({ pkg: pkg({
    claims: [{ ...p.claims[0], spans: [{ ref: "i1#s0", text: "哈哈，他太爱雪姨了" }] }],
    quotes: [],
  }), output: out({
    title: "妈妈说他太爱雪姨了", story: "妈妈笑着说，他太爱雪姨了。",
    narrativeClaims: [{ text: "妈妈笑着说，他太爱雪姨了", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }],
  }) });
  assert.equal(named.ok, true, JSON.stringify(named.issues));
});

test("v2.2: the person spoken to is not a speaker", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({
    title: "站着的时候挺稳当", story: "雪姨跟妈妈聊起他，说他现在不扶着也能站几秒。",
    narrativeClaims: [{ text: "雪姨跟妈妈聊起他，说他现在不扶着也能站几秒", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }],
  }) });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  const still = validateNarrative({ pkg: pkg(), output: out({
    title: "站着的时候挺稳当", story: "妈妈说他现在不扶着也能站几秒。",
    narrativeClaims: [{ text: "妈妈说他现在不扶着也能站几秒", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }],
  }) });
  assert.ok(codes(still).includes("misattributed_speaker"), codes(still).join(","));
});

test("v2.2: a line that names the child by name is quotable even without a claim of its own", () => {
  const p = pkg({
    quotes: [
      { quoteId: "quote-0", text: "他现在不扶着站都能站个几秒", speaker: person("雪姨", "d-nanny"), sourceId: "src-1", evidenceRef: "i1#s0" },
      { quoteId: "quote-1", text: "我小年是爱国的", speaker: person("妈妈", "d-mum"), sourceId: "src-7", evidenceRef: "i7#s0" },
      { quoteId: "quote-2", text: "\[链接\]小年宝宝从床上掉下去", speaker: person("妈妈", "d-mum"), sourceId: "src-8", evidenceRef: "i8#s0" },
      { quoteId: "quote-3", text: "宝宝真棒", speaker: person("妈妈", "d-mum"), sourceId: "src-9", evidenceRef: "i9#s0" },
    ],
  });
  const named = validateNarrative({ pkg: p, output: out({
    story: "雪姨说他现在不扶着也能站上几秒，妈妈接了一句「我小年是爱国的」。",
    narrativeClaims: [{ text: "雪姨说他现在不扶着也能站上几秒，妈妈接了一句「我小年是爱国的」", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"], supportedByQuoteIds: ["quote-1"] }],
    usedQuoteIds: ["quote-1"],
  }) });
  assert.equal(named.ok, true, JSON.stringify(named.issues));
  const link = validateNarrative({ pkg: p, output: out({ usedQuoteIds: ["quote-2"] }) });
  assert.ok(codes(link).includes("quote_from_unassertable_material"), codes(link).join(","));
  const generic = validateNarrative({ pkg: p, output: out({ usedQuoteIds: ["quote-3"] }) });
  assert.ok(codes(generic).includes("quote_from_unassertable_material"), codes(generic).join(","));
});

test("v2.2: a title may reappear as the family's own quoted words", () => {
  const ok = validateNarrative({ pkg: pkg(), output: out({
    title: "不扶着站都能站个几秒", story: "雪姨说他「他现在不扶着站都能站个几秒」，妈妈问了好几遍细节。",
    usedQuoteIds: ["quote-0"],
  }) });
  assert.equal(ok.ok, true, JSON.stringify(ok.issues));
  const repeated = validateNarrative({ pkg: pkg(), output: out({
    title: "不扶着也能站几秒", story: "雪姨说他现在不扶着也能站几秒。妈妈问了好几遍细节。",
  }) });
  assert.ok(codes(repeated).includes("title_repeated_in_story"), codes(repeated).join(","));
});

test("v2.2: an inner state in the title alone is still an inner state stated as fact", () => {
  const r = validateNarrative({ pkg: pkg(), output: out({ title: "想回雪姨身边了", story: "妈妈觉得他想回到雪姨身边了。雪姨说他现在不扶着也能站上几秒。" }) });
  assert.ok(codes(r).includes("inner_state_stated_as_fact"), codes(r).join(","));
});

test("v2.3: a stage direction the evidence does not show is rejected; an evidenced one passes", () => {
  const looking = validateNarrative({ pkg: pkg(), output: out({
    story: "雪姨看着他，说他现在不扶着也能站上几秒。",
    narrativeClaims: [{ text: "雪姨看着他，说他现在不扶着也能站上几秒", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }],
  }) });
  assert.ok(codes(looking).includes("unsupported_stage_direction"), JSON.stringify(looking.issues));

  const laughing = validateNarrative({ pkg: pkg({ claims: [{ ...pkg().claims[0], spans: [{ ref: "i1#s0", text: "哈哈哈他现在不扶着站都能站个几秒" }] }] }), output: out({
    story: "雪姨笑着说他现在不扶着也能站上几秒。",
    narrativeClaims: [{ text: "雪姨笑着说他现在不扶着也能站上几秒", supportedByClaimIds: ["claim-0"], supportedBySourceIds: ["src-1"] }],
  }) });
  assert.equal(laughing.ok, true, JSON.stringify(laughing.issues));
});

test("v2.3: 觉得 / 新鲜 without a person is an inner state stated as fact", () => {
  const flat = validateNarrative({ pkg: pkg(), output: out({ title: "久违逛超市，觉得新鲜" }) });
  assert.ok(codes(flat).includes("inner_state_stated_as_fact"), JSON.stringify(flat.issues));
  const attributed = validateNarrative({ pkg: pkg(), output: out({ title: "雪姨说他逛超市觉得新鲜" }) });
  assert.ok(!codes(attributed).includes("inner_state_stated_as_fact"), JSON.stringify(attributed.issues));
});

test("v2.3: the prompt offers only quotes the validator will accept", async () => {
  const { buildWriterV2Prompt } = await import("../lib/organizer/writer-v2-prompt.ts");
  const p = pkg({ quotes: [
    ...pkg().quotes,
    { quoteId: "quote-plan", text: "明天开始换辅食时间", speaker: person("雪姨", "d-nanny"), sourceId: "src-7", evidenceRef: "i7#s0" },
  ] });
  const text = buildWriterV2Prompt(p);
  assert.ok(text.includes("[quote-0]"));
  assert.ok(!text.includes("[quote-plan]"), "a quote from unassertable material must not be on the menu");
  const r = validateNarrative({ pkg: p, output: out({ usedQuoteIds: ["quote-plan"] }) });
  assert.ok(codes(r).includes("quote_from_unassertable_material"));
});
