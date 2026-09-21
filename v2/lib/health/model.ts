// HEALTH-02 model. A private, append-only health ledger that sits BESIDE the V2 stores (RawSource /
// CareRecord / CareEpisode), not inside them:
//  - RawSource is one row per source with a flat status; it cannot carry versions, role, time precision,
//    review state or many-to-many references. CareEpisode has no version, no candidate/background split,
//    and persistCareEpisode() merges same-day open episodes and rewrites the source↔story link — both
//    are wrong for health, so nothing here calls it.
//  - Ids of RawSource are referenced by string only (`source` entities carry `rawSourceId` when one exists),
//    so a later bridge can attach without a schema change.
// Nothing in lib/health reads or writes the application database.
import { createHash } from "node:crypto";

export type EntityKind = "source" | "observation" | "canonical_fact" | "encounter" | "episode";
export const ENTITY_KINDS: EntityKind[] = ["source", "observation", "canonical_fact", "encounter", "episode"];

export type LinkRole =
  | "from_source" // observation -> source it was read from
  | "supports" // observation -> further source messages (evidence chain)
  | "attached" // observation -> episode : confirmed, counts as that episode's fact
  | "candidate" // observation -> episode : only plausibly related, never counted
  | "background" // observation -> episode : concurrent context, never counted
  | "encounter" // episode -> encounter
  | "of_encounter" // canonical_fact -> encounter
  | "documented_in"; // encounter | canonical_fact | episode -> source

export const LINK_RULES: Record<string, { from: EntityKind; to: EntityKind[] }> = {
  from_source: { from: "observation", to: ["source"] },
  supports: { from: "observation", to: ["source"] },
  attached: { from: "observation", to: ["episode"] },
  candidate: { from: "observation", to: ["episode"] },
  background: { from: "observation", to: ["episode"] },
  encounter: { from: "episode", to: ["encounter"] },
  of_encounter: { from: "canonical_fact", to: ["encounter"] },
  documented_in: { from: "encounter", to: ["source"] }, // also canonical_fact/episode, see LINK_FROM_EXTRA
};
export const LINK_FROM_EXTRA: Record<string, EntityKind[]> = { documented_in: ["canonical_fact", "episode"] };
export const EPISODE_MEMBERSHIP_ROLES: LinkRole[] = ["attached", "candidate", "background"];

export type Ref = { kind: EntityKind; id: string };
export type Content = Record<string, unknown>;

export interface EntityVersion { version: number; hash: string; content: Content; runId: string; at: string }
export interface Entity { kind: EntityKind; id: string; identity: "strong" | "weak"; versions: EntityVersion[]; aliases?: string[] }
// Evidence binding (links whose target is a source): "from-entity version F rests on source version T". Bindings are
// append-only; the binding that applies to a from-version is the last one whose `from` <= that version, so an older
// fact version keeps its original evidence and a later source revision never silently replaces it.
export interface Binding { from: number; to: number; runId: string }
export interface Link { id: string; from: Ref; to: Ref; role: LinkRole; basis?: string; runId: string; bindings?: Binding[]; toVersion?: number /* legacy, normalized into bindings on read */ }
/** Source version a from-entity version rests on, or null when no binding applies (non-source links, or version older than the first binding). */
export function bindingAt(link: Link, fromVersion: number): number | null {
  let hit: Binding | null = null;
  for (const b of link.bindings ?? []) if (b.from <= fromVersion && (!hit || b.from >= hit.from)) hit = b;
  return hit ? hit.to : null;
}

// reqHash = hash of the normalized request; the same id with a different request is refused.
export type Correction =
  // refAtRecording / linkIdAtRecording: the identity the correction was recorded against, kept when a weak identity is
  // later upgraded (the live `ref`/`linkId` are re-pointed so the correction keeps applying; the audit identity is not lost).
  | { id: string; type: "field"; ref: Ref; refAtRecording?: Ref; field: string; before: unknown; after: unknown; author: string; at: string; reason: string; baseVersion: number; reqHash: string }
  | { id: string; type: "link"; linkId: string; linkIdAtRecording?: string; beforeRole: LinkRole; afterRole: LinkRole | "removed"; author: string; at: string; reason: string; reqHash: string }
  // A correction that pre-dates the ledger and is ALREADY folded into the imported values. Kept as history only:
  // it never changes the effective content, and its author is never invented (`unrecorded`, plus the recorded method).
  | { id: string; type: "historical"; ref: Ref; refAtRecording?: Ref; field: string; before: unknown; after: unknown; author: string; at: string; reason: string; method: string; status: string; targets: Ref[]; reqHash: string };

// hash = closure hash: the entity plus everything it depends on (members, sources at their bound versions, encounters, facts)
export interface AnalysisSnapshot { refs: { ref: Ref; originalRef?: Ref; hash: string }[]; episodes: { id: string; hash: string }[]; evidence: { id: string; version: string }[] }
export interface AnalysisVersion { version: number; at: string; author: string; body: Content; conditions: string[]; reassessWhen: string[]; snapshot: AnalysisSnapshot }
export interface Analysis { id: string; versions: AnalysisVersion[] }
export interface EvidenceEntry { id: string; version: string; status: "valid" | "withdrawn" }

export interface RunRecord { runId: string; at: string; mode: "apply"; batchId: string; inputHash: string; counts: Record<string, number>; note?: string }

export interface Ledger {
  schema: 1;
  revision: number;
  entities: Record<string, Entity>; // key `${kind}:${id}`
  links: Record<string, Link>;
  corrections: Correction[];
  // Same-slot weak/strong messages whose text differs: both kept, never merged, listed for review. Key = sorted pair.
  ambiguities: Record<string, { a: string; b: string; reason: string; alias?: string }>;
  analyses: Record<string, Analysis>;
  evidence: Record<string, EvidenceEntry>;
  runs: RunRecord[]; // operational log; excluded from businessDigest
}

export function emptyLedger(): Ledger {
  return { schema: 1, revision: 0, entities: {}, links: {}, corrections: [], ambiguities: {}, analyses: {}, evidence: {}, runs: [] };
}

export const entityKey = (kind: EntityKind, id: string) => `${kind}:${id}`;
export const linkId = (from: Ref, to: Ref, role: LinkRole) => `${role}|${from.kind}:${from.id}|${to.kind}:${to.id}`;

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
export const hashOf = (value: unknown) => createHash("sha256").update(stableStringify(value)).digest("hex");

export function cloneLedger(ledger: Ledger): Ledger { return structuredClone(ledger); }

/** Hash of business content only: entities, links, corrections, analyses, evidence. Not runs, not revision. */
export function businessDigest(ledger: Ledger): string {
  const entities = Object.fromEntries(Object.entries(ledger.entities).map(([k, e]) => [k, { i: e.identity, v: e.versions.map((v) => v.hash), al: [...(e.aliases ?? [])].sort() }]));
  const links = Object.fromEntries(Object.entries(ledger.links).map(([k, l]) => [k, { r: l.role, b: l.basis ?? null, bd: (l.bindings ?? []).map((x) => [x.from, x.to]) }]));
  return hashOf({ e: entities, l: links, c: ledger.corrections, m: ledger.ambiguities, a: ledger.analyses, v: ledger.evidence });
}
