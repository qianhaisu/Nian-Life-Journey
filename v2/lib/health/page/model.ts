// HEALTH-04 health page model: one pure function over
//   - the HEALTH-02 history ledger (read-only),
//   - the HEALTH-03 record ledger (parents' notes and visit materials, corrections applied),
//   - a reviewed interval file (which spans the records actually support) and
//   - a reviewed follow-up materials file (text taken from already-reviewed documents, with source, version and conditions).
// Nothing here guesses a span: red only comes from a reviewed interval whose supporting records are still exactly what was
// reviewed. A changed/voided support, or a new record inside the span, turns the interval into "needs review" instead of
// silently keeping the old verdict. Scattered records are nodes, never a span. No green, no day counts, no ratios.
import { effectiveContent } from "../graph";
import { effectiveHash } from "../ledger";
import { entityKey, type Content, type Ledger, type Ref } from "../model";
import { buildTimeline, type EncounterView, type FactView, type SourceRef } from "../timeline";

// ---------- reviewed inputs ----------
export interface ReviewedRef { ref: Ref; ledger: "history" | "record"; hash: string; note?: string }
export interface IntervalReview {
  id: string;
  /** recorded: one record states the span itself (e.g. 「咳嗽10天余」). suspected: several records read together (continuity words), marked 疑似. */
  kind: "recorded" | "suspected";
  episodeId: string | null;
  start: string; startApprox?: boolean;
  end: string; endKind: "recovered" | "last_record";
  label: string;
  supports: ReviewedRef[];
  counter?: ReviewedRef[];
  reason: string;
  timeNote?: string;
}
export interface EnrolmentReview { date: string; basis: string; sources: { conversation: string; at: string; textSha256: string }[]; parentConfirmed: boolean }
/** nodes: scattered records that were read in the review and belong on the timeline as single points (never a span). */
export interface IntervalFile { schema: 1; reviewedAt: string; reviewer: string; intervals: IntervalReview[]; nodes?: ReviewedRef[]; enrolment?: EnrolmentReview | null }

export interface MaterialItem {
  id: string; group: "care" | "visit";
  kind: "conditional" | "care" | "next_visit";
  text: string; detail?: string;
  source: { file: string; sha256: string; section: string; lines: string };
  version: string; conditions: string[]; reassessWhen: string[]; episodes?: string[];
}
export interface MaterialsFile { schema: 1; generatedAt: string; dataCutoff: string; reviewedBy: string; items: MaterialItem[] }

// ---------- output ----------
export type NodeKind = "fever" | "visit" | "exam" | "dot";
export interface Attachment { href: string; label: string }
export interface PageEntry {
  id: string; ledger: "history" | "record"; date: string; time: string | null; timeKind: "occurred" | "recorded";
  kind: NodeKind; title: string; text: string; who: string | null; sourceLabel: string;
  episode: { id: string; title: string } | null; attachments: Attachment[];
}
export interface PageNode { id: string; date: string; kind: NodeKind; unassigned: boolean; entries: PageEntry[] }
export interface BandRef { id: string; date: string; text: string }
export interface PageBand {
  id: string; kind: "recorded" | "suspected" | "open"; start: string; end: string; startApprox: boolean;
  episodeId: string | null; label: string; status: "ok" | "needs_review"; statusReasons: string[];
  explain: string; timeNote: string | null; supports: BandRef[]; counter: BandRef[];
}
export interface PageVisit { id: string; date: string; kindLabel: string; countsAsVisit: boolean; hospital: string; dept: string; diagnoses: string[]; prescriptions: string[]; reports: Attachment[] }
export interface PageEpisode {
  id: string; title: string; category: "resp" | "fever" | "burn" | "other";
  start: string | null; startNote: string | null; end: string | null; endKnown: boolean; endNote: string | null;
  course: { date: string; text: string }[];
  summary: { points: string[]; open: string[]; medical: string };
  visits: PageVisit[];
}
export interface FollowUpItem { id: string; kind: MaterialItem["kind"]; text: string; detail: string | null; episodes: { id: string; title: string }[] }
export interface HealthReminder { id: string; date: string; title: string; place: string }
export interface HealthPage {
  asOf: string | null; years: number[]; defaultYear: number;
  nodes: PageNode[]; bands: PageBand[];
  episodes: PageEpisode[];
  followUp: { care: FollowUpItem[]; visit: FollowUpItem[]; status: "current" | "stale" | "missing"; basisDate: string | null; staleReason: string | null };
  enrolment: { date: string; note: string } | null;
  reminders: HealthReminder[];
  pendingIntervals: string[];
  inputs: { history: boolean; records: boolean; intervals: boolean; materials: boolean };
}

export interface PageInputs {
  history: Ledger | null; record: Ledger | null;
  intervals: IntervalFile | null; materials: MaterialsFile | null;
  now: string; // Shanghai wall clock YYYY-MM-DDTHH:mm
}

const HISTORY_ROLES = new Set(["observation", "relay", "recall", "medication_administered"]);
const day = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const clean = (s: unknown) => String(s ?? "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Fever icon only: a reading >= 37.5 ℃ or an explicit fever word that is not negated. Never used to draw a span. */
export function looksFeverish(text: string): boolean {
  for (const m of text.matchAll(/(3[5-9]|4[0-2])\.(\d)/g)) if (Number(m[0]) >= 37.5 && !/以下/.test(text.slice(m.index! + m[0].length, m.index! + m[0].length + 3))) return true;
  if (/(没|不|无|未)(发)?(烧|发热)|烧(退|彻底退)|退(烧|热)|体温正常|都正常/.test(text)) return false;
  return /(发烧|发热|低烧|高烧|低热|高热|有点烧)/.test(text);
}
export function categoryOf(title: string): PageEpisode["category"] {
  if (/烫伤|烧伤/.test(title)) return "burn";
  if (/咳|鼻|支气管|肺|咽|呼吸|流涕|喘|感冒/.test(title)) return "resp";
  if (/发热|发烧/.test(title)) return "fever";
  return "other";
}
const historyHref = (sourceId: string) => `/api/health-record/history-originals/${encodeURIComponent(sourceId)}`;
const recordHref = (sha: string) => `/api/health-record/originals/${sha}`;

function docLabel(history: Ledger, id: string): string {
  const e = history.entities[entityKey("source", id)];
  const c = (e ? effectiveContent(history, { kind: "source", id })?.content : undefined) as Content | undefined;
  return clean(c?.docKind) || "报告";
}
function reportsOf(history: Ledger, docs: SourceRef[]): Attachment[] {
  const seen = new Set<string>();
  const out: Attachment[] = [];
  for (const d of docs) {
    if (seen.has(d.id)) continue;
    const c = effectiveContent(history, { kind: "source", id: d.id })?.content;
    if (!c || c.layer !== "hospital_document") continue;
    seen.add(d.id);
    out.push({ href: historyHref(d.id), label: docLabel(history, d.id) });
  }
  const n = new Map<string, number>();
  return out.map((a) => { const k = (n.get(a.label) ?? 0) + 1; n.set(a.label, k); return k > 1 ? { ...a, label: `${a.label} ${k}` } : a; });
}
function prescriptionText(f: FactView): string {
  const s = f.structured as Record<string, unknown> | null;
  if (s && s.name) return [s.name, s.dose, s.freq, s.route].filter((x) => x !== null && x !== undefined && x !== "").map(String).join(" · ");
  return clip(clean(f.displayValue), 60);
}
function visitOf(history: Ledger, e: EncounterView): PageVisit {
  const facts = e.facts;
  // "1. 急性鼻窦炎 2. 肺炎" and "肺炎" are the same diagnoses written differently: split numbered lists, drop numbering, dedupe
  const diag = [...new Set(facts.filter((f) => f.type === "diagnosis").flatMap((f) => clean(f.displayValue).split(/\s+(?=\d+[.、．])/)).map((d) => d.replace(/^\d+[.、．]\s*/, "").replace(/[,，。；;\s]+$/, "")).filter(Boolean))];
  const rx = facts.filter((f) => f.type === "medication_prescribed").map(prescriptionText);
  const factDocs = facts.flatMap((f) => f.documents);
  return { id: e.id, date: String(e.date ?? ""), kindLabel: e.kindLabel, countsAsVisit: e.countsAsVisit, hospital: clean(e.hospital) || "医院未记录", dept: clean(e.dept), diagnoses: diag, prescriptions: rx, reports: reportsOf(history, [...e.documents, ...factDocs]) };
}

interface RefCheck { ok: boolean; why: string | null; date: string | null; text: string }
function checkRef(inp: PageInputs, r: ReviewedRef): RefCheck {
  const L = r.ledger === "history" ? inp.history : inp.record;
  if (!L) return { ok: false, why: "依据所在的资料没有接通", date: null, text: "" };
  const eff = effectiveContent(L, r.ref);
  if (!eff) return { ok: false, why: `依据 ${r.ref.id} 已不在资料里`, date: null, text: "" };
  const c = eff.content;
  const date = day(c.occurredAt) ?? day(c.recordedAt) ?? day(c.date);
  const text = clip(clean(c.text ?? c.value ?? c.note ?? ""), 90);
  if (c.attribution === "not_child") return { ok: false, why: `依据 ${r.ref.id} 已被标为不是孩子的记录`, date, text };
  if (effectiveHash(L, r.ref) !== r.hash) return { ok: false, why: `依据 ${r.ref.id} 核查后被修改过`, date, text };
  return { ok: true, why: null, date, text };
}

export function buildHealthPage(inp: PageInputs): HealthPage {
  const H = inp.history, R = inp.record;
  const nowDay = inp.now.slice(0, 10);
  const tl = H ? buildTimeline(H, { asOf: nowDay }) : null;
  const epTitle = new Map((tl?.blocks ?? []).map((b) => [b.episodeId, clean(b.title)]));
  const epOf = new Map<string, string>();
  for (const b of tl?.blocks ?? []) for (const i of b.items) epOf.set(i.observationId, b.episodeId);

  // ----- bands -----
  const reviewedIds = new Set<string>();
  const bands: PageBand[] = [];
  const reviewedAt = inp.intervals?.reviewedAt ?? "";
  const newAfterReview: { date: string; id: string; ledger: string }[] = [];
  for (const [name, L] of [["history", H], ["record", R]] as const) {
    if (!L) continue;
    for (const e of Object.values(L.entities)) {
      if (e.kind !== "observation" || e.versions[0].at <= reviewedAt) continue;
      const c = effectiveContent(L, { kind: "observation", id: e.id })!.content;
      if (c.attribution === "not_child" || c.role === "summary_relay") continue;
      const d = day(c.occurredAt) ?? day(c.recordedAt);
      if (d) newAfterReview.push({ date: d, id: e.id, ledger: name });
    }
  }
  for (const r of inp.intervals?.nodes ?? []) if (checkRef(inp, r).ok) reviewedIds.add(`${r.ledger}:${r.ref.id}`);
  for (const iv of inp.intervals?.intervals ?? []) {
    const reasons: string[] = [];
    const sup: BandRef[] = [], ctr: BandRef[] = [];
    for (const r of iv.supports) { reviewedIds.add(`${r.ledger}:${r.ref.id}`); const c = checkRef(inp, r); if (!c.ok) reasons.push(c.why!); sup.push({ id: r.ref.id, date: c.date ?? "", text: r.note ?? c.text }); }
    for (const r of iv.counter ?? []) { reviewedIds.add(`${r.ledger}:${r.ref.id}`); const c = checkRef(inp, r); if (!c.ok) reasons.push(c.why!); ctr.push({ id: r.ref.id, date: c.date ?? "", text: r.note ?? c.text }); }
    const lo = addDays(iv.start, -1), hi = addDays(iv.end, 3);
    for (const n of newAfterReview) if (n.date >= lo && n.date <= hi && !reviewedIds.has(`${n.ledger}:${n.id}`)) reasons.push(`核查之后又有 ${md(n.date)} 的新记录落在这段时间附近`);
    const explain = iv.kind === "recorded"
      ? `原文写明的持续时间：${iv.reason}`
      : `疑似持续：${iv.reason}（这是把几条记录连起来看的判断，不是原文直接写的时长）`;
    bands.push({ id: iv.id, kind: iv.kind, start: iv.start, end: iv.end, startApprox: !!iv.startApprox, episodeId: iv.episodeId, label: iv.label, status: reasons.length ? "needs_review" : "ok", statusReasons: [...new Set(reasons)], explain, timeNote: iv.timeNote ?? null, supports: sup, counter: ctr });
  }
  // an episode with an unknown end and no reviewed span only gets a short visual fade at its start: never a length
  for (const b of tl?.blocks ?? []) {
    const s = day(b.start);
    if (!s || bands.some((x) => x.episodeId === b.episodeId || (x.kind !== "open" && x.start <= s && s <= x.end))) continue;
    bands.push({ id: `open-${b.episodeId}`, kind: "open", start: s, end: s, startApprox: false, episodeId: b.episodeId, label: epTitle.get(b.episodeId) ?? "", status: "ok", statusReasons: [], explain: "只知道开始，之后怎样没有记录；色带不代表持续了多久。", timeNote: null, supports: [], counter: [] });
  }

  // ----- entries -> nodes -----
  const entries: PageEntry[] = [];
  if (H && tl) {
    const inReview = new Set([...reviewedIds].filter((k) => k.startsWith("history:")).map((k) => k.slice(8)));
    for (const e of Object.values(H.entities)) {
      if (e.kind !== "observation") continue;
      const eff = effectiveContent(H, { kind: "observation", id: e.id })!;
      const c = eff.content;
      const ep = epOf.get(e.id) ?? null;
      if (!(ep && HISTORY_ROLES.has(String(c.role))) && !inReview.has(e.id)) continue;
      if (c.attribution === "not_child") continue;
      const occurred = day(c.occurredAt);
      const d = occurred ?? day(c.recordedAt);
      if (!d) continue;
      const text = clean(c.text);
      entries.push({ id: e.id, ledger: "history", date: d, time: typeof c.recordedAt === "string" ? c.recordedAt.slice(11, 16) || null : null, timeKind: occurred ? "occurred" : "recorded",
        kind: looksFeverish(text) ? "fever" : "dot", title: clip(text, 24), text: clip(text, 300), who: c.speaker ? String(c.speaker) : null, sourceLabel: "微信记录", episode: ep ? { id: ep, title: epTitle.get(ep) ?? ep } : null, attachments: [] });
    }
    const encEp = new Map<string, string>();
    for (const b of tl.blocks) for (const x of b.encounters) if (!encEp.has(x.id)) encEp.set(x.id, b.episodeId);
    const encs = [...tl.blocks.flatMap((b) => b.encounters), ...tl.unattachedEncounters];
    const seen = new Set<string>();
    for (const x of encs) {
      if (seen.has(x.id)) continue; seen.add(x.id);
      const d = day(x.date); if (!d || d > nowDay) continue; // an appointment still ahead is a reminder, not a record
      const v = visitOf(H, x);
      const ep = encEp.get(x.id) ?? null;
      entries.push({ id: x.id, ledger: "history", date: d, time: null, timeKind: "occurred", kind: x.kind === "diagnostic_only" ? "exam" : x.countsAsVisit ? "visit" : "dot",
        title: `${x.kindLabel}${v.dept ? ` · ${v.dept}` : ""}`, text: [v.hospital, v.dept, v.diagnoses.length ? `诊断：${v.diagnoses.join("；")}` : ""].filter(Boolean).join(" · "), who: null, sourceLabel: "医院资料", episode: ep ? { id: ep, title: epTitle.get(ep) ?? ep } : null, attachments: v.reports });
    }
  }
  if (R) {
    for (const e of Object.values(R.entities)) {
      if (e.kind !== "observation") continue;
      const c = effectiveContent(R, { kind: "observation", id: e.id })!.content;
      if (c.layer !== "health_record" || c.attribution === "not_child") continue;
      const occurred = day(c.occurredAt);
      const d = occurred ?? day(c.recordedAt);
      if (!d) continue;
      const imgs = Array.isArray(c.images) ? (c.images as { sha256: string; name: string }[]) : [];
      const isVisit = c.kind === "visit";
      const sy = (c.symptoms ?? {}) as Record<string, unknown>;
      const temp = sy.temperature && typeof sy.temperature === "object" ? Number((sy.temperature as { value: number }).value) : null;
      const bits = isVisit
        ? [clean(c.hospital === "其他" ? c.hospitalOther : c.hospital), clean(c.department === "其他" ? c.departmentOther : c.department), clean(c.note)]
        : [clean(c.text), temp !== null ? `体温 ${temp} ℃` : "", sy.nose ? String(sy.nose) : "", sy.cough ? `咳嗽${sy.cough}` : ""];
      const text = bits.filter(Boolean).join(" · ");
      entries.push({ id: e.id, ledger: "record", date: d, time: occurred && String(c.occurredAt).length > 10 ? String(c.occurredAt).slice(11, 16) : null, timeKind: occurred ? "occurred" : "recorded",
        kind: isVisit ? "visit" : (temp !== null && temp >= 37.5) || looksFeverish(text) ? "fever" : "dot", title: isVisit ? "就医资料" : "爸妈手记", text: clip(text, 300), who: c.speaker ? String(c.speaker) : null, sourceLabel: "家长记录", episode: null,
        attachments: imgs.map((i, k) => ({ href: recordHref(i.sha256), label: imgs.length > 1 ? `报告图 ${k + 1}` : "报告图" })) });
    }
  }
  const byDay = new Map<string, PageEntry[]>();
  for (const x of entries) (byDay.get(x.date) ?? byDay.set(x.date, []).get(x.date)!).push(x);
  const rank: Record<NodeKind, number> = { fever: 0, visit: 1, exam: 2, dot: 3 };
  const nodes: PageNode[] = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, xs]) => {
    xs.sort((a, b) => rank[a.kind] - rank[b.kind] || String(a.time).localeCompare(String(b.time)) || a.id.localeCompare(b.id));
    return { id: `n-${d}`, date: d, kind: xs[0].kind, unassigned: xs.every((x) => !x.episode), entries: xs };
  });

  // ----- episodes -----
  const episodes: PageEpisode[] = (tl?.blocks ?? []).map((b) => {
    const ep = effectiveContent(H!, { kind: "episode", id: b.episodeId })!.content;
    const endKnown = b.declaredEnd === "ended" && !!day(b.end);
    const course: { date: string; text: string }[] = [];
    if (day(b.start)) course.push({ date: day(b.start)!, text: `开始${ep.startQualifier ? ` · ${clean(ep.startQualifier)}` : ""}` });
    for (const band of bands) if (band.episodeId === b.episodeId && band.kind !== "open") course.push({ date: band.start, text: `${band.kind === "recorded" ? "原文写明" : "疑似持续"}：${md(band.start)}–${md(band.end)} ${band.label}` });
    for (const x of b.encounters) if (day(x.date)) { const v = visitOf(H!, x); course.push({ date: day(x.date)!, text: `${x.kindLabel}：${v.dept || v.hospital}${v.diagnoses.length ? `，${v.diagnoses.join("；")}` : ""}` }); }
    course.sort((a, c) => (a.date < c.date ? -1 : a.date > c.date ? 1 : 0));
    return {
      id: b.episodeId, title: clean(b.title), category: categoryOf(clean(b.title)),
      start: day(b.start), startNote: ep.startText ? clean(ep.startText) : null,
      end: endKnown ? day(b.end) : null, endKnown, endNote: ep.endBasis ? clean(ep.endBasis) : null,
      course,
      summary: {
        points: (Array.isArray(ep.keyFindings) ? ep.keyFindings : []).map(clean).filter(Boolean),
        open: (Array.isArray(ep.openQuestions) ? ep.openQuestions : []).map(clean).filter(Boolean),
        medical: "这一病程还没有经过审核的医学解释，待补；上面只列已审核底账里的要点。",
      },
      visits: b.encounters.map((x) => visitOf(H!, x)).sort((a, c) => a.date.localeCompare(c.date)),
    };
  });

  // ----- follow-up -----
  const epRef = (id: string) => ({ id, title: epTitle.get(id) ?? id });
  const lastNodeDay = nodes.length ? nodes[nodes.length - 1].date : null;
  let followUp: HealthPage["followUp"];
  if (!inp.materials) followUp = { care: [], visit: [], status: "missing", basisDate: null, staleReason: "后续措施的审核材料还没有接通。" };
  else {
    const cutoff = inp.materials.dataCutoff.slice(0, 10);
    const newer = nodes.filter((n) => n.date > cutoff);
    const item = (m: MaterialItem): FollowUpItem => ({ id: m.id, kind: m.kind, text: m.text, detail: m.detail ?? null, episodes: (m.episodes ?? []).filter((e) => epTitle.has(e)).map(epRef) });
    followUp = {
      care: inp.materials.items.filter((m) => m.group === "care").map(item),
      visit: inp.materials.items.filter((m) => m.group === "visit").sort((a, b) => (a.kind === "conditional" ? -1 : 0) - (b.kind === "conditional" ? -1 : 0)).map(item),
      status: newer.length ? "stale" : "current", basisDate: cutoff,
      staleReason: newer.length ? `这些措施依据 ${md(cutoff)} 之前的资料整理；之后又有 ${md(newer[0].date)} 起的新记录，还没有重新审核。` : null,
    };
  }

  // ----- reminders: only explicit appointments that are still ahead -----
  const reminders: HealthReminder[] = [];
  const encAll = new Map<string, EncounterView>();
  for (const b of tl?.blocks ?? []) for (const x of b.encounters) encAll.set(x.id, x);
  for (const x of tl?.unattachedEncounters ?? []) encAll.set(x.id, x);
  for (const x of encAll.values()) {
    const d = day(x.date);
    if (x.kind === "appointment_only" && d && d >= nowDay) reminders.push({ id: x.id, date: d, title: `${clean(x.dept) || "门诊"}预约`, place: clean(x.hospital) });
  }
  reminders.sort((a, b) => a.date.localeCompare(b.date));

  // ----- years -----
  const nowYear = Number(nowDay.slice(0, 4));
  const ys = new Set<number>([nowYear]);
  for (const n of nodes) ys.add(Number(n.date.slice(0, 4)));
  for (const b of bands) ys.add(Number(b.start.slice(0, 4)));
  const years = [...ys].filter((y) => y >= 2000 && y <= nowYear).sort();
  const en = inp.intervals?.enrolment;
  return {
    asOf: lastNodeDay, years, defaultYear: nowYear,
    nodes, bands, episodes, followUp,
    enrolment: en ? { date: en.date, note: `${en.basis}${en.parentConfirmed ? "" : "（家长还没有在这里确认）"}` } : null,
    reminders,
    pendingIntervals: bands.filter((b) => b.status === "needs_review").map((b) => b.id),
    inputs: { history: !!H, records: !!R, intervals: !!inp.intervals, materials: !!inp.materials },
  };
}
