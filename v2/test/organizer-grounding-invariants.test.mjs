import test from "node:test";
import assert from "node:assert/strict";
import { groundClaims } from "../lib/organizer/claim-grounding.ts";
import { routeV5 } from "../lib/organizer/worthiness-v5.ts";
import { createV6RoutingPolicy } from "../lib/organizer/routing-policies.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { senderDigestForDisplayName } from "../lib/organizer/identity.ts";

// The structural invariants Claim Grounding must satisfy, as opposed to the individual language
// cases in organizer-claim-grounding.test.mjs. The load-bearing one is monotonicity: grounding is a
// filter on what may justify a Memory, so it must only ever take promotions away. A grounding layer
// that could CREATE a promotion would be inventing worthiness rather than verifying it.

const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };

const DIGEST_DAD = senderDigestForDisplayName("Ted");
const DIGEST_MUM = senderDigestForDisplayName("阿静");
const DIGEST_NANNY = senderDigestForDisplayName("hxx\\.");
const DIGEST_UNKNOWN = "unknown-participant-digest";

let seq = 0;
function item(text, opts = {}) {
  seq += 1;
  const id = `item:${String(seq).padStart(24, "0")}`;
  const parts = text.split(/(?<=[。！？!?\n])/u).filter((p) => p.trim());
  const spans = [];
  let cursor = 0;
  (parts.length ? parts : [text]).forEach((part, index) => {
    spans.push({ id: `span-${index}`, start: cursor, end: cursor + part.length });
    cursor += part.length;
  });
  return {
    itemId: id, sourceId: opts.sourceId ?? `src-${seq}`, sentAt: "2026-03-01T10:00:00.000Z",
    senderRole: opts.senderRole ?? "speaker-a", senderDigest: opts.senderDigest ?? DIGEST_MUM,
    text, contentTypes: opts.contentTypes ?? ["daily"], mediaRefs: opts.mediaRefs ?? [],
    locator: { document: "d", recordOrdinal: seq }, spans, tier: opts.tier ?? "firsthand_observation",
  };
}
function windowOf(items, extra = {}) {
  return {
    windowId: "window:test", conversationId: "conversation:test", profileId: "profile-zhangnian",
    activityDate: "2026-03-01", timeRange: { from: "2026-03-01T10:00:00.000Z", to: "2026-03-01T11:00:00.000Z" },
    items, mediaBindings: extra.mediaBindings ?? [], neighbors: extra.neighbors ?? { before: [], after: [] },
    priorContext: { dailyTraces: [], lifeEvents: [] },
    stats: { messageCount: items.length, imageCount: extra.imageCount ?? 0, senderCount: new Set(items.map((i) => i.senderDigest)).size, droppedCount: 0 },
  };
}
const ref = (it, n = 0) => `${it.itemId}#span-${n}`;

const AXIS_ZERO = {
  developmentalTransition: { score: 0, basis: "unknown", evidenceRefs: [] },
  newCapabilityOrIndependence: { score: 0, kind: "none", evidenceRefs: [] },
  distinctiveFamilyMoment: { score: 0, evidenceRefs: [] },
  relationshipSignificance: { score: 0, evidenceRefs: [] },
  futureRecallValue: { score: 0, evidenceRefs: [] },
  noDistinctiveMemorySignal: false,
};

function verdictOf(coreFacts, axis) {
  return {
    windowId: "window:test", subjectRelevance: "primary", subjectIds: [], temporalStatus: "past",
    occurredAtProposal: { value: "2026-03-01", basis: "sent_at", evidenceRefs: [] },
    coreFacts, quotableLines: [], worthinessDimensions: {}, duplicateCandidates: [],
    uncertainty: { time: "low", subject: "low", semantics: "low" }, sensitivityFlags: [],
    prohibitedInferences: [], proposedAction: "life_event_candidate", selectionReason: "t", confidence: 0.9,
    worthinessAxis: axis,
  };
}

const isMemory = (action) => (action === "life_event_candidate" ? 1 : 0);

// ------------------------------------------------------------------ monotonicity

// A sweep, not a handful of examples: every combination of claim language x cited dimension x score
// is routed through v5 (ungrounded) and v6 (grounded) with everything else held identical, and v6
// must never be the one that promotes.
const CLAIM_TEXTS = [
  ["asserted capability", "小年会自己站了。"],
  ["question", "小年会自己站了？"],
  ["A-not-A question", "小年是不是会自己站了"],
  ["confirmation tag", "小年会自己站了对吧"],
  ["suggestion with 吧", "还是打疫苗吧"],
  ["negation", "小年不会自主入睡。"],
  ["not-yet", "小年还不会自己站。"],
  ["plan", "明天带小年去打疫苗。"],
  ["hypothetical", "如果小年会自己站就好了。"],
  ["embedded question", "睁开眼睛看一下你有没有哄他。"],
  ["backchannel only", "真的"],
  ["no subject reference", "今天天气很好。"],
  ["pronoun with antecedent", "他今天自己站起来了。"],
];
const DIMENSIONS = [
  ["developmentalTransition", (score, refs) => ({ developmentalTransition: { score, basis: "observed_change", evidenceRefs: refs } })],
  ["newCapabilityOrIndependence", (score, refs) => ({ newCapabilityOrIndependence: { score, kind: "developmental_ability", evidenceRefs: refs } })],
  ["distinctiveFamilyMoment", (score, refs) => ({ distinctiveFamilyMoment: { score, evidenceRefs: refs } })],
  ["relationshipSignificance", (score, refs) => ({ relationshipSignificance: { score, evidenceRefs: refs } })],
  ["futureRecallValue", (score, refs) => ({ futureRecallValue: { score, evidenceRefs: refs } })],
];

test("INVARIANT: grounding never creates a Memory promotion — same or demote, never upgrade", () => {
  let compared = 0, demotions = 0;
  for (const [label, text] of CLAIM_TEXTS) {
    for (const [dimName, build] of DIMENSIONS) {
      for (const score of [1, 2, 3]) {
        // A named antecedent so pronoun cases can resolve; no competing person anywhere.
        const anchor = item("今天小年在家。", { senderDigest: DIGEST_DAD });
        const claimItem = item(text, { senderDigest: DIGEST_MUM });
        const window = windowOf([anchor, claimItem]);
        const refs = [ref(claimItem)];
        const axis = { ...AXIS_ZERO, ...build(score, refs) };
        const verdict = verdictOf([{ statement: "小年会自己站了", assertionKind: "raw_fact", evidenceRefs: refs }], axis);
        const grounding = groundClaims(window, verdict, SUBJECT, OPTS);

        const shared = {
          evidence: { evidenceConfidence: "medium", evidenceRefs: [] },
          subjectResolution: "explicit",
          subjectRelevance: "primary",
          temporalStatus: "past",
        };
        // v5: ungrounded axis, ungrounded fact count — the pre-grounding behaviour.
        const v5 = routeV5({ ...shared, worthiness: axis, rawFactCount: 1 });
        // v6: identical inputs, grounded.
        const v6 = createV6RoutingPolicy(() => ({ worthiness: axis, evidence: shared.evidence, subjectResolution: "explicit", grounding }))
          .decide({ window, verdict });

        assert.ok(isMemory(v6.action) <= isMemory(v5.action),
          `${label} / ${dimName}@${score}: grounding promoted where v5 did not (v5=${v5.action}, v6=${v6.action})`);
        compared += 1;
        if (isMemory(v5.action) === 1 && isMemory(v6.action) === 0) demotions += 1;
      }
    }
  }
  assert.equal(compared, CLAIM_TEXTS.length * DIMENSIONS.length * 3);
  assert.ok(demotions > 0, "the sweep must actually exercise demotions, or it proves nothing");
});

test("INVARIANT: grounding never invents a source id or an evidence ref outside the window", () => {
  const anchor = item("今天小年在家。", { senderDigest: DIGEST_DAD });
  const claimItem = item("小年会自己站了。", { senderDigest: DIGEST_MUM });
  const window = windowOf([anchor, claimItem]);
  const windowSourceIds = new Set(window.items.map((i) => i.sourceId));
  const windowRefs = new Set(window.items.flatMap((i) => i.spans.map((s) => `${i.itemId}#${s.id}`)));

  const verdict = verdictOf(
    [{ statement: "小年会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(claimItem), "item:does-not-exist#span-0"] }],
    { ...AXIS_ZERO, newCapabilityOrIndependence: { score: 3, kind: "developmental_ability", evidenceRefs: [ref(claimItem), "item:nope#span-9"] } },
  );
  const grounding = groundClaims(window, verdict, SUBJECT, OPTS);

  for (const claim of grounding.claims) {
    for (const id of claim.sourceIds) assert.ok(windowSourceIds.has(id), `invented sourceId ${id}`);
    for (const span of claim.supportingSpans) {
      assert.ok(windowRefs.has(span.ref), `invented evidence ref ${span.ref}`);
      assert.ok(windowSourceIds.has(span.sourceId), `invented span sourceId ${span.sourceId}`);
    }
  }
  for (const [refKey, entry] of grounding.refGrounding) {
    assert.ok(windowRefs.has(refKey), `refGrounding carries a ref outside the window: ${refKey}`);
    assert.ok(windowSourceIds.has(entry.span.sourceId));
  }
  assert.ok(!grounding.refGrounding.has("item:nope#span-9"), "an unresolvable dimension ref must not be grounded");
});

// ------------------------------------------------------------------ media

test("a media-only span carries no proposition and can never ground a developmental signal", () => {
  // A photo message: the exporter writes a bracketed token and no language.
  const photo = item("[图片]", { senderDigest: DIGEST_NANNY, contentTypes: ["photo"], mediaRefs: ["media-1"] });
  const window = windowOf([photo], { imageCount: 1, mediaBindings: [{ mediaId: "media-1", boundItemId: photo.itemId, confidence: 0.4 }] });
  const verdict = verdictOf(
    [{ statement: "小年第一次自己站起来了", assertionKind: "raw_fact", evidenceRefs: [ref(photo)] }],
    { ...AXIS_ZERO, newCapabilityOrIndependence: { score: 3, kind: "developmental_ability", evidenceRefs: [ref(photo)] } },
  );
  const grounding = groundClaims(window, verdict, SUBJECT, OPTS);

  const claim = grounding.claims[0];
  assert.equal(claim.supportingSpans[0].contentBearing, false, "a sticker/media token is stripped to nothing and bears no content");
  assert.equal(claim.assertionStatus, "unsupported");
  assert.equal(claim.mayGroundDevelopmentalSignal, false, "a photo alone must never establish an ability");
  assert.equal(grounding.promotableGroundedFactCount, 0);
  assert.equal(grounding.traceEvidenceCount, 0, "and it cannot evidence a trace claim either");
});

// ------------------------------------------------------------------ speakers

test("multi-caregiver discussion: each claim keeps its own speaker identity and relationship", () => {
  const mum = item("小年今天自己站起来了。", { senderDigest: DIGEST_MUM });
  const nanny = item("小年下午又站了一次。", { senderDigest: DIGEST_NANNY });
  const dad = item("小年晚上还想站。", { senderDigest: DIGEST_DAD });
  const window = windowOf([mum, nanny, dad]);
  const verdict = verdictOf([
    { statement: "小年自己站起来了", assertionKind: "raw_fact", evidenceRefs: [ref(mum)] },
    { statement: "小年下午又站了一次", assertionKind: "raw_fact", evidenceRefs: [ref(nanny)] },
    { statement: "小年晚上还想站", assertionKind: "raw_fact", evidenceRefs: [ref(dad)] },
  ], AXIS_ZERO);
  const grounding = groundClaims(window, verdict, SUBJECT, OPTS);

  const rels = grounding.claims.map((c) => c.supportingSpans[0].speaker.relationshipToSubject);
  assert.deepEqual(rels, ["mother", "nanny", "father"], "each claim must carry its OWN speaker, not the window's");
  const persons = grounding.claims.map((c) => c.speakers[0].canonicalPersonId);
  assert.deepEqual(persons, ["person-sujing", "person-xueyi", "person-ted"]);
  for (const claim of grounding.claims) {
    assert.equal(claim.observationMode, "observed_firsthand", "a verified caregiver reporting in the window is a firsthand observer");
    assert.equal(claim.subject.resolved, true);
  }
  assert.equal(grounding.promotableGroundedFactCount, 3);
});

test("an unknown speaker stays unknown and is never upgraded to a firsthand family observer", () => {
  const stranger = item("小年今天自己站起来了。", { senderDigest: DIGEST_UNKNOWN });
  const window = windowOf([stranger]);
  const verdict = verdictOf([{ statement: "小年自己站起来了", assertionKind: "raw_fact", evidenceRefs: [ref(stranger)] }], AXIS_ZERO);
  const grounding = groundClaims(window, verdict, SUBJECT, OPTS);

  const span = grounding.claims[0].supportingSpans[0];
  assert.equal(span.speaker.known, false);
  assert.equal(span.speaker.relationshipToSubject, undefined);
  assert.equal(span.speaker.canonicalPersonId, undefined);
  assert.equal(grounding.claims[0].observationMode, "reported", "no verified relationship means reported, not firsthand");
});

test("an attributed_claim is reported even when a verified caregiver said it", () => {
  const mum = item("听说小年会自己站了。", { senderDigest: DIGEST_MUM });
  const window = windowOf([mum]);
  const verdict = verdictOf([{ statement: "小年会自己站了", assertionKind: "attributed_claim", claimant: "来源", evidenceRefs: [ref(mum)] }], AXIS_ZERO);
  const grounding = groundClaims(window, verdict, SUBJECT, OPTS);
  assert.equal(grounding.claims[0].observationMode, "reported");
  assert.equal(grounding.promotableGroundedFactCount, 0, "only a raw_fact counts toward promotion material");
});

// ------------------------------------------------------------------ determinism

test("grounding is deterministic: the same window and verdict ground identically every time", () => {
  const anchor = item("今天小年在家。", { senderDigest: DIGEST_DAD });
  const claimItem = item("他今天自己站起来了。", { senderDigest: DIGEST_MUM });
  const window = windowOf([anchor, claimItem]);
  const verdict = verdictOf([{ statement: "小年自己站起来了", assertionKind: "raw_fact", evidenceRefs: [ref(claimItem)] }], AXIS_ZERO);

  const a = groundClaims(window, verdict, SUBJECT, OPTS);
  const b = groundClaims(window, verdict, SUBJECT, OPTS);
  const strip = (g) => JSON.stringify({ ...g, refGrounding: [...g.refGrounding.entries()] });
  assert.equal(strip(a), strip(b));
  assert.equal(a.version, "claim-grounding-v1");
});
