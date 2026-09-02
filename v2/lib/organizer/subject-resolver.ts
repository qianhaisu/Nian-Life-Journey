// Bounded Subject Resolver.
//
// Gate A used to ask one question — does a span in THIS window name the child — and refuse
// everything else. On real family chat that is too blunt: 「他现在好想站起来啊 / 各种扶墙站」 is a
// clear observation about the only child in the house, and it was refused three runs running, never
// on worth but always on subject.
//
// The fix is not "one child in the household, so 他 must be him". That reasoning would also promote
// every adult logistics message containing a pronoun, which is exactly the failure Gate A exists to
// prevent. A single-child household raises the prior and is never sufficient on its own.
//
// What actually ties a pronoun to a person is an ANTECEDENT. So `explicit_antecedent_nearby` is
// mandatory for contextual resolution: some message in the bounded neighbourhood must name the
// child. The other signals are corroboration — they guard against topic drift between the antecedent
// and this window — and a competing person anywhere in scope fails the whole thing closed.
//
// Every decision exposes the sourceIds it rests on, so a resolution can be audited after the fact
// rather than taken on trust.
import type { EvidenceWindow, EvidenceItem } from "./evidence/types";
import type { IdentityRegistry } from "./identity";
import { resolveSpeaker } from "./identity";

export type SubjectResolutionLevel = "explicit" | "contextually_resolved" | "unresolved";

export type SubjectResolution = {
  level: SubjectResolutionLevel;
  /** Signals that fired, for observability. Never a probability the model supplied. */
  signals: string[];
  /** Why resolution failed, when it did. */
  blockers: string[];
  /** Source ids the resolution rests on. An auditable trail, not a claim. */
  supportingSourceIds: string[];
};

// Anyone whose presence makes "他" genuinely ambiguous. A cousin, a classmate, another baby in the
// conversation — if one is in scope, no pronoun can be pinned to this child.
const COMPETING_PERSON = /其他小朋友|别的孩子|别的小朋友|另一个孩子|同学|哥哥|姐姐|弟弟|妹妹|双胞胎|同伴|小伙伴|表弟|表妹|堂弟|堂妹/;

// Care topics that only apply to an infant in this household. Their presence is what makes the
// discussion continuous with the antecedent rather than a change of subject.
const CHILD_CARE_TOPIC = /抱|喂|哄|睡|醒|尿不湿|纸尿裤|辅食|奶|爬|站|走|翻身|长牙|洗澡|推车|婴儿|宝宝|辅食|口水|安抚|奶嘴/;

const PRONOUN = /他|她|娃|崽/;

export type SubjectResolverOptions = {
  /** Raises the prior only. Can never resolve a pronoun by itself. */
  singleChildHousehold?: boolean;
  registry?: IdentityRegistry;
};

function namesSubject(text: string, names: string[]) {
  return names.some((name) => name && text.includes(name));
}

function verifiedCaregiverCount(items: EvidenceItem[], registry: IdentityRegistry | undefined): number {
  if (!registry) return 0;
  const people = new Set<string>();
  for (const item of items) {
    const speaker = resolveSpeaker(item.senderDigest, registry);
    if (speaker.known && speaker.relationshipToSubject) people.add(speaker.canonicalPersonId ?? speaker.senderDigest);
  }
  return people.size;
}

export function resolveSubjectBounded(
  window: EvidenceWindow,
  subject: { primaryName: string; aliases: string[] },
  options: SubjectResolverOptions = {},
): SubjectResolution {
  const names = [subject.primaryName, ...subject.aliases].filter(Boolean);
  const signals: string[] = [];
  const blockers: string[] = [];
  const supportingSourceIds: string[] = [];

  // Strongest case: the window says his name. Nothing else needs checking.
  const namedInWindow = window.items.filter((item) => namesSubject(item.text, names));
  if (namedInWindow.length > 0) {
    return { level: "explicit", signals: ["named_in_window"], blockers: [], supportingSourceIds: namedInWindow.map((item) => item.sourceId) };
  }

  // No pronoun and no name: there is no subject to resolve at all.
  const windowText = window.items.map((item) => item.text).join("\n");
  if (!PRONOUN.test(windowText)) {
    return { level: "unresolved", signals: [], blockers: ["no_subject_reference"], supportingSourceIds: [] };
  }

  const neighbours = [...window.neighbors.before, ...window.neighbors.after];
  const scopeText = [windowText, ...neighbours.map((item) => item.text)].join("\n");

  // A competing person anywhere in scope ends it. This check runs before any positive signal so a
  // pile of corroboration can never outvote a genuine ambiguity.
  if (COMPETING_PERSON.test(scopeText)) {
    return { level: "unresolved", signals: [], blockers: ["competing_person_in_scope"], supportingSourceIds: [] };
  }

  // Mandatory anchor: someone nearby named him. Without this there is no antecedent and the pronoun
  // resolves to nobody, however child-shaped the conversation looks.
  const antecedents = neighbours.filter((item) => namesSubject(item.text, names));
  if (antecedents.length === 0) {
    return { level: "unresolved", signals: [], blockers: ["no_explicit_antecedent"], supportingSourceIds: [] };
  }
  signals.push("explicit_antecedent_nearby");
  supportingSourceIds.push(...antecedents.map((item) => item.sourceId));

  // Corroboration that the window is still about the same child, not a new topic that merely
  // inherited a pronoun.
  if (CHILD_CARE_TOPIC.test(windowText)) signals.push("child_topic_continuity");
  const caregivers = verifiedCaregiverCount(window.items, options.registry);
  if (caregivers >= 2) signals.push("caregiver_continuity");
  if (options.singleChildHousehold) signals.push("single_child_household_prior");

  // The prior is explicitly excluded from the sufficiency test: an antecedent plus "there is only
  // one child" is the reasoning we rejected. Real corroboration must come from the conversation.
  const corroborating = signals.filter((signal) => signal === "child_topic_continuity" || signal === "caregiver_continuity");
  if (corroborating.length === 0) {
    blockers.push("antecedent_without_corroboration");
    return { level: "unresolved", signals, blockers, supportingSourceIds };
  }

  return { level: "contextually_resolved", signals, blockers, supportingSourceIds };
}
