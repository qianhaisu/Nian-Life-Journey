// HEALTH-02 ledger operations. Everything here is pure: (ledger, input) -> result / new ledger.
// Persistence, locking and atomic write live in file-store.ts.
import {
  EPISODE_MEMBERSHIP_ROLES, LINK_FROM_EXTRA, LINK_RULES, businessDigest, cloneLedger, entityKey, hashOf, linkId,
  type Analysis, type AnalysisSnapshot, type Content, type Correction, type Entity, type EntityKind, type Ledger, type Link, type LinkRole, type Ref,
} from "./model";

// ---------- batch input ----------
export interface BatchLink { role: LinkRole; to: Ref; basis?: string }
export interface BatchItem { kind: EntityKind; id?: string; identity?: "strong" | "weak"; content: Content; links?: BatchLink[] }
export interface StandaloneLink { from: Ref; role: LinkRole; to: Ref; basis?: string }
export interface Batch { batchId: string; items: BatchItem[]; links?: StandaloneLink[] }

export type Action = "new" | "duplicate" | "version_change" | "conflict" | "ambiguous" | "rejected";
export interface PlanItem { ref: Ref; action: Action; reason?: string; detail?: Record<string, unknown> }
export interface PlanLink { id: string; action: "new" | "duplicate" | "conflict" | "held" | "rejected"; reason?: string }
export interface Impact { changed: Ref[]; episodes: string[]; analyses: string[] }
export interface Plan {
  batchId: string; inputHash: string;
  items: PlanItem[]; links: PlanLink[];
  counts: Record<Action, number> & { links_new: number; links_duplicate: number; links_conflict: number; links_held: number };
  rejected: boolean; // any rejected item/link => apply refuses the whole batch
  impact: Impact;
  // internal, consumed by applyPlan
  _apply: { items: { item: BatchItem; id: string; identity: "strong" | "weak"; hash: string; action: "new" | "version_change" }[]; links: { link: Link }[] };
}

// ---------- effective view (base version + corrections) ----------
export function currentEntity(ledger: Ledger, ref: Ref): Entity | undefined { return ledger.entities[entityKey(ref.kind, ref.id)]; }

export function effectiveContent(ledger: Ledger, ref: Ref): { content: Content; version: number; corrections: string[] } | undefined {
  const e = currentEntity(ledger, ref);
  if (!e) return undefined;
  const v = e.versions[e.versions.length - 1];
  const content = structuredClone(v.content);
  const applied: string[] = [];
  for (const c of ledger.corrections) {
    if (c.type === "field" && c.ref.kind === ref.kind && c.ref.id === ref.id) { setPath(content, c.field, c.after); applied.push(c.id); }
  }
  return { content, version: v.version, corrections: applied };
}
export const effectiveHash = (ledger: Ledger, ref: Ref) => { const e = effectiveContent(ledger, ref); return e ? hashOf({ v: e.version, c: e.content }) : "absent"; };

function setPath(obj: Content, path: string, value: unknown) {
  const parts = path.split(".");
  let cur = obj as Record<string, unknown>;
  for (const p of parts.slice(0, -1)) { if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {}; cur = cur[p] as Record<string, unknown>; }
  cur[parts[parts.length - 1]] = value;
}
function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const p of path.split(".")) { if (typeof cur !== "object" || cur === null) return undefined; cur = (cur as Record<string, unknown>)[p]; }
  return cur;
}

export function effectiveLinks(ledger: Ledger): (Link & { effectiveRole: LinkRole | "removed"; correctionId?: string })[] {
  const overlay = new Map<string, { role: LinkRole | "removed"; id: string }>();
  for (const c of ledger.corrections) if (c.type === "link") overlay.set(c.linkId, { role: c.afterRole, id: c.id });
  return Object.values(ledger.links).map((l) => ({ ...l, effectiveRole: overlay.get(l.id)?.role ?? l.role, correctionId: overlay.get(l.id)?.id }));
}

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
export type Validator = (item: BatchItem, ctx: { ledger: Ledger }) => string | null; // returns rejection reason
const PRECISIONS = new Set(["minute", "hour", "day", "month", "year", "range", "approx"]);
const DECLARED_END = new Set(["ongoing", "ended", "end_unknown"]);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export const CONTENT_VALIDATORS: Validator[] = [
  (item) => (typeof item.content !== "object" || item.content === null || Array.isArray(item.content) ? "content_not_object" : null),
  (item) => {
    if (item.kind !== "observation") return null;
    const c = item.content;
    if (!isStr(c.role)) return "observation_role_missing";
    if (!isStr(c.recordedAt)) return "observation_recorded_at_missing";
    if (c.occurredAt != null) {
      if (!isStr(c.occurredAt)) return "occurred_at_not_string";
      if (!isStr(c.occurredPrecision) || !PRECISIONS.has(c.occurredPrecision)) return "occurred_precision_missing";
      if (c.timeBasis === "message_time_only") return "occurred_at_claims_message_time_only";
    } else if (c.timeBasis !== "message_time_only" && c.timeBasis !== "unknown") return "unknown_occurrence_must_declare_time_basis";
    const m = c.measure as { value?: unknown; unit?: unknown } | undefined;
    if (m !== undefined && m !== null) {
      if (m.value === undefined || m.value === null || m.value === "") return "measure_value_missing";
      if (!isStr(m.unit)) return "measure_unit_missing";
    }
    return null;
  },
  (item) => {
    if (item.kind !== "episode") return null;
    const c = item.content;
    if (!isStr(c.title)) return "episode_title_missing";
    if (!isStr(c.declaredEnd) || !DECLARED_END.has(c.declaredEnd)) return "episode_declared_end_invalid";
    if (c.declaredEnd === "ended" && !isStr(c.end)) return "episode_ended_without_end";
    if (c.declaredEnd !== "ended" && c.end) return "episode_end_without_ended_status";
    return null;
  },
  (item) => (item.kind === "encounter" && !isStr(item.content.kind) ? "encounter_kind_missing" : null),
  (item) => (item.kind === "canonical_fact" && (!isStr(item.content.type) || item.content.value === undefined) ? "canonical_fact_incomplete" : null),
];

// ---------- planning (dry-run is exactly this, without applyPlan) ----------
const weakId = (c: Content) => `weak:${hashOf({ k: c.conversation ?? null, t: c.recordedAt ?? null, s: c.speaker ?? null, x: c.text ?? null }).slice(0, 24)}`;

export function planImport(ledger: Ledger, batch: Batch, validators: Validator[] = CONTENT_VALIDATORS): Plan {
  const items: PlanItem[] = [];
  const planLinks: PlanLink[] = [];
  const apply: Plan["_apply"] = { items: [], links: [] };
  const seen = new Map<string, { hash: string; ref: Ref }>(); // in-batch identity -> content
  const held = new Set<string>(); // entity keys not applied (conflict/ambiguous) => dependants held
  const known = new Set(Object.keys(ledger.entities)); // exists after apply (extended below)
  const slotIndex = new Map<string, { id: string; text: unknown }[]>(); // weak-identity twin lookup, built once
  const slotKey = (kind: string, c: Content) => `${kind}|${String(c.conversation)}|${String(c.recordedAt)}|${String(c.speaker)}`;
  for (const e of Object.values(ledger.entities)) {
    const c = e.versions[e.versions.length - 1].content;
    if (c.conversation === undefined) continue;
    const k = slotKey(e.kind, c); (slotIndex.get(k) ?? slotIndex.set(k, []).get(k)!).push({ id: e.id, text: c.text });
  }
  const kinds = new Map<string, EntityKind>();
  for (const k of Object.keys(ledger.entities)) kinds.set(k, ledger.entities[k].kind);

  for (const raw of batch.items) {
    const identity: "strong" | "weak" = raw.identity ?? "strong";
    let id = raw.id;
    if (identity === "weak" && !id) id = weakId(raw.content ?? {});
    const ref: Ref = { kind: raw.kind, id: id ?? "" };
    if (!id) { items.push({ ref, action: "rejected", reason: "no_strong_identity" }); continue; }

    let rejection: string | null = null;
    for (const v of validators) {
      try { rejection = v(raw, { ledger }); } catch (e) { rejection = `validator_error:${(e as Error).message}`; }
      if (rejection) break;
    }
    if (rejection) { items.push({ ref, action: "rejected", reason: rejection }); continue; }

    const key = entityKey(raw.kind, id);
    const hash = hashOf(raw.content);
    const dupe = seen.get(key);
    if (dupe) {
      items.push(dupe.hash === hash ? { ref, action: "duplicate", reason: "repeated_in_batch" } : { ref, action: "conflict", reason: "same_identity_different_content_in_batch" });
      if (dupe.hash !== hash) held.add(key);
      continue;
    }
    seen.set(key, { hash, ref });

    const existing = ledger.entities[key];
    if (!existing) {
      if (identity === "weak") {
        // Weak identity never merges by guess: a same-conversation/time/speaker entity with different text is ambiguous.
        const twins = raw.content.conversation === undefined ? [] : slotIndex.get(slotKey(raw.kind, raw.content)) ?? [];
        const same = twins.find((t) => hashOf(t.text) === hashOf(raw.content.text));
        if (same) { items.push({ ref, action: "duplicate", reason: "weak_identity_matches_existing_slot_and_text", detail: { existingId: same.id } }); continue; }
        if (twins.length) { items.push({ ref, action: "ambiguous", reason: "weak_identity_slot_taken_by_different_text", detail: { existingIds: twins.map((t) => t.id) } }); held.add(key); continue; }
      }
      items.push({ ref, action: "new" });
      apply.items.push({ item: raw, id, identity, hash, action: "new" });
      known.add(key); kinds.set(key, raw.kind);
      continue;
    }
    if (existing.versions.some((v) => v.hash === hash)) {
      items.push({ ref, action: "duplicate", reason: existing.versions[existing.versions.length - 1].hash === hash ? "same_as_current" : "same_as_older_version_not_revived" });
      continue;
    }
    const prev = existing.versions[existing.versions.length - 1].content;
    const unitChange = unitChanged(prev, raw.content);
    if (unitChange) { items.push({ ref, action: "conflict", reason: "unit_changed", detail: unitChange }); held.add(key); continue; }
    const changed = changedFields(prev, raw.content);
    const shadowed = ledger.corrections.filter((c) => c.type === "field" && c.ref.kind === raw.kind && c.ref.id === id && changed.some((f) => f === c.field || f.startsWith(`${c.field}.`) || c.field.startsWith(`${f}.`))).map((c) => (c as Extract<Correction, { type: "field" }>).field);
    items.push({ ref, action: "version_change", detail: { changedFields: changed, shadowedByCorrection: [...new Set(shadowed)] } });
    apply.items.push({ item: raw, id, identity: existing.identity, hash, action: "version_change" });
  }

  // links: validated against ledger ∪ applied batch items; held/dangling targets are reported, never guessed.
  const membershipRoleOf = new Map<string, LinkRole>();
  for (const l of effectiveLinks(ledger)) if (EPISODE_MEMBERSHIP_ROLES.includes(l.role)) membershipRoleOf.set(`${l.from.id}>${l.to.id}`, l.effectiveRole as LinkRole);
  const rejectedKeys = new Set(items.filter((i) => i.action === "rejected").map((i) => entityKey(i.ref.kind, i.ref.id)));
  const decls: { from: Ref; bl: BatchLink }[] = [];
  for (const raw of batch.items) {
    const fromId = raw.id ?? (raw.identity === "weak" ? weakId(raw.content ?? {}) : undefined);
    if (fromId && !rejectedKeys.has(entityKey(raw.kind, fromId))) for (const bl of raw.links ?? []) decls.push({ from: { kind: raw.kind, id: fromId }, bl });
  }
  for (const l of batch.links ?? []) decls.push({ from: l.from, bl: { role: l.role, to: l.to, basis: l.basis } });
  for (const { from: fromRef, bl } of decls) {
    const fromKey = entityKey(fromRef.kind, fromRef.id);
    const lid = linkId(fromRef, bl.to, bl.role);
    const rule = LINK_RULES[bl.role];
    const fromOk = rule && (rule.from === fromRef.kind || (LINK_FROM_EXTRA[bl.role] ?? []).includes(fromRef.kind));
    if (!rule || !fromOk) { planLinks.push({ id: lid, action: "rejected", reason: "role_not_allowed_from_kind" }); continue; }
    const toKey = entityKey(bl.to.kind, bl.to.id);
    if ((held.has(toKey) && !ledger.entities[toKey]) || (held.has(fromKey) && !ledger.entities[fromKey])) { planLinks.push({ id: lid, action: "held", reason: "endpoint_held" }); continue; }
    if (!known.has(fromKey)) { planLinks.push({ id: lid, action: "rejected", reason: "dangling_source" }); continue; }
    if (!known.has(toKey)) { planLinks.push({ id: lid, action: "rejected", reason: "dangling_target" }); continue; }
    if (kinds.get(toKey) !== bl.to.kind || !rule.to.includes(bl.to.kind)) { planLinks.push({ id: lid, action: "rejected", reason: "wrong_target_kind" }); continue; }
    if (ledger.links[lid] || apply.links.some((a) => a.link.id === lid)) { planLinks.push({ id: lid, action: "duplicate" }); continue; }
    if (EPISODE_MEMBERSHIP_ROLES.includes(bl.role)) {
      const prior = membershipRoleOf.get(`${fromRef.id}>${bl.to.id}`);
      const inBatch = apply.links.find((a) => a.link.from.id === fromRef.id && a.link.to.id === bl.to.id && EPISODE_MEMBERSHIP_ROLES.includes(a.link.role));
      if ((prior && prior !== bl.role) || (inBatch && inBatch.link.role !== bl.role)) { planLinks.push({ id: lid, action: "conflict", reason: "membership_role_conflict" }); continue; }
    }
    apply.links.push({ link: { id: lid, from: fromRef, to: bl.to, role: bl.role, basis: bl.basis, runId: "" } });
    planLinks.push({ id: lid, action: "new" });
  }

  const counts = { new: 0, duplicate: 0, version_change: 0, conflict: 0, ambiguous: 0, rejected: 0, links_new: 0, links_duplicate: 0, links_conflict: 0, links_held: 0 };
  for (const i of items) counts[i.action]++;
  for (const l of planLinks) { if (l.action === "new") counts.links_new++; else if (l.action === "duplicate") counts.links_duplicate++; else if (l.action === "conflict") counts.links_conflict++; else if (l.action === "held") counts.links_held++; else counts.rejected++; }
  const rejected = items.some((i) => i.action === "rejected") || planLinks.some((l) => l.action === "rejected");
  const changedRefs: Ref[] = apply.items.map((a) => ({ kind: a.item.kind, id: a.id }));
  const linkAdds = apply.links.map((a) => a.link);
  return { batchId: batch.batchId, inputHash: hashOf(batch), items, links: planLinks, counts, rejected, impact: computeImpact(ledger, changedRefs, linkAdds), _apply: apply };
}

function changedFields(a: Content, b: Content): string[] {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (hashOf(a[k]) !== hashOf(b[k])) out.push(k);
  return out.sort();
}
function unitChanged(a: Content, b: Content): Record<string, unknown> | null {
  for (const path of ["measure.unit", "dose.unit", "unit"]) {
    const x = getPath(a, path), y = getPath(b, path);
    if (x !== undefined && y !== undefined && x !== y) return { field: path, before: x, after: y };
  }
  return null;
}

/** Who depends on the changed refs: episodes (by membership/encounter/direct) and analyses whose snapshot includes them. */
export function computeImpact(ledger: Ledger, changed: Ref[], newLinks: Link[] = []): Impact {
  const episodes = new Set<string>();
  const allLinks = [...effectiveLinks(ledger), ...newLinks.map((l) => ({ ...l, effectiveRole: l.role as LinkRole | "removed" }))];
  const changedKeys = new Set(changed.map((r) => entityKey(r.kind, r.id)));
  for (const r of changed) if (r.kind === "episode") episodes.add(r.id);
  for (const l of allLinks) {
    if (l.to.kind === "episode" && EPISODE_MEMBERSHIP_ROLES.includes(l.role) && changedKeys.has(entityKey(l.from.kind, l.from.id))) episodes.add(l.to.id);
    if (l.role === "encounter" && changedKeys.has(entityKey("encounter", l.to.id))) episodes.add(l.from.id);
  }
  for (const l of newLinks) { if (l.to.kind === "episode") episodes.add(l.to.id); if (l.from.kind === "episode") episodes.add(l.from.id); }
  const analyses = new Set<string>();
  for (const a of Object.values(ledger.analyses)) {
    const snap = a.versions[a.versions.length - 1].snapshot;
    if (snap.refs.some((r) => changedKeys.has(entityKey(r.ref.kind, r.ref.id))) || snap.episodes.some((e) => episodes.has(e.id))) analyses.add(a.id);
  }
  return { changed, episodes: [...episodes].sort(), analyses: [...analyses].sort() };
}

// ---------- apply (pure: returns new ledger) ----------
export function applyPlan(ledger: Ledger, plan: Plan, meta: { runId: string; at: string }): Ledger {
  if (plan.rejected) throw new Error(`batch ${plan.batchId} rejected; nothing written`);
  const next = cloneLedger(ledger);
  for (const a of plan._apply.items) {
    const key = entityKey(a.item.kind, a.id);
    const e = next.entities[key] ?? (next.entities[key] = { kind: a.item.kind, id: a.id, identity: a.identity, versions: [] });
    e.versions.push({ version: e.versions.length + 1, hash: a.hash, content: a.item.content, runId: meta.runId, at: meta.at });
  }
  for (const l of plan._apply.links) next.links[l.link.id] = { ...l.link, runId: meta.runId };
  const c = plan.counts;
  next.runs.push({ runId: meta.runId, at: meta.at, mode: "apply", batchId: plan.batchId, inputHash: plan.inputHash, counts: { new: c.new, duplicate: c.duplicate, version_change: c.version_change, conflict: c.conflict, ambiguous: c.ambiguous, links_new: c.links_new, links_duplicate: c.links_duplicate, links_conflict: c.links_conflict, links_held: c.links_held } });
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
    } },
    () => { const seen = new Map<string, string>(); for (const l of effectiveLinks(ledger)) {
      if (!EPISODE_MEMBERSHIP_ROLES.includes(l.role) || l.effectiveRole === "removed") continue;
      const k = `${l.from.id}>${l.to.id}`; const prev = seen.get(k);
      if (prev && prev !== l.effectiveRole) problems.push(`membership ${k}: both ${prev} and ${l.effectiveRole}`);
      seen.set(k, l.effectiveRole);
    } },
    () => { for (const c of ledger.corrections) { if (c.type === "field" && !ledger.entities[entityKey(c.ref.kind, c.ref.id)]) problems.push(`correction ${c.id}: entity missing`); if (c.type === "link" && !ledger.links[c.linkId]) problems.push(`correction ${c.id}: link missing`); } },
  ];
  for (const check of checks) { try { check(); } catch (e) { problems.push(`invariant_check_error:${(e as Error).message}`); } }
  return problems;
}

// ---------- corrections ----------
export type CorrectionInput =
  | { id: string; type: "field"; ref: Ref; field: string; after: unknown; author: string; at: string; reason: string }
  | { id: string; type: "link"; from: Ref; to: Ref; role: LinkRole; afterRole: LinkRole | "removed"; author: string; at: string; reason: string };

export function applyCorrection(ledger: Ledger, input: CorrectionInput): { ledger: Ledger; action: "new" | "duplicate"; impact: Impact } {
  if (!input.author || !input.reason || !input.at) throw new Error("correction needs author, at and reason");
  const existing = ledger.corrections.find((c) => c.id === input.id);
  if (input.type === "field") {
    const eff = effectiveContent(ledger, input.ref);
    if (!eff) throw new Error(`correction target ${input.ref.kind}:${input.ref.id} does not exist`);
    if (existing) {
      if (existing.type === "field" && hashOf(existing.after) === hashOf(input.after) && existing.field === input.field) return { ledger, action: "duplicate", impact: { changed: [], episodes: [], analyses: [] } };
      throw new Error(`correction id ${input.id} already used with different content`);
    }
    const before = getPath(eff.content, input.field);
    const next = cloneLedger(ledger);
    next.corrections.push({ id: input.id, type: "field", ref: input.ref, field: input.field, before: before ?? null, after: input.after, author: input.author, at: input.at, reason: input.reason, baseVersion: eff.version });
    next.revision++;
    return { ledger: next, action: "new", impact: computeImpact(next, [input.ref]) };
  }
  const lid = linkId(input.from, input.to, input.role);
  const link = ledger.links[lid];
  if (!link) throw new Error(`correction target link ${lid} does not exist`);
  if (existing) {
    if (existing.type === "link" && existing.linkId === lid && existing.afterRole === input.afterRole) return { ledger, action: "duplicate", impact: { changed: [], episodes: [], analyses: [] } };
    throw new Error(`correction id ${input.id} already used with different content`);
  }
  const cur = effectiveLinks(ledger).find((l) => l.id === lid)!.effectiveRole;
  const next = cloneLedger(ledger);
  next.corrections.push({ id: input.id, type: "link", linkId: lid, beforeRole: cur === "removed" ? link.role : cur, afterRole: input.afterRole, author: input.author, at: input.at, reason: input.reason });
  next.revision++;
  const problems = checkInvariants(next);
  if (problems.length) throw new Error(`correction breaks invariants: ${problems[0]}`);
  return { ledger: next, action: "new", impact: computeImpact(next, [input.from]) };
}

// ---------- analyses & evidence: independent of the fact layer ----------
export function snapshotFor(ledger: Ledger, refs: Ref[], episodeIds: string[], evidence: { id: string; version: string }[]): AnalysisSnapshot {
  return {
    refs: refs.map((ref) => ({ ref, effHash: effectiveHash(ledger, ref) })),
    episodes: episodeIds.map((id) => ({ id, membershipHash: hashOf({ m: membership(ledger, id), e: effectiveHash(ledger, { kind: "episode", id }) }) })),
    evidence,
  };
}

export function putAnalysis(ledger: Ledger, input: { id: string; at: string; author: string; body: Content; conditions?: string[]; reassessWhen?: string[]; refs: Ref[]; episodeIds?: string[]; evidence?: { id: string; version: string }[] }): Ledger {
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
export function analysisStatus(ledger: Ledger, id: string): AnalysisStatus {
  const a = ledger.analyses[id];
  if (!a) throw new Error(`no analysis ${id}`);
  const snap = a.versions[a.versions.length - 1].snapshot;
  const reasons: string[] = [];
  let invalid = false;
  for (const r of snap.refs) if (effectiveHash(ledger, r.ref) !== r.effHash) reasons.push(`fact_changed:${r.ref.kind}:${r.ref.id}`);
  for (const e of snap.episodes) {
    const now = hashOf({ m: membership(ledger, e.id), e: effectiveHash(ledger, { kind: "episode", id: e.id }) });
    if (now !== e.membershipHash) reasons.push(`episode_changed:${e.id}`);
  }
  for (const ev of snap.evidence) {
    const cur = ledger.evidence[ev.id];
    if (!cur || cur.status === "withdrawn") { reasons.push(`evidence_withdrawn:${ev.id}`); invalid = true; }
    else if (cur.version !== ev.version) reasons.push(`evidence_version_changed:${ev.id}`);
  }
  return { status: invalid ? "invalidated" : reasons.length ? "stale" : "current", reasons };
}

export { businessDigest };
