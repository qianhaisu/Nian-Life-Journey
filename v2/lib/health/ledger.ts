// HEALTH-02 ledger operations. Everything here is pure: (ledger, input) -> result / new ledger.
// Persistence, locking and atomic write live in file-store.ts.
import {
  EPISODE_MEMBERSHIP_ROLES, LINK_FROM_EXTRA, LINK_RULES, bindingAt, businessDigest, cloneLedger, entityKey, hashOf, linkId,
  type Analysis, type AnalysisSnapshot, type Content, type Correction, type Entity, type EntityKind, type Ledger, type Link, type LinkRole, type Ref,
} from "./model";
import { Graph, assertSafePath, boundVersionOf, effectiveContent, effectiveLinks, getPath } from "./graph";

export { effectiveContent, effectiveLinks, Graph };

// ---------- batch input ----------
/** toVersion (sources only): the source version the from-entity version rests on. Omitted => the version the source has after this batch for NEW links (same-batch revision if it changes here); existing links whose evidence version cannot be established are reported (`unconfirmed`), never guessed. */
export interface BatchLink { role: LinkRole; to: Ref; basis?: string; toVersion?: number }
export interface BatchItem { kind: EntityKind; id?: string; identity?: "strong" | "weak"; content: Content; links?: BatchLink[] }
export interface StandaloneLink { from: Ref; role: LinkRole; to: Ref; basis?: string; toVersion?: number }
/** Pre-ledger correction history, already folded into the imported values. Never changes effective content. */
export interface HistoricalCorrection { id: string; ref: Ref; field: string; before: unknown; after: unknown; method: string; status: string; at: string; reason: string; targets?: Ref[] }
export interface Batch { batchId: string; items: BatchItem[]; links?: StandaloneLink[]; historical?: HistoricalCorrection[] }

export type Action = "new" | "duplicate" | "version_change" | "conflict" | "ambiguous" | "rejected";
export interface PlanItem { ref: Ref; action: Action; reason?: string; detail?: Record<string, unknown> }
export interface PlanLink { id: string; action: "new" | "duplicate" | "rebind" | "unconfirmed" | "conflict" | "held" | "rejected"; reason?: string }
export interface Impact { changed: Ref[]; entities: string[]; episodes: string[]; analyses: string[]; sourceRevisions: string[] }
export interface Plan {
  batchId: string; inputHash: string;
  items: PlanItem[]; links: PlanLink[];
  counts: Record<Action, number> & { links_new: number; links_duplicate: number; links_rebind: number; links_unconfirmed: number; links_conflict: number; links_held: number; historical_new: number };
  rejected: boolean; // any rejected item/link/in-batch conflict => apply refuses the whole batch, nothing written
  needsReview: boolean; // conflicts / ambiguities exist and are listed for a human
  impact: Impact;
  // internal, consumed by applyPlan
  _apply: {
    items: { item: BatchItem; id: string; identity: "strong" | "weak"; hash: string; action: "new" | "version_change"; ambiguousWith?: string[]; ambiguousAlias?: string }[];
    rebinds: { linkId: string; binding: { from: number; to: number } }[];
    links: { link: Link }[];
    aliases: { key: string; alias: string }[];
    rekeys: { from: string; to: string; alias: string }[];
    historical: Correction[];
  };
}

// ---------- effective view ----------
export const currentEntity = (ledger: Ledger, ref: Ref): Entity | undefined => ledger.entities[entityKey(ref.kind, ref.id)];
export const effectiveHash = (ledger: Ledger, ref: Ref) => { const e = effectiveContent(ledger, ref); return e ? hashOf({ v: e.version, c: e.content }) : "absent"; };

/** Observations counted as facts of an episode: effective role "attached" only. */
export function confirmedFactIds(ledger: Ledger, episodeId: string): string[] {
  return effectiveLinks(ledger).filter((l) => l.to.kind === "episode" && l.to.id === episodeId && l.effectiveRole === "attached").map((l) => l.from.id).sort();
}
export function membership(ledger: Ledger, episodeId: string): { attached: string[]; candidate: string[]; background: string[] } {
  const out = { attached: [] as string[], candidate: [] as string[], background: [] as string[] };
  for (const l of effectiveLinks(ledger)) {
    if (l.to.kind !== "episode" || l.to.id !== episodeId) continue;
    if (l.effectiveRole === "attached" || l.effectiveRole === "candidate" || l.effectiveRole === "background") out[l.effectiveRole].push(l.from.id);
  }
  for (const k of Object.keys(out) as (keyof typeof out)[]) out[k].sort();
  return out;
}

// ---------- content validation (generic; no family-specific ids, dates or disease words) ----------
export type Validator = (item: { kind: EntityKind; content: Content }, ctx: { ledger: Ledger }) => string | null; // returns rejection reason
const PRECISIONS = new Set(["minute", "hour", "day", "month", "year", "range", "approx"]);
const DECLARED_END = new Set(["ongoing", "ended", "end_unknown"]);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
export type TimeShape = "year" | "month" | "day" | "minute" | "second";
const TIME_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?)?)?$/;
const SHAPE_RANK: Record<TimeShape, number> = { year: 0, month: 1, day: 2, minute: 3, second: 4 };
/**
 * Whole-string, calendar-real parse. Accepts YYYY, YYYY-MM, YYYY-MM-DD, and YYYY-MM-DD[ T]HH:MM[:SS[.fff]] with an optional
 * Z / +-HH:MM offset (no offset = Shanghai wall clock, the ledger convention). Trailing text, month 13, Feb 31, hour 24 and
 * impossible offsets are refused. Returns the finest shape present.
 */
export function parseTimeString(v: unknown): { shape: TimeShape; offset: string | null } | null {
  if (typeof v !== "string") return null;
  const m = TIME_RE.exec(v);
  if (!m) return null;
  const y = +m[1], mo = m[2] === undefined ? 1 : +m[2], d = m[3] === undefined ? 1 : +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (mo < 1 || mo > 12 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (m[4] !== undefined && (+m[4] > 23 || +m[5] > 59 || (m[6] !== undefined && +m[6] > 59))) return null;
  if (m[7] && m[7] !== "Z") { const o = /^[+-](\d{2}):?(\d{2})$/.exec(m[7])!; if (+o[1] > 14 || +o[2] > 59) return null; }
  const shape: TimeShape = m[6] !== undefined ? "second" : m[4] !== undefined ? "minute" : m[3] !== undefined ? "day" : m[2] !== undefined ? "month" : "year";
  return { shape, offset: m[7] ?? null };
}
export const isValidTimeString = (v: unknown) => parseTimeString(v) !== null;
/** Declared precision must not be finer than what the value carries (approx/range carry their own meaning and are exempt). */
function precisionFits(value: string, precision: string): boolean {
  const p = parseTimeString(value);
  if (!p) return false;
  const need: Record<string, number> = { year: 0, month: 1, day: 2, hour: 3, minute: 3 };
  return precision in need ? SHAPE_RANK[p.shape] >= need[precision] : true;
}
const isNumericLike = (v: unknown) => typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()));
/**
 * A {value, unit} object. Strict (measure/dose objects): a value needs a real unit string. Lenient (structured lab-style
 * result): a numeric value needs the `unit` key present, `null` meaning the source itself has no unit; textual results need none.
 */
function quantityProblem(q: unknown, label: string, lenient: boolean): string | null {
  if (q === undefined || q === null || typeof q !== "object" || Array.isArray(q)) return null;
  const o = q as Record<string, unknown>;
  if (!("value" in o)) return null;
  if (o.value === undefined || o.value === null || o.value === "") return lenient ? null : `${label}_value_missing`; // lenient: the source has no result yet (e.g. a panel header): explicit unknown, not an error
  if (lenient) return !isNumericLike(o.value) || "unit" in o ? null : `${label}_unit_missing`;
  return isStr(o.unit) ? null : `${label}_unit_missing`;
}

export const CONTENT_VALIDATORS: Validator[] = [
  (item) => (typeof item.content !== "object" || item.content === null || Array.isArray(item.content) ? "content_not_object" : null),
  (item) => {
    if (item.kind !== "observation") return null;
    const c = item.content;
    if (!isStr(c.role)) return "observation_role_missing";
    if (!isStr(c.recordedAt)) return "observation_recorded_at_missing";
    if (!isValidTimeString(c.recordedAt)) return "recorded_at_not_a_valid_time";
    if (c.occurredAt != null) {
      if (!isStr(c.occurredAt)) return "occurred_at_not_string";
      if (!isValidTimeString(c.occurredAt)) return "occurred_at_not_a_valid_time";
      if (!isStr(c.occurredPrecision) || !PRECISIONS.has(c.occurredPrecision)) return "occurred_precision_missing";
      if (!precisionFits(c.occurredAt, c.occurredPrecision)) return "occurred_precision_finer_than_value";
      if (!isStr(c.timeBasis) || c.timeBasis === "message_time_only" || c.timeBasis === "unknown") return "occurred_at_needs_an_explicit_time_basis";
    } else {
      if (c.timeBasis !== "message_time_only" && c.timeBasis !== "unknown") return "unknown_occurrence_must_declare_time_basis";
      if (c.occurredPrecision != null) return "unknown_occurrence_with_precision";
    }
    return quantityProblem(c.measure, "measure", false) ?? quantityProblem(c.dose, "dose", false);
  },
  (item) => {
    if (item.kind !== "episode") return null;
    const c = item.content;
    if (!isStr(c.title)) return "episode_title_missing";
    if (!isStr(c.declaredEnd) || !DECLARED_END.has(c.declaredEnd)) return "episode_declared_end_invalid";
    if (c.declaredEnd === "ended" && !isStr(c.end)) return "episode_ended_without_end";
    if (c.declaredEnd !== "ended" && c.end) return "episode_end_without_ended_status";
    if (c.start != null && !isValidTimeString(c.start)) return "episode_start_not_a_valid_time";
    if (c.end != null && !isValidTimeString(c.end)) return "episode_end_not_a_valid_time";
    if (isStr(c.start) && isStr(c.end) && c.end < c.start) return "episode_ends_before_it_starts";
    return null;
  },
  (item) => (item.kind === "encounter" && !isStr(item.content.kind) ? "encounter_kind_missing" : null),
  (item) => {
    if (item.kind !== "canonical_fact") return null;
    const c = item.content;
    if (!isStr(c.type) || c.value === undefined) return "canonical_fact_incomplete";
    if (c.structured === undefined || c.structured === null) return quantityProblem(c.dose, "dose", false);
    if (typeof c.structured !== "object" || Array.isArray(c.structured)) return "structured_not_object";
    const s = c.structured as Record<string, unknown>;
    // lab-style {name,value,unit,...}: numeric value needs the `unit` key (null = the source has no unit); a dose given as an
    // object needs a real unit; a dose given as source text ("per dose ...") stays text: never parsed, converted or invented.
    return quantityProblem(s, "structured", true) ?? quantityProblem(s.dose, "dose", false) ?? quantityProblem(c.dose, "dose", false);
  },
  (item) => (item.kind === "encounter" && item.content.date != null && !isValidTimeString(item.content.date) ? "encounter_date_not_a_valid_time" : null),
];
export function firstRejection(item: { kind: EntityKind; content: Content }, ledger: Ledger, validators: Validator[] = CONTENT_VALIDATORS): string | null {
  for (const v of validators) {
    let r: string | null;
    try { r = v(item, { ledger }); } catch (e) { r = `validator_error:${(e as Error).message}`; }
    if (r) return r;
  }
  return null;
}

// ---------- planning (dry-run is exactly this, without applyPlan) ----------
const weakId = (c: Content) => `weak:${hashOf({ k: c.conversation ?? null, t: c.recordedAt ?? null, s: c.speaker ?? null, x: c.text ?? null }).slice(0, 24)}`;
const slotKeyOf = (kind: string, c: Content) => `${kind}|${String(c.conversation)}|${String(c.recordedAt)}|${String(c.speaker)}`;
const hasSlot = (c: Content) => c.conversation !== undefined && c.recordedAt !== undefined && c.speaker !== undefined;
const pairKeyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const MEMBERSHIP_FAMILY = new Set<string>(EPISODE_MEMBERSHIP_ROLES);
const keyId = (k: string) => k.slice(k.indexOf(":") + 1);
const keyKind = (k: string) => k.slice(0, k.indexOf(":")) as EntityKind;

export function planImport(ledger: Ledger, batch: Batch, validators: Validator[] = CONTENT_VALIDATORS): Plan {
  const items: PlanItem[] = [];
  const planLinks: PlanLink[] = [];
  const apply: Plan["_apply"] = { items: [], links: [], rebinds: [], aliases: [], rekeys: [], historical: [] };
  const held = new Set<string>();
  const known = new Set(Object.keys(ledger.entities));
  const kinds = new Map<string, EntityKind>(Object.entries(ledger.entities).map(([k, e]) => [k, e.kind]));
  const aliasToKey = new Map<string, string>(); // `${kind}:${alias}` -> canonical entity key
  for (const [k, e] of Object.entries(ledger.entities)) for (const a of e.aliases ?? []) aliasToKey.set(`${e.kind}:${a}`, k);
  const versionAfter = new Map<string, number>(Object.entries(ledger.entities).map(([k, e]) => [k, e.versions.length]));
  const slotIndex = new Map<string, { key: string; id: string; identity: "strong" | "weak"; textHash: string }[]>();
  const addSlot = (kind: string, key: string, id: string, identity: "strong" | "weak", c: Content) => {
    if (!hasSlot(c)) return;
    const k = slotKeyOf(kind, c);
    (slotIndex.get(k) ?? slotIndex.set(k, []).get(k)!).push({ key, id, identity, textHash: hashOf(c.text ?? null) });
  };
  for (const e of Object.values(ledger.entities)) addSlot(e.kind, entityKey(e.kind, e.id), e.id, e.identity, e.versions[e.versions.length - 1].content);

  // resolve ids and validate content; strong items are planned before weak ones so a weak item always sees the batch's strong ones
  type Row = { raw: BatchItem; id: string; identity: "strong" | "weak"; hash: string };
  const rows: Row[] = [];
  const rejectedKeys = new Set<string>();
  for (const raw of batch.items) {
    const identity: "strong" | "weak" = raw.identity ?? "strong";
    const id = raw.id ?? (identity === "weak" && raw.content && typeof raw.content === "object" ? weakId(raw.content) : undefined);
    const ref: Ref = { kind: raw.kind, id: id ?? "" };
    if (!id) { items.push({ ref, action: "rejected", reason: "no_strong_identity" }); continue; }
    const rejection = firstRejection(raw, ledger, validators);
    if (rejection) { items.push({ ref, action: "rejected", reason: rejection }); rejectedKeys.add(entityKey(raw.kind, id)); continue; }
    rows.push({ raw, id, identity, hash: hashOf(raw.content) });
  }
  // in-batch same identity: identical -> collapse; different content -> the WHOLE batch is refused (no first-wins)
  const byKey = new Map<string, Row[]>();
  for (const r of rows) { const k = entityKey(r.raw.kind, r.id); (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r); }
  const ordered: Row[] = [];
  let hardConflict = false;
  for (const [key, group] of byKey) {
    const ref: Ref = { kind: group[0].raw.kind, id: group[0].id };
    if (new Set(group.map((g) => g.hash)).size > 1) {
      hardConflict = true;
      items.push({ ref, action: "conflict", reason: "same_identity_different_content_in_batch", detail: { versions: new Set(group.map((g) => g.hash)).size } });
      rejectedKeys.add(key);
      continue;
    }
    ordered.push(group[0]);
    for (let i = 1; i < group.length; i++) items.push({ ref, action: "duplicate", reason: "repeated_in_batch" });
  }
  ordered.sort((a, b) => (a.identity === b.identity ? 0 : a.identity === "strong" ? -1 : 1));

  const addNew = (r: Row, key: string, ambiguousKeys: string[], reason?: string, alias?: string) => {
    const ref: Ref = { kind: r.raw.kind, id: r.id };
    items.push(ambiguousKeys.length ? { ref, action: "ambiguous", reason, detail: { existingIds: ambiguousKeys.map(keyId), written: true } } : { ref, action: "new" });
    apply.items.push({ item: r.raw, id: r.id, identity: r.identity, hash: r.hash, action: "new", ambiguousWith: ambiguousKeys.length ? ambiguousKeys : undefined, ambiguousAlias: alias });
    known.add(key); kinds.set(key, r.raw.kind); versionAfter.set(key, 1);
    addSlot(r.raw.kind, key, r.id, r.identity, r.raw.content);
  };
  // how many NEW strong messages of this batch share one weak identity (same conversation/time/speaker/text): decided up front so it cannot depend on order
  const batchStrongNewByWid = new Map<string, number>();
  for (const r of ordered) {
    if (r.identity !== "strong" || !hasSlot(r.raw.content)) continue;
    if (ledger.entities[entityKey(r.raw.kind, r.id)] || aliasToKey.has(`${r.raw.kind}:${r.id}`)) continue;
    const w = weakId(r.raw.content);
    batchStrongNewByWid.set(w, (batchStrongNewByWid.get(w) ?? 0) + 1);
  }

  for (const r of ordered) {
    const { raw, id, identity, hash } = r;
    const ref: Ref = { kind: raw.kind, id };
    let key = entityKey(raw.kind, id);
    if (!ledger.entities[key]) key = aliasToKey.get(`${raw.kind}:${id}`) ?? key;
    const existing = ledger.entities[key];

    if (!existing) {
      const twins = hasSlot(raw.content) ? slotIndex.get(slotKeyOf(raw.kind, raw.content)) ?? [] : [];
      const th = hashOf(raw.content.text ?? null);
      const strongSame = twins.filter((t) => t.textHash === th && t.identity === "strong" && t.key !== key);
      const otherText = twins.filter((t) => t.textHash !== th && t.key !== key);
      if (identity === "weak") {
        // exactly one matching strong message => alias of it; several (e.g. the same text sent twice) => keep the weak record AND
        // every strong message, with a pending mapping to each; never pick the first
        if (strongSame.length === 1) { items.push({ ref, action: "duplicate", reason: "weak_identity_matches_existing_slot_and_text", detail: { existingId: strongSame[0].id } }); apply.aliases.push({ key: strongSame[0].key, alias: id }); continue; }
        if (strongSame.length > 1) { addNew(r, key, strongSame.map((t) => t.key), "weak_identity_matches_multiple_strong_messages"); continue; }
        addNew(r, key, otherText.filter((t) => t.identity === "strong").map((t) => t.key), "weak_message_same_slot_as_strong_message_with_different_text");
        continue;
      }
      // strong, new
      const wid = hasSlot(raw.content) ? weakId(raw.content) : null;
      const weakKey = wid ? entityKey(raw.kind, wid) : null;
      const weakEntity = weakKey ? ledger.entities[weakKey] : undefined;
      if (weakKey && weakEntity && weakEntity.identity === "weak") {
        const competing = ((batchStrongNewByWid.get(wid!) ?? 1) - 1) + strongSame.filter((t) => !!ledger.entities[t.key]).length;
        if (competing > 0) { addNew(r, key, [weakKey], "multiple_strong_candidates_for_one_weak_identity"); continue; }
        // exactly one strong candidate: adopt (re-key) so the message is not counted twice, in either arrival order
        const prevHash = weakEntity.versions.at(-1)!.hash;
        apply.rekeys.push({ from: weakKey, to: key, alias: wid! });
        known.add(key); kinds.set(key, raw.kind); aliasToKey.set(`${raw.kind}:${wid}`, key);
        versionAfter.set(key, weakEntity.versions.length + (prevHash === hash ? 0 : 1));
        if (prevHash === hash) items.push({ ref, action: "duplicate", reason: "adopts_weak_identity_same_content", detail: { weakId: wid } });
        else { items.push({ ref, action: "version_change", reason: "adopts_weak_identity", detail: { weakId: wid, changedFields: changedFields(weakEntity.versions.at(-1)!.content, raw.content), shadowedByCorrection: [] } }); apply.items.push({ item: raw, id, identity: "strong", hash, action: "version_change" }); }
        continue;
      }
      const holder = wid ? aliasToKey.get(`${raw.kind}:${wid}`) : undefined; // a strong entity already adopted this weak identity
      if (holder && holder !== key) { addNew(r, key, [holder], "weak_alias_shared_by_multiple_strong_messages", wid!); continue; }
      addNew(r, key, otherText.filter((t) => t.identity === "weak").map((t) => t.key), "strong_message_same_slot_as_weak_message_with_different_text");
      continue;
    }

    if (existing.versions.some((v) => v.hash === hash)) {
      items.push({ ref, action: "duplicate", reason: existing.versions.at(-1)!.hash === hash ? "same_as_current" : "same_as_older_version_not_revived" });
      continue;
    }
    const prev = existing.versions.at(-1)!.content;
    const unitChange = unitChanged(prev, raw.content);
    if (unitChange) { items.push({ ref, action: "conflict", reason: "unit_changed", detail: unitChange }); held.add(key); continue; }
    const changed = changedFields(prev, raw.content);
    const shadowed = ledger.corrections.filter((c) => c.type === "field" && c.ref.kind === raw.kind && c.ref.id === existing.id && changed.some((f) => f === c.field || f.startsWith(`${c.field}.`) || c.field.startsWith(`${f}.`))).map((c) => (c as Extract<Correction, { type: "field" }>).field);
    items.push({ ref, action: "version_change", detail: { changedFields: changed, shadowedByCorrection: [...new Set(shadowed)] } });
    apply.items.push({ item: raw, id: existing.id, identity: existing.identity, hash, action: "version_change" });
    versionAfter.set(key, existing.versions.length + 1);
  }

  // ---- links: validated against ledger + applied batch items; held/dangling targets are reported, never guessed ----
  const membershipRoleOf = new Map<string, LinkRole>();
  for (const l of effectiveLinks(ledger)) if (MEMBERSHIP_FAMILY.has(l.role)) membershipRoleOf.set(`${l.from.id}>${l.to.id}`, l.effectiveRole as LinkRole);
  const decls: { from: Ref; bl: BatchLink }[] = [];
  for (const row of rows) if (!rejectedKeys.has(entityKey(row.raw.kind, row.id))) for (const bl of row.raw.links ?? []) decls.push({ from: { kind: row.raw.kind, id: row.id }, bl });
  for (const l of batch.links ?? []) decls.push({ from: l.from, bl: { role: l.role, to: l.to, basis: l.basis, toVersion: l.toVersion } });
  const canon = (r: Ref): { key: string; ref: Ref } => {
    const k = entityKey(r.kind, r.id);
    const a = ledger.entities[k] ? k : aliasToKey.get(`${r.kind}:${r.id}`) ?? k;
    const e = ledger.entities[a];
    return { key: a, ref: e ? { kind: e.kind, id: e.id } : r };
  };
  for (const { from: fromIn, bl } of decls) {
    const fromC = canon(fromIn), toC = canon(bl.to);
    const fromRef = fromC.ref, to = toC.ref, fromKey = fromC.key, toKey = toC.key;
    const lid = linkId(fromRef, to, bl.role);
    const rule = LINK_RULES[bl.role];
    const fromOk = rule && (rule.from === fromRef.kind || (LINK_FROM_EXTRA[bl.role] ?? []).includes(fromRef.kind));
    if (!rule || !fromOk) { planLinks.push({ id: lid, action: "rejected", reason: "role_not_allowed_from_kind" }); continue; }
    if ((held.has(toKey) && !ledger.entities[toKey]) || (held.has(fromKey) && !ledger.entities[fromKey])) { planLinks.push({ id: lid, action: "held", reason: "endpoint_held" }); continue; }
    if (!known.has(fromKey)) { planLinks.push({ id: lid, action: "rejected", reason: "dangling_source" }); continue; }
    if (!known.has(toKey)) { planLinks.push({ id: lid, action: "rejected", reason: "dangling_target" }); continue; }
    if (kinds.get(toKey) !== to.kind || !rule.to.includes(to.kind)) { planLinks.push({ id: lid, action: "rejected", reason: "wrong_target_kind" }); continue; }
    const isSource = to.kind === "source";
    const fromNow = ledger.entities[fromKey]?.versions.length ?? 0, toNow = ledger.entities[toKey]?.versions.length ?? 0;
    const fromVer = versionAfter.get(fromKey) ?? fromNow, toVerAfter = versionAfter.get(toKey) ?? toNow;
    if (isSource && bl.toVersion !== undefined && (!Number.isInteger(bl.toVersion) || bl.toVersion < 1 || bl.toVersion > toVerAfter)) { planLinks.push({ id: lid, action: "rejected", reason: "binding_version_out_of_range" }); continue; }
    if (apply.links.some((a) => a.link.id === lid)) { planLinks.push({ id: lid, action: "duplicate" }); continue; }
    const existingLink = ledger.links[lid];
    if (existingLink) {
      // The link already exists. If this batch gives the from-entity a NEW version, that version needs its own evidence binding:
      // explicit toVersion, or the source revision supplied in the same batch; otherwise it is reported (never guessed) and the
      // new version keeps the previous binding.
      if (isSource && fromVer > fromNow && !apply.rebinds.some((x) => x.linkId === lid)) {
        const eff = bindingAt(existingLink, fromNow);
        const desired = bl.toVersion ?? (toVerAfter > toNow ? toVerAfter : null);
        if (desired !== null && desired !== eff) { apply.rebinds.push({ linkId: lid, binding: { from: fromVer, to: desired } }); planLinks.push({ id: lid, action: "rebind" }); continue; }
        if (desired === null && eff !== null && toNow > eff) { planLinks.push({ id: lid, action: "unconfirmed", reason: "source_binding_unconfirmed" }); continue; }
      }
      planLinks.push({ id: lid, action: "duplicate" });
      continue;
    }
    if (MEMBERSHIP_FAMILY.has(bl.role)) {
      const prior = membershipRoleOf.get(`${fromRef.id}>${to.id}`);
      const inBatch = apply.links.find((a) => a.link.from.id === fromRef.id && a.link.to.id === to.id && MEMBERSHIP_FAMILY.has(a.link.role));
      if ((prior && prior !== bl.role) || (inBatch && inBatch.link.role !== bl.role)) { planLinks.push({ id: lid, action: "conflict", reason: "membership_role_conflict" }); continue; }
    }
    apply.links.push({ link: { id: lid, from: fromRef, to, role: bl.role, basis: bl.basis, runId: "", bindings: isSource ? [{ from: fromVer, to: bl.toVersion ?? toVerAfter, runId: "" }] : undefined } });
    planLinks.push({ id: lid, action: "new" });
  }

  // ---- historical corrections (pre-ledger history): identity by id, content by hash ----
  for (const h of batch.historical ?? []) {
    const c: Correction = { id: h.id, type: "historical", ref: h.ref, field: h.field, before: h.before, after: h.after, author: `unrecorded (method: ${h.method})`, at: h.at, reason: h.reason, method: h.method, status: h.status, targets: h.targets ?? [], reqHash: "" };
    c.reqHash = hashOf({ ...c, reqHash: undefined });
    if (!known.has(entityKey(h.ref.kind, h.ref.id))) { items.push({ ref: h.ref, action: "rejected", reason: "historical_correction_target_missing", detail: { id: h.id } }); continue; }
    if ((h.targets ?? []).some((t) => !known.has(entityKey(t.kind, t.id)))) { items.push({ ref: h.ref, action: "rejected", reason: "historical_correction_link_target_missing", detail: { id: h.id } }); continue; }
    const prior = ledger.corrections.find((x) => x.id === h.id) ?? apply.historical.find((x) => x.id === h.id);
    if (prior) { if (prior.reqHash !== c.reqHash) { hardConflict = true; items.push({ ref: h.ref, action: "conflict", reason: "historical_correction_id_reused_with_different_content", detail: { id: h.id } }); } continue; }
    apply.historical.push(c);
  }

  const counts = { new: 0, duplicate: 0, version_change: 0, conflict: 0, ambiguous: 0, rejected: 0, links_new: 0, links_duplicate: 0, links_rebind: 0, links_unconfirmed: 0, links_conflict: 0, links_held: 0, historical_new: apply.historical.length };
  for (const i of items) counts[i.action]++;
  for (const l of planLinks) { if (l.action === "new") counts.links_new++; else if (l.action === "duplicate") counts.links_duplicate++; else if (l.action === "rebind") counts.links_rebind++; else if (l.action === "unconfirmed") counts.links_unconfirmed++; else if (l.action === "conflict") counts.links_conflict++; else if (l.action === "held") counts.links_held++; else counts.rejected++; }
  const rejected = hardConflict || items.some((i) => i.action === "rejected") || planLinks.some((l) => l.action === "rejected");
  const needsReview = counts.conflict > 0 || counts.ambiguous > 0 || counts.links_conflict > 0 || counts.links_unconfirmed > 0;
  const changedRefs: Ref[] = [...apply.items.map((a) => ({ kind: a.item.kind, id: a.id })), ...apply.rekeys.flatMap((k) => [{ kind: keyKind(k.to), id: keyId(k.to) }, { kind: keyKind(k.from), id: keyId(k.from) }]), ...apply.rebinds.map((x) => ledger.links[x.linkId].from)];
  return { batchId: batch.batchId, inputHash: hashOf(batch), items, links: planLinks, counts, rejected, needsReview, impact: computeImpact(ledger, changedRefs, apply.links.map((a) => a.link), undefined, versionAfter), _apply: apply };
}

function changedFields(a: Content, b: Content): string[] {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (hashOf(a[k]) !== hashOf(b[k])) out.push(k);
  return out.sort();
}
/** trailing unit token of a source-text quantity ("...5.00ml" -> "ml"); only used to DETECT a change, never to convert. */
const embeddedUnit = (v: unknown) => (typeof v === "string" ? /\d\s*([^\d\s.,;:()（）]+)\s*$/.exec(v)?.[1] ?? null : null);
function unitChanged(a: Content, b: Content): Record<string, unknown> | null {
  for (const path of ["measure.unit", "dose.unit", "unit", "structured.unit", "structured.dose.unit"]) {
    const x = getPath(a, path), y = getPath(b, path);
    if (x !== undefined && y !== undefined && x !== y) return { field: path, before: x, after: y };
  }
  for (const path of ["structured.dose", "structured.spec", "structured.qty", "dose"]) {
    const x = embeddedUnit(getPath(a, path)), y = embeddedUnit(getPath(b, path));
    if (x && y && x !== y) return { field: path, before: x, after: y, kind: "unit_token_in_text" };
  }
  return null;
}

/**
 * Who is affected by a change: the reverse dependency closure (source -> observation -> episode,
 * canonical fact -> encounter -> episode, ...), plus analyses whose snapshot touches any affected entity.
 * A new or re-roled link affects both ends. `sourceRevisions` lists links bound to an older source
 * version that has since been revised — they keep their bound evidence but need a look.
 */
export function computeImpact(ledger: Ledger, changed: Ref[], newLinks: Link[] = [], graphIn?: Graph, versionsAfter?: Map<string, number>): Impact {
  const graph = graphIn ?? new Graph(ledger, newLinks);
  const seeds = changed.map((r) => entityKey(r.kind, r.id));
  for (const l of newLinks) seeds.push(entityKey(l.from.kind, l.from.id), entityKey(l.to.kind, l.to.id));
  const affected = graph.dependentsOf(seeds);
  const episodes = [...affected].filter((k) => k.startsWith("episode:")).map(keyId).sort();
  const analyses = Object.values(ledger.analyses).filter((a) => {
    const snap = a.versions.at(-1)!.snapshot;
    return snap.refs.some((r) => affected.has(entityKey(r.ref.kind, r.ref.id))) || snap.episodes.some((e) => affected.has(entityKey("episode", e.id)));
  }).map((a) => a.id).sort();
  const sourceRevisions = graph.links.filter((l) => l.to.kind === "source" && affected.has(entityKey("source", l.to.id)) && boundVersionOf(ledger, l as Link) < (versionsAfter?.get(entityKey("source", l.to.id)) ?? ledger.entities[entityKey("source", l.to.id)]?.versions.length ?? 0)).map((l) => l.id).sort();
  return { changed, entities: [...affected].sort(), episodes, analyses, sourceRevisions };
}

// ---------- apply (pure: returns new ledger) ----------
function rekey(next: Ledger, fromKey: string, toKey: string, alias: string) {
  const e = next.entities[fromKey];
  if (!e) throw new Error(`cannot re-key ${fromKey}: entity missing (a weak identity can be adopted by only one strong message)`);
  if (next.entities[toKey]) throw new Error(`cannot re-key ${fromKey}: ${toKey} already exists`);
  const fromId = keyId(fromKey), toId = keyId(toKey);
  delete next.entities[fromKey];
  next.entities[toKey] = { ...e, id: toId, identity: "strong", aliases: [...new Set([...(e.aliases ?? []), alias])] };
  const remap = (r: Ref): Ref => (r.kind === e.kind && r.id === fromId ? { kind: r.kind, id: toId } : r);
  const links: Record<string, Link> = {};
  const linkMap = new Map<string, string>();
  for (const l of Object.values(next.links)) {
    const nl = { ...l, from: remap(l.from), to: remap(l.to) };
    nl.id = linkId(nl.from, nl.to, nl.role);
    linkMap.set(l.id, nl.id);
    links[nl.id] = nl;
  }
  next.links = links;
  // live pointers move so corrections/analyses keep applying; the identity they were recorded against is preserved
  next.corrections = next.corrections.map((c) => {
    if (c.type === "link") { const nl = linkMap.get(c.linkId) ?? c.linkId; return nl === c.linkId ? c : { ...c, linkId: nl, linkIdAtRecording: c.linkIdAtRecording ?? c.linkId }; }
    const nr = remap(c.ref);
    return nr === c.ref ? c : { ...c, ref: nr, refAtRecording: c.refAtRecording ?? c.ref };
  }) as Correction[];
  for (const a of Object.values(next.analyses)) for (const v of a.versions) v.snapshot.refs = v.snapshot.refs.map((x) => { const nr = remap(x.ref); return nr === x.ref ? x : { ...x, ref: nr, originalRef: x.originalRef ?? x.ref }; });
  for (const [k, p] of Object.entries(next.ambiguities)) if (p.a === fromKey || p.b === fromKey) { delete next.ambiguities[k]; const a = p.a === fromKey ? toKey : p.a, b = p.b === fromKey ? toKey : p.b; next.ambiguities[pairKeyOf(a, b)] = { ...p, a: a < b ? a : b, b: a < b ? b : a }; }
}

export function applyPlan(ledger: Ledger, plan: Plan, meta: { runId: string; at: string }): Ledger {
  if (plan.rejected) throw new Error(`batch ${plan.batchId} rejected; nothing written`);
  const next = cloneLedger(ledger);
  for (const rb of plan._apply.rebinds) { const l = next.links[rb.linkId]; if (!l) throw new Error(`rebind target link missing`); l.bindings = [...(l.bindings ?? []), { ...rb.binding, runId: meta.runId }]; }
  for (const k of plan._apply.rekeys) rekey(next, k.from, k.to, k.alias);
  const resolve = (r: Ref) => { const k = entityKey(r.kind, r.id); if (next.entities[k]) return k; const hit = Object.entries(next.entities).find(([, e]) => e.kind === r.kind && (e.aliases ?? []).includes(r.id)); return hit ? hit[0] : k; };
  for (const a of plan._apply.items) {
    const key = entityKey(a.item.kind, a.id);
    const e = next.entities[key] ?? (next.entities[key] = { kind: a.item.kind, id: a.id, identity: a.identity, versions: [] });
    e.versions.push({ version: e.versions.length + 1, hash: a.hash, content: a.item.content, runId: meta.runId, at: meta.at });
    for (const other of a.ambiguousWith ?? []) next.ambiguities[pairKeyOf(key, other)] = { a: key < other ? key : other, b: key < other ? other : key, reason: a.ambiguousAlias ? "weak_identity_alias_shared_by_multiple_strong_messages" : "same_slot_weak_and_strong_message_candidates", ...(a.ambiguousAlias ? { alias: a.ambiguousAlias } : {}) };
  }
  for (const al of plan._apply.aliases) { const e = next.entities[al.key]; if (e && !(e.aliases ?? []).includes(al.alias)) e.aliases = [...(e.aliases ?? []), al.alias]; }
  for (const l of plan._apply.links) {
    const ef = next.entities[resolve(l.link.from)], et = next.entities[resolve(l.link.to)];
    if (!ef || !et) throw new Error(`link ${l.link.id}: endpoint missing after apply`);
    const nl: Link = { ...l.link, from: { kind: ef.kind, id: ef.id }, to: { kind: et.kind, id: et.id }, runId: meta.runId, bindings: l.link.bindings?.map((b) => ({ ...b, runId: meta.runId })) };
    nl.id = linkId(nl.from, nl.to, nl.role);
    if (!next.links[nl.id]) next.links[nl.id] = nl;
  }
  for (const c of plan._apply.historical) next.corrections.push(c);
  const c = plan.counts;
  next.runs.push({ runId: meta.runId, at: meta.at, mode: "apply", batchId: plan.batchId, inputHash: plan.inputHash, counts: { new: c.new, duplicate: c.duplicate, version_change: c.version_change, conflict: c.conflict, ambiguous: c.ambiguous, links_new: c.links_new, links_duplicate: c.links_duplicate, links_rebind: c.links_rebind, links_unconfirmed: c.links_unconfirmed, links_conflict: c.links_conflict, links_held: c.links_held, historical_new: c.historical_new } });
  next.revision = ledger.revision + 1;
  const problems = checkInvariants(next);
  if (problems.length) throw new Error(`invariants failed after apply: ${problems.slice(0, 5).join("; ")}`);
  return next;
}

/** Post-apply invariants over the whole ledger. Any exception inside a check is itself a reported failure. */
export function checkInvariants(ledger: Ledger): string[] {
  const problems: string[] = [];
  const checks: (() => void)[] = [
    () => { for (const l of Object.values(ledger.links)) {
      const f = ledger.entities[entityKey(l.from.kind, l.from.id)], t = ledger.entities[entityKey(l.to.kind, l.to.id)];
      if (!f) problems.push(`link ${l.id}: source entity missing`);
      if (!t) problems.push(`link ${l.id}: target entity missing`);
      const rule = LINK_RULES[l.role];
      if (!rule || !rule.to.includes(l.to.kind) || !(rule.from === l.from.kind || (LINK_FROM_EXTRA[l.role] ?? []).includes(l.from.kind))) problems.push(`link ${l.id}: role/kind mismatch`);
      for (const b of l.bindings ?? []) if (!t || b.to < 1 || b.to > t.versions.length || b.from < 1 || (f && b.from > f.versions.length)) problems.push(`link ${l.id}: binding out of range`);
    } },
    () => { const seen = new Map<string, string>(); for (const l of effectiveLinks(ledger)) {
      if (!MEMBERSHIP_FAMILY.has(l.role) || l.effectiveRole === "removed") continue;
      const k = `${l.from.id}>${l.to.id}`; const prev = seen.get(k);
      if (prev && prev !== l.effectiveRole) problems.push(`membership ${k}: both ${prev} and ${l.effectiveRole}`);
      seen.set(k, l.effectiveRole);
    } },
    () => { for (const c of ledger.corrections) {
      if ((c.type === "field" || c.type === "historical") && !ledger.entities[entityKey(c.ref.kind, c.ref.id)]) problems.push(`correction ${c.id}: entity missing`);
      if (c.type === "link" && !ledger.links[c.linkId]) problems.push(`correction ${c.id}: link missing`);
      if (c.type === "field") { const eff = effectiveContent(ledger, c.ref); const r = eff ? firstRejection({ kind: c.ref.kind, content: eff.content }, ledger) : "entity_missing"; if (r) problems.push(`correction ${c.id}: effective content invalid (${r})`); }
    } },
    () => { for (const [k, e] of Object.entries(ledger.entities)) if (k !== entityKey(e.kind, e.id)) problems.push(`entity key mismatch ${k}`); },
  ];
  for (const check of checks) { try { check(); } catch (e) { problems.push(`invariant_check_error:${(e as Error).message}`); } }
  return problems;
}

// ---------- identity resolution: ONE resolver for corrections, analyses, trace and links ----------
export interface Resolved { ref: Ref; redirectedFrom: string | null }
/**
 * Resolve a possibly retired weak id to the entity that adopted it. A retired id stays valid for lookup, correction and
 * retry; the result says it was redirected. An id shared by several strong candidates is NOT resolved (identity_ambiguous)
 * and lists the candidates, so nothing is silently attached to the first one.
 */
export function resolveRef(ledger: Ledger, ref: Ref): Resolved {
  if (!ref || typeof ref.id !== "string") throw new Error("reference needs kind and id");
  if (ledger.entities[entityKey(ref.kind, ref.id)]) return { ref, redirectedFrom: null };
  const amb = Object.values(ledger.ambiguities).filter((a) => a.alias === ref.id);
  if (amb.length) throw new Error(`identity_ambiguous: ${ref.kind}:${ref.id} maps to several candidates: ${[...new Set(amb.flatMap((a) => [a.a, a.b]))].join(", ")}`);
  const hit = Object.values(ledger.entities).find((e) => e.kind === ref.kind && (e.aliases ?? []).includes(ref.id));
  if (hit) return { ref: { kind: hit.kind, id: hit.id }, redirectedFrom: ref.id };
  return { ref, redirectedFrom: null };
}
/** Ids under which an entity has ever been addressed (its id + retired weak ids): a retried request may use any of them. */
const idVariants = (ledger: Ledger, ref: Ref) => [ref.id, ...(ledger.entities[entityKey(ref.kind, ref.id)]?.aliases ?? [])];

// ---------- corrections ----------
export type CorrectionInput =
  // one atomic correction may change several fields (e.g. occurredAt + timeBasis + precision); validation sees the result as a whole
  | { id: string; type: "field"; ref: Ref; field?: string; after?: unknown; changes?: { field: string; after: unknown }[]; author: string; at: string; reason: string }
  | { id: string; type: "link"; from: Ref; to: Ref; role: LinkRole; afterRole: LinkRole | "removed"; author: string; at: string; reason: string };

const roleFamily = (r: string) => (MEMBERSHIP_FAMILY.has(r) ? "membership" : r === "from_source" || r === "supports" ? "source_ref" : r);
export interface CorrectionResult { ledger: Ledger; action: "new" | "duplicate"; impact: Impact }

/** Full validation runs here, so a dry-run (which stops before persisting) fails for exactly the same reasons as an apply. */
export function applyCorrection(ledger: Ledger, input: CorrectionInput): CorrectionResult {
  if (!isStr(input?.id) || !isStr(input.author) || !isStr(input.reason) || !isStr(input.at)) throw new Error("correction needs id, author, at and reason");
  if (!isValidTimeString(input.at)) throw new Error("correction 'at' is not a valid date/time");
  const existing = ledger.corrections.find((c) => c.id === input.id);
  const none: Impact = { changed: [], entities: [], episodes: [], analyses: [], sourceRevisions: [] };
  if (input.type === "field") {
    const requested = input.ref;
    const ref = resolveRef(ledger, input.ref).ref;
    const changes = input.changes ?? (input.field !== undefined ? [{ field: input.field, after: input.after }] : []);
    if (!changes.length) throw new Error("field correction needs field/after or changes");
    for (const c of changes) assertSafePath(c.field);
    if (new Set(changes.map((c) => c.field)).size !== changes.length) throw new Error("field correction lists a field twice");
    const hashFor = (id: string) => hashOf({ t: "field", ref: { kind: ref.kind, id }, ch: changes.map((c) => [c.field, c.after ?? null]), au: input.author, at: input.at, r: input.reason });
    const reqHash = hashFor(ref.id);
    const prior = ledger.corrections.filter((c) => c.id === input.id || c.id.startsWith(`${input.id}#`));
    // a retry may name the entity by its current id or by any id it was addressed by before an identity upgrade
    const sameRequest = (h: string) => [requested.id, ...idVariants(ledger, ref)].some((v) => hashFor(v) === h);
    if (prior.length) { if (prior.every((c) => sameRequest(c.reqHash))) return { ledger, action: "duplicate", impact: none }; throw new Error(`correction id ${input.id} already used with a different request`); }
    const eff = effectiveContent(ledger, ref);
    if (!eff) throw new Error(`correction target ${ref?.kind}:${ref?.id} does not exist`);
    const next = cloneLedger(ledger);
    changes.forEach((c, i) => next.corrections.push({ id: changes.length > 1 ? `${input.id}#${i}` : input.id, type: "field", ref: ref, field: c.field, before: getPath(eff.content, c.field) ?? null, after: c.after, author: input.author, at: input.at, reason: input.reason, baseVersion: eff.version, reqHash }));
    next.revision++;
    const problems = checkInvariants(next);
    if (problems.length) throw new Error(`correction refused: ${problems[0]}`);
    return { ledger: next, action: "new", impact: computeImpact(next, [ref]) };
  }
  if (input.type !== "link") throw new Error("unknown correction type");
  const requestedLid = linkId(input.from, input.to, input.role);
  input = { ...input, from: resolveRef(ledger, input.from).ref, to: resolveRef(ledger, input.to).ref };
  const lid = linkId(input.from, input.to, input.role);
  const reqHash = hashOf({ t: "link", l: lid, a: input.afterRole, au: input.author, at: input.at, r: input.reason });
  if (existing) {
    // the retry may name the link by its current id or by the id it had when the correction was recorded
    const candidates = [requestedLid, lid, existing.type === "link" ? existing.linkIdAtRecording ?? existing.linkId : ""];
    if (existing.type === "link" && candidates.some((l) => existing.reqHash === hashOf({ t: "link", l, a: input.afterRole, au: input.author, at: input.at, r: input.reason }))) return { ledger, action: "duplicate", impact: none };
    throw new Error(`correction id ${input.id} already used with a different request`);
  }
  const link = ledger.links[lid];
  if (!link) throw new Error(`correction target link ${lid} does not exist`);
  if (input.afterRole !== "removed") {
    const rule = LINK_RULES[input.afterRole];
    if (!rule || !(rule.from === link.from.kind || (LINK_FROM_EXTRA[input.afterRole] ?? []).includes(link.from.kind)) || !rule.to.includes(link.to.kind)) throw new Error(`role ${input.afterRole} is not valid for ${link.from.kind} -> ${link.to.kind}`);
    if (roleFamily(input.afterRole) !== roleFamily(link.role)) throw new Error(`role ${input.afterRole} is a different kind of relation than ${link.role}`);
  }
  const cur = effectiveLinks(ledger).find((l) => l.id === lid)!.effectiveRole;
  const next = cloneLedger(ledger);
  next.corrections.push({ id: input.id, type: "link", linkId: lid, beforeRole: cur === "removed" ? link.role : cur, afterRole: input.afterRole, author: input.author, at: input.at, reason: input.reason, reqHash });
  next.revision++;
  const problems = checkInvariants(next);
  if (problems.length) throw new Error(`correction refused: ${problems[0]}`);
  return { ledger: next, action: "new", impact: computeImpact(next, [input.from, input.to]) };
}

// ---------- analyses & evidence: independent of the fact layer ----------
export function snapshotFor(ledger: Ledger, refs: Ref[], episodeIds: string[], evidence: { id: string; version: string }[]): AnalysisSnapshot {
  const g = new Graph(ledger);
  return { refs: refs.map((ref) => ({ ref, hash: g.closureHash(ref) })), episodes: episodeIds.map((id) => ({ id, hash: g.closureHash({ kind: "episode", id }) })), evidence };
}

export function putAnalysis(ledger: Ledger, input: { id: string; at: string; author: string; body: Content; conditions?: string[]; reassessWhen?: string[]; refs: Ref[]; episodeIds?: string[]; evidence?: { id: string; version: string }[] }): Ledger {
  input = { ...input, refs: input.refs.map((r) => resolveRef(ledger, r).ref) };
  for (const r of input.refs) if (!currentEntity(ledger, r)) throw new Error(`analysis refs missing entity ${r.kind}:${r.id}`);
  for (const id of input.episodeIds ?? []) if (!currentEntity(ledger, { kind: "episode", id })) throw new Error(`analysis refs missing episode ${id}`);
  const next = cloneLedger(ledger);
  const a: Analysis = next.analyses[input.id] ?? (next.analyses[input.id] = { id: input.id, versions: [] });
  a.versions.push({ version: a.versions.length + 1, at: input.at, author: input.author, body: input.body, conditions: input.conditions ?? [], reassessWhen: input.reassessWhen ?? [], snapshot: snapshotFor(next, input.refs, input.episodeIds ?? [], input.evidence ?? []) });
  next.revision++;
  return next;
}
export function registerEvidence(ledger: Ledger, e: { id: string; version: string; status: "valid" | "withdrawn" }): Ledger {
  const next = cloneLedger(ledger); next.evidence[e.id] = e; next.revision++; return next;
}

export type AnalysisStatus = { status: "current" | "stale" | "invalidated"; reasons: string[] };
export function analysisStatus(ledger: Ledger, id: string, graphIn?: Graph): AnalysisStatus {
  const a = ledger.analyses[id];
  if (!a) throw new Error(`no analysis ${id}`);
  const g = graphIn ?? new Graph(ledger);
  const snap = a.versions.at(-1)!.snapshot;
  const reasons: string[] = [];
  let invalid = false;
  for (const r of snap.refs) if (g.closureHash(r.ref) !== r.hash) reasons.push(`fact_or_dependency_changed:${r.ref.kind}:${r.ref.id}`);
  for (const e of snap.episodes) if (g.closureHash({ kind: "episode", id: e.id }) !== e.hash) reasons.push(`episode_or_dependency_changed:${e.id}`);
  for (const ev of snap.evidence) {
    const cur = ledger.evidence[ev.id];
    if (!cur || cur.status === "withdrawn") { reasons.push(`evidence_withdrawn:${ev.id}`); invalid = true; }
    else if (cur.version !== ev.version) reasons.push(`evidence_version_changed:${ev.id}`);
  }
  return { status: invalid ? "invalidated" : reasons.length ? "stale" : "current", reasons };
}

export { businessDigest };
