// HEALTH-M01-A impact identification: what changed in the ledgers since a stored baseline, which episodes it touches, and where
// new own-child records that belong to no episode go. It is a deterministic, replay-safe DIFF (same inputs -> same result), never a
// write into the fact ledgers and never a decision: an unattached record is listed with the episodes near it as a lead for a person
// to decide, it is not attached by date closeness, and it never extends a red span.
import { Graph, effectiveContent } from "../graph";
import { effectiveHash } from "../ledger";
import { entityKey, hashOf, type Ledger } from "../model";
import { buildTimeline } from "../timeline";
import { stateOf, versionsOf, type AnalysisFile } from "./analysis";
import { exclusionReason } from "./model";

const KINDS = new Set(["observation", "canonical_fact", "encounter", "episode", "source"]);
export interface Baseline { schema: 1; createdAt: string; history: Record<string, string>; record: Record<string, string>; episodes: Record<string, string> }
export interface Sides { history: Ledger | null; record: Ledger | null }

const hashes = (L: Ledger | null): Record<string, string> => Object.fromEntries(Object.values(L?.entities ?? {}).filter((e) => KINDS.has(e.kind)).map((e) => [entityKey(e.kind, e.id), effectiveHash(L!, { kind: e.kind, id: e.id })]).sort(([a], [b]) => (a < b ? -1 : 1)));
export function makeBaseline(s: Sides, createdAt: string): Baseline {
  const g = s.history ? new Graph(s.history) : null;
  const episodes = Object.fromEntries(Object.values(s.history?.entities ?? {}).filter((e) => e.kind === "episode").map((e) => [e.id, g!.closureHash({ kind: "episode", id: e.id })]));
  return { schema: 1, createdAt, history: hashes(s.history), record: hashes(s.record), episodes };
}

export interface ChangedEntity { ledger: "history" | "record"; key: string; change: "new" | "modified" | "removed"; version: number; hash: string }
export interface Lead { ledger: "history" | "record"; id: string; date: string | null; clip: string; from: string; near: { episodeId: string; title: string; gapDays: number }[]; hasReportImages: boolean; action: string }
export interface Impact {
  baselineAt: string; changed: ChangedEntity[];
  affectedEpisodes: { episodeId: string; title: string; reasons: string[]; changedMembers: string[]; analysis: { id: string; shown: string; reasons: string[] } | null }[];
  attachedNew: { ledger: "history"; id: string; episodeId: string }[];
  leads: Lead[];
  excluded: Record<string, string[]>;
  newSources: Record<string, number>;
  digest: string;
}
const day = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const gap = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const NEAR_DAYS = 14;

export function computeImpact(s: Sides, analyses: AnalysisFile | null, base: Baseline | null, asOf: string): Impact {
  const H = s.history;
  const changed: ChangedEntity[] = [];
  for (const [name, L] of [["history", H], ["record", s.record]] as const) {
    if (!L) continue;
    const cur = hashes(L), old = (name === "history" ? base?.history : base?.record) ?? {};
    for (const [k, h] of Object.entries(cur)) if (old[k] !== h) changed.push({ ledger: name, key: k, change: old[k] === undefined ? "new" : "modified", version: L.entities[k].versions.length, hash: h });
    for (const k of Object.keys(old)) if (!(k in cur)) changed.push({ ledger: name, key: k, change: "removed", version: 0, hash: "" });
  }
  changed.sort((a, b) => `${a.ledger}${a.key}`.localeCompare(`${b.ledger}${b.key}`));
  const changedHist = new Set(changed.filter((c) => c.ledger === "history").map((c) => c.key));

  const tl = H ? buildTimeline(H, { asOf: asOf.slice(0, 10) }) : null;
  const g = H ? new Graph(H) : null;
  const title = new Map((tl?.blocks ?? []).map((b) => [b.episodeId, clean(b.title)]));
  const epOf = new Map<string, string>();
  for (const b of tl?.blocks ?? []) for (const i of b.items) epOf.set(i.observationId, b.episodeId);

  const affected: Impact["affectedEpisodes"] = [];
  for (const b of tl?.blocks ?? []) {
    const reasons: string[] = [];
    const now = g!.closureHash({ kind: "episode", id: b.episodeId });
    if (base && base.episodes[b.episodeId] === undefined) reasons.push("底账里新出现的病程");
    else if (base && base.episodes[b.episodeId] !== now) reasons.push("这一病程的成员、就诊、医院事实、来源或更正与基线不同");
    const members = g!.dependenciesOf(entityKey("episode", b.episodeId)).filter((k) => changedHist.has(k) && k !== entityKey("episode", b.episodeId));
    const mine = analyses ? versionsOf(analyses, b.episodeId).filter((v) => ["draft", "pending_review", "adopted"].includes(v.events[v.events.length - 1].status)).pop() : undefined;
    const st = mine ? stateOf(s, mine, g!) : null;
    if (st?.shown === "expired") reasons.push(`已有的分析 ${st.id} 依据的事实已变，需要重新分析`);
    if (reasons.length) affected.push({ episodeId: b.episodeId, title: clean(b.title), reasons, changedMembers: members.sort(), analysis: st ? { id: st.id, shown: st.shown, reasons: st.reasons } : null });
  }

  const leads: Lead[] = [];
  const attachedNew: Impact["attachedNew"] = [];
  const excluded: Impact["excluded"] = {};
  // an episode is "near" a date when the date falls from its start (minus 3 days) to its last known activity plus 14 days; this only lists leads for a person
  const active = (tl?.blocks ?? []).map((b) => ({ id: b.episodeId, start: day(b.start), last: [day(b.end), day(b.lastUpdate), ...b.encounters.map((x) => day(x.date)), ...b.items.map((i) => day(i.displayTime)), day(b.start)].filter((x): x is string => !!x).sort().pop() ?? null }));
  const near = (d: string | null) => (d ? active.filter((a) => a.start && a.last && d >= addDays(a.start, -3) && d <= addDays(a.last, NEAR_DAYS)).map((a) => ({ episodeId: a.id, title: title.get(a.id) ?? a.id, gapDays: d > a.last! ? gap(d, a.last!) : 0 })) : []);
  for (const c of changed) {
    if (c.change === "removed") continue;
    const L = c.ledger === "history" ? H! : s.record!;
    const [kind, ...rest] = c.key.split(":"); const id = rest.join(":");
    if (kind !== "observation") continue;
    const cc = effectiveContent(L, { kind: "observation", id })!.content;
    if (c.ledger === "history") {
      if (cc.attribution === "not_child") { (excluded["标为不是孩子的记录"] ??= []).push(id); continue; }
      const why = exclusionReason(cc);
      if (why) { (excluded[why] ??= []).push(id); continue; }
      const ep = epOf.get(id);
      if (ep) { attachedNew.push({ ledger: "history", id, episodeId: ep }); continue; }
      const d = day(cc.occurredAt) ?? day(cc.recordedAt);
      leads.push({ ledger: "history", id, date: d, clip: clean(cc.text).slice(0, 60), from: clean(cc.speaker), near: near(d), hasReportImages: false, action: "未归属：待人工确认是否属于某个病程；不按日期接近自动归属，也不延长红色区间" });
    } else {
      if (cc.layer !== "health_record" || cc.attribution === "not_child") { (excluded["家长记录里标为不是孩子或不是健康记录"] ??= []).push(id); continue; }
      const d = day(cc.occurredAt) ?? day(cc.recordedAt);
      const imgs = Array.isArray(cc.images) && cc.images.length > 0;
      leads.push({ ledger: "record", id, date: d, clip: clean(cc.text ?? cc.note ?? (cc.kind === "visit" ? "就医资料" : "")).slice(0, 60), from: clean(cc.speaker), near: near(d), hasReportImages: imgs,
        action: imgs ? "家长记录（含报告图）：图只登记为材料，没有识读（OCR 另批）；未归属，待人工确认" : "家长记录：未归属，待人工确认是否属于某个病程" });
    }
  }
  const newSources: Record<string, number> = {};
  for (const c of changed) if (c.ledger === "history" && c.change === "new" && c.key.startsWith("source:")) { const l = String((effectiveContent(H!, { kind: "source", id: c.key.slice(7) })?.content ?? {}).layer ?? "unknown"); newSources[l] = (newSources[l] ?? 0) + 1; }
  const body = { changed, affected, attachedNew, leads, excluded, newSources };
  return { baselineAt: base?.createdAt ?? "(no baseline: everything counts as new)", changed, affectedEpisodes: affected, attachedNew, leads, excluded, newSources, digest: hashOf(body).slice(0, 16) };
}
function addDays(d: string, n: number) { return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10); }
