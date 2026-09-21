// HEALTH-04 health page model: one pure function over
//   - the HEALTH-02 history ledger (read-only),
//   - the HEALTH-03 record ledger (parents' notes and visit materials, corrections applied),
//   - a reviewed interval file (which spans the records actually support) and
//   - a reviewed follow-up materials file (text taken from already-reviewed documents, with source, version and conditions).
// Nothing here guesses a span: red only comes from a reviewed interval whose supporting records are still exactly what was
// reviewed. A changed/voided support, or a new record inside the span, turns the interval into "needs review" instead of
// silently keeping the old verdict. Scattered records are nodes, never a span. No green, no day counts, no ratios.
import { effectiveContent, Graph } from "../graph";
import { effectiveHash } from "../ledger";
import { entityKey, hashOf, type Content, type Ledger, type Ref } from "../model";
import { buildTimeline, type EncounterView, type FactView, type SourceRef } from "../timeline";
import { LAYER_LABEL, adoptedOf, snapshotProblems, type AnalysisFile } from "./analysis";

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
/** The enrolment date is derived from records: it is valid only while every cited source is still present with the hash it had when reviewed. */
export interface EnrolmentReview { date: string; basis: string; sources: { ledger: "history" | "record" | "derived"; ref: Ref; hash: string; note?: string }[]; parentConfirmed: boolean }
/** nodes: scattered records that were read in the review and belong on the timeline as single points (never a span). */
export interface IntervalFile { schema: 1; reviewedAt: string; reviewer: string; intervals: IntervalReview[]; nodes?: ReviewedRef[]; enrolment?: EnrolmentReview | null;
  /** episode id -> closure hash of the episode (members, visits, hospital facts, sources at bound versions) when the summary/measures were reviewed.
   *  A different current hash means something the summary rests on changed: the episode's summary and linked measures are held for review. */
  episodeStamps?: Record<string, string> }

/** R1 private derived layer: records found in the review that are NOT in the accepted ledger. They are kept separate (never written into it),
 *  carry their own source identity + a hash of the source text, and are shown as extra evidence: a recovery statement is either an interval's
 *  end evidence (endEvidence) or, when it cannot be tied to that span, a counter/pending item (pending). */
export interface DerivedRecord { id: string; date: string; who: string | null; text: string; source: { conversation: string; at: string; textSha256: string }; nature: "recovery" | "enrolment"; intervalId?: string; disposition: "end_evidence" | "pending_link" | "linked"; context: string; contextLines?: string[] }
export interface DerivedFile { schema: 1; reviewedAt: string; records: DerivedRecord[] }

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
  /** true when the end date comes from a derived (not yet accepted-ledger) record */
  endFromDerived?: boolean;
}
export interface PageVisit { id: string; date: string; kindLabel: string; countsAsVisit: boolean; hospital: string; dept: string; diagnoses: string[]; prescriptions: string[]; reports: Attachment[] }
/** The adopted medical-assistance reading of one episode (HEALTH-M01-A). Facts and medical evidence stay in the private analysis pack; the page only shows the reading. */
export interface EpisodeAnalysis {
  version: string; dataAsOf: string; paragraphs: string[]; layers: { label: string; text: string }[]; uncertain: string[]; impact: string; currentStatus: string;
  adoptedBy: string; adoptedAt: string; basis: string;
  /** set when the facts it read changed after adoption: the text stays (for tracing) but is held for re-review */
  review: string | null;
  /** records that arrived after the data date and are not part of this reading */
  newerNote: string | null;
}
export interface PageEpisode {
  id: string; title: string; category: "resp" | "fever" | "burn" | "other";
  start: string | null; startNote: string | null; end: string | null; endKnown: boolean; endNote: string | null;
  course: { date: string; text: string; review?: string }[];
  summary: { points: string[]; open: string[]; medical: string; review: string | null; analysis: EpisodeAnalysis | null };
  visits: PageVisit[];
}
export interface FollowUpItem { id: string; kind: MaterialItem["kind"]; text: string; detail: string | null; episodes: { id: string; title: string }[]; review: string | null }
export interface HealthReminder { id: string; date: string; title: string; place: string }
export interface HealthPage {
  asOf: string | null; years: number[]; defaultYear: number;
  nodes: PageNode[]; bands: PageBand[];
  episodes: PageEpisode[];
  followUp: { care: FollowUpItem[]; visit: FollowUpItem[]; status: "current" | "stale" | "missing"; basisDate: string | null; staleReason: string | null };
  enrolment: { date: string; note: string; status: "ok" | "needs_review" } | null;
  /** hospital facts that have no visit number (they come from a visit-list page): kept reachable, with their originals */
  looseHospital: { id: string; type: string; text: string; attachments: Attachment[] }[];
  /** small coverage table for own-child WeChat observations: what is shown and why the rest is not (no full re-read) */
  coverage: { shownAttached: number; shownUnattached: number; shownCandidate: number; excluded: Record<string, number>; total: number };
  reminders: HealthReminder[];
  pendingIntervals: string[];
  inputs: { history: boolean; records: boolean; intervals: boolean; materials: boolean };
}

export interface PageInputs {
  history: Ledger | null; record: Ledger | null;
  intervals: IntervalFile | null; materials: MaterialsFile | null;
  derived?: DerivedFile | null;
  /** adopted per-episode analyses (private file); only an adopted version with an unchanged dependency snapshot counts as reviewed */
  analyses?: AnalysisFile | null;
  /** current SHA-256 of a materials source file, when it can be read (undefined = could not be checked) */
  materialSourceHash?: (file: string) => string | undefined;
  now: string; // Shanghai wall clock YYYY-MM-DDTHH:mm
}

// Factual roles that may appear on the timeline when the record is the child's. Questions, plans, reminders, AI references,
// hand-over notes and summary relays are never shown as a health event on their own.
const HISTORY_ROLES = new Set(["observation", "relay", "recall", "medication_administered", "medication_not_given"]);
const ADOPTED = /^claude_(full_read|context_reviewed)/;
// Direct statements about the child's own health state. Everything else under an "observation" role (AI references, other people's
// opinions and hypotheses, growth, feeding, teething, vaccines, family feelings, admin) is not a health event and is listed in the coverage table.
const OWN_HEALTH_KINDS = new Set(["observation", "symptom_report", "symptom_course", "symptom_denied", "symptom_onset_uncertain", "measurement", "medication_administered", "medication_not_given", "medication_adherence", "medication_course", "medication_withheld",
  "care_event", "care_observation", "care_fact", "relayed_doctor", "diagnosis_relayed", "relayed_result", "injury_observation", "incident", "parent_judgement", "parent_summary", "history", "recollection", "monitor", "family_observation"]);
const NOT_HEALTH_KINDS = /^(ai_|regimen_ai|growth|feeding|teething|dental|vaccine|development|newborn|birth_fact|alt_|lay_|family_(opinion|hypothesis|worry|claim|conflict|state|action)|parent_(emotion|prediction|understanding)|hypothesis|hearsay|dispute|care_(admin|summary|history|reasoning|method|quality|advice|decision|detail|action|note)|medication_(purchase|plan|planned|reasoning|item|reminder|intent|consider|standby|handover)|supplement|concern|ack|safety|exposure|uncertain|invalid|instruction|relayed_(lay|family)|measurement_method|lab_)/;
/** Why an observation is NOT shown as an own health record (null = show). Identity and episode membership are separate questions:
 *  a confirmed own record does not vanish because it is not attached to an episode; an explicit non-child mark or a non-factual role does. */
/** A generic "observation" (the catch-all kind) only counts as a health record when the text itself carries a health cue; ordinary daily chat does not. */
const HEALTH_CUE = /鼻|涕|咳|烧|发热|低热|热度|℃|体温|喘|痰|感冒|嗓|喉|雾化|吐|拉肚子|拉稀|腹泻|便秘|疹|痒|红肿|渗液|结痂|烫|伤口|疤|药|头孢|布洛芬|美林|泰诺|克拉|打针|输液|医院|医生|门诊|急诊|挂号|检查|化验|血常规|拍片|肺炎|炎|过敏|哭得|不舒服|没精神|精神(差|不好|状态)|睡不好|睡得不|打呼|鼻塞|呼吸/;
/** Identity/role exclusions are decided by the CURRENT effective content and can never be overridden by an older review reference.
 *  Only the softer "no evidence / no health cue / unknown kind" classifications may be rescued by a review that cited the record. */
export function isHardExclusion(c: Content): boolean {
  if (c.attribution === "not_child") return true;
  const subj = typeof c.subject === "string" ? c.subject : null;
  if (subj && subj !== "child" && subj !== "张年") return true;
  return !HISTORY_ROLES.has(String(c.role));
}
export function exclusionReason(c: Content): string | null {
  if (c.attribution === "not_child") return "标为不是孩子的记录";
  const subj = typeof c.subject === "string" ? c.subject : null;
  if (subj && subj !== "child" && subj !== "张年") return "主体是别人";
  if (!HISTORY_ROLES.has(String(c.role))) return c.role === "summary_relay" ? "汇总稿转述（另有来源层）" : "不是事实陈述（提问、计划、提醒等）";
  if (!subj && !ADOPTED.test(String(c.reviewStatus ?? ""))) return "没有本人依据（身份字段缺失且未经采用）";
  const fk = String(c.factKind ?? "");
  if (fk && !OWN_HEALTH_KINDS.has(fk)) return NOT_HEALTH_KINDS.test(fk) ? "不是孩子健康状态的陈述（成长、喂养、牙齿、疫苗、他人看法、AI 引用等）" : "类别不明，不当作健康事实显示";
  if (fk === "observation" && !HEALTH_CUE.test(String(c.text ?? ""))) return "泛类日常记录，文字里没有健康线索";
  return null;
}
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
  // a respiratory/fever episode that merely overlaps a burn in time (title mentions both) is filed under what it is about, once
  if (/烫伤|烧伤/.test(title) && !/发热|发烧|呼吸道|咳|鼻|支气管|肺|咽/.test(title)) return "burn";
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
  const memberRole = new Map<string, "attached" | "candidate" | "background">();
  for (const b of tl?.blocks ?? []) {
    for (const i of b.items) { epOf.set(i.observationId, b.episodeId); memberRole.set(i.observationId, "attached"); }
    for (const i of b.candidates) if (!memberRole.has(i.observationId)) memberRole.set(i.observationId, "candidate");
    for (const i of b.background) if (!memberRole.has(i.observationId)) memberRole.set(i.observationId, "background");
  }

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
  const derivedFor = (id: string) => (inp.derived?.records ?? []).filter((d) => d.intervalId === id);
  for (const iv of inp.intervals?.intervals ?? []) {
    const reasons: string[] = [];
    const sup: BandRef[] = [], ctr: BandRef[] = [];
    for (const r of iv.supports) { reviewedIds.add(`${r.ledger}:${r.ref.id}`); const c = checkRef(inp, r); if (!c.ok) reasons.push(c.why!); sup.push({ id: r.ref.id, date: c.date ?? "", text: r.note ?? c.text }); }
    for (const r of iv.counter ?? []) { reviewedIds.add(`${r.ledger}:${r.ref.id}`); const c = checkRef(inp, r); if (!c.ok) reasons.push(c.why!); ctr.push({ id: r.ref.id, date: c.date ?? "", text: r.note ?? c.text }); }
    const lo = addDays(iv.start, -1), hi = addDays(iv.end, 3);
    for (const n of newAfterReview) if (n.date >= lo && n.date <= hi && !reviewedIds.has(`${n.ledger}:${n.id}`)) reasons.push(`核查之后又有 ${md(n.date)} 的新记录落在这段时间附近`);
    // derived layer (private, not in the accepted ledger): a recovery statement is end evidence only when the review tied it to this span;
    // otherwise it is shown as a pending counter item so it is never silently dropped
    let end = iv.end, endFromDerived = false;
    for (const d of derivedFor(iv.id)) {
      const item: BandRef = { id: d.id, date: d.date, text: `${d.context}（来源：${d.source.conversation} ${d.source.at}，派生层，尚未入账）` };
      if (d.disposition === "end_evidence" && d.date >= iv.start) { if (d.date > end || !endFromDerived) { end = d.date; endFromDerived = true; } sup.push(item); }
      else ctr.push({ ...item, text: `待定关联：${item.text}` });
    }
    const explain = iv.kind === "recorded"
      ? `原文写明的持续时间：${iv.reason}`
      : `疑似持续：${iv.reason}（这是把几条记录连起来看的判断，不是原文直接写的时长）`;
    bands.push({ id: iv.id, kind: iv.kind, start: iv.start, end, startApprox: !!iv.startApprox, episodeId: iv.episodeId, label: iv.label, status: reasons.length ? "needs_review" : "ok", statusReasons: [...new Set(reasons)], explain, timeNote: endFromDerived ? `结束日期取自派生层记录（尚未入账，来源见依据）${iv.timeNote ? "；" + iv.timeNote : ""}` : iv.timeNote ?? null, supports: sup, counter: ctr, endFromDerived });
  }
  // an episode with an unknown end and no reviewed span only gets a short visual fade at its start: never a length
  for (const b of tl?.blocks ?? []) {
    const s = day(b.start);
    if (!s || bands.some((x) => x.episodeId === b.episodeId || (x.kind !== "open" && x.start <= s && s <= x.end))) continue;
    bands.push({ id: `open-${b.episodeId}`, kind: "open", start: s, end: s, startApprox: false, episodeId: b.episodeId, label: epTitle.get(b.episodeId) ?? "", status: "ok", statusReasons: [], explain: "只知道开始，之后怎样没有记录；色带不代表持续了多久。", timeNote: null, supports: [], counter: [] });
  }

  // ----- entries -> nodes -----
  const entries: PageEntry[] = [];
  const cov: HealthPage["coverage"] = { shownAttached: 0, shownUnattached: 0, shownCandidate: 0, excluded: {}, total: 0 };
  if (H) cov.total = Object.values(H.entities).filter((e) => e.kind === "observation").length;
  if (H && tl) {
    const inReview = new Set([...reviewedIds].filter((k) => k.startsWith("history:")).map((k) => k.slice(8)));
    for (const e of Object.values(H.entities)) {
      if (e.kind !== "observation") continue;
      const eff = effectiveContent(H, { kind: "observation", id: e.id })!;
      const c = eff.content;
      const ep = epOf.get(e.id) ?? null;
      if (c.attribution === "not_child") { cov.excluded["标为不是孩子的记录"] = (cov.excluded["标为不是孩子的记录"] ?? 0) + 1; continue; }
      const why = exclusionReason(c);
      // a reviewed reference may keep a record on the page only against the soft classifications; identity/role corrections always win
      if (why && (isHardExclusion(c) || !inReview.has(e.id))) { cov.excluded[why] = (cov.excluded[why] ?? 0) + 1; continue; }
      if (why) cov.excluded[why] = (cov.excluded[why] ?? 0) + 0;
      const mr = memberRole.get(e.id);
      if (ep) cov.shownAttached++; else if (mr === "candidate" || mr === "background") cov.shownCandidate++; else cov.shownUnattached++;
      const occurred = day(c.occurredAt);
      const d = occurred ?? day(c.recordedAt);
      if (!d) continue;
      const text = clean(c.text);
      entries.push({ id: e.id, ledger: "history", date: d, time: typeof c.recordedAt === "string" ? c.recordedAt.slice(11, 16) || null : null, timeKind: occurred ? "occurred" : "recorded",
        kind: looksFeverish(text) ? "fever" : "dot", title: clip(text, 24), text: clip(text, 300), who: c.speaker ? String(c.speaker) : null,
        sourceLabel: mr === "candidate" ? "微信记录 · 候选（只是时间接近，不计入病程）" : mr === "background" ? "微信记录 · 同期背景（不计入病程）" : "微信记录", episode: ep ? { id: ep, title: epTitle.get(ep) ?? ep } : null, attachments: [] });
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
        : [clean(c.text), temp !== null ? `体温 ${temp} ℃` : "", sy.nose ? String(sy.nose) : "", sy.cough ? `咳嗽${sy.cough}` : "", sy.nasalVoice === true ? "有鼻音" : "", Array.isArray(sy.sleep) && sy.sleep.length ? `睡眠：${(sy.sleep as string[]).join("、")}` : ""];
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
  const changedEps = new Map<string, string>();
  const analysisWhy = new Map<string, string[]>();
  const graphH = H ? new Graph(H) : null;
  const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
  const episodes: PageEpisode[] = (tl?.blocks ?? []).map((b) => {
    const ep = effectiveContent(H!, { kind: "episode", id: b.episodeId })!.content;
    const endKnown = b.declaredEnd === "ended" && !!day(b.end);
    const course: { date: string; text: string; review?: string }[] = [];
    if (day(b.start)) course.push({ date: day(b.start)!, text: `开始${ep.startQualifier ? ` · ${clean(ep.startQualifier)}` : ""}` });
    const epBands = bands.filter((x) => x.episodeId === b.episodeId && x.kind !== "open");
    for (const band of epBands) course.push({ date: band.start, text: `${band.kind === "recorded" ? "原文写明" : "疑似持续"}：${md(band.start)}–${md(band.end)} ${band.label}`,
      review: band.status === "needs_review" ? `待重新核对：${band.statusReasons.join("；")}。核对之前这条不当作有效经过。` : undefined });
    const pendingBands = epBands.filter((x) => x.status === "needs_review");
    const stamp = inp.intervals?.episodeStamps?.[b.episodeId];
    const closureNow = graphH!.closureHash({ kind: "episode", id: b.episodeId });
    // an adopted analysis whose dependency snapshot still matches is itself a review of the episode at this exact state
    const av = inp.analyses ? adoptedOf(inp.analyses, b.episodeId) : null;
    const aWhy = av ? snapshotProblems({ history: H, record: R }, av, graphH!) : [];
    const stale0 = inp.intervals ? (stamp === undefined ? "这一病程的要点还没有记录核对时的底账版本" : stamp !== closureNow ? "这一病程关联的医院事实、就诊、来源或成员在核对之后有变化" : null) : null;
    const stampProblem = av && !aWhy.length ? null : stale0;
    if (stampProblem) changedEps.set(b.episodeId, stampProblem);
    else if (av && aWhy.length) changedEps.set(b.episodeId, "医学分析读到的事实在采用之后有变化");
    if (av && aWhy.length) analysisWhy.set(b.episodeId, aWhy);
    for (const x of b.encounters) if (day(x.date)) { const v = visitOf(H!, x); course.push({ date: day(x.date)!, text: `${x.kindLabel}：${v.dept || v.hospital}${v.diagnoses.length ? `，${v.diagnoses.join("；")}` : ""}` }); }
    course.sort((a, c) => (a.date < c.date ? -1 : a.date > c.date ? 1 : 0));
    let analysis: EpisodeAnalysis | null = null;
    if (av) {
      const last = av.events.filter((x) => x.status === "adopted").pop()!;
      const lastAct = course.length ? course[course.length - 1].date : av.body.dataAsOf;
      const newer = entries.filter((x) => x.date > av.body.dataAsOf && x.date <= nowDay && (!x.episode || x.episode.id === b.episodeId)).sort((p, q) => p.date.localeCompare(q.date));
      analysis = { version: av.id, dataAsOf: av.body.dataAsOf, paragraphs: av.body.summary, layers: av.body.layers.map((l) => ({ label: LAYER_LABEL[l.level], text: l.text })), uncertain: av.body.uncertain, impact: av.body.impact, currentStatus: av.body.currentStatus,
        adoptedBy: last.by, adoptedAt: last.at, basis: last.basis ?? "",
        review: aWhy.length ? `待重新核对：${aWhy.join("；")}。这版分析的文字保留供追溯，先不要当作当前判断。` : null,
        newerNote: newer.length && daysApart(lastAct, av.body.dataAsOf) <= 14 ? `这版分析只读到 ${md(av.body.dataAsOf)} 为止的资料；此后又有 ${newer.length} 条新记录（${md(newer[0].date)}起）还没有纳入，需要重新分析后才会反映。` : null };
    }
    return {
      id: b.episodeId, title: clean(b.title), category: categoryOf(clean(b.title)),
      start: day(b.start), startNote: ep.startText ? clean(ep.startText) : null,
      end: endKnown ? day(b.end) : null, endKnown, endNote: ep.endBasis ? clean(ep.endBasis) : null,
      course,
      summary: {
        points: (Array.isArray(ep.keyFindings) ? ep.keyFindings : []).map(clean).filter(Boolean),
        open: (Array.isArray(ep.openQuestions) ? ep.openQuestions : []).map(clean).filter(Boolean),
        medical: analysis ? "以上是辅助分析材料，不是医生的诊断或意见；有疑问以医生判断为准。" : "这一病程还没有经过审核的医学解释，待补；上面只列已审核底账里的要点。",
        analysis,
        // an interval that lost its evidence also puts the episode's summary points (which rest on the same records) under review
        review: [pendingBands.length ? `这一病程里有 ${pendingBands.length} 段时间因依据变化正在待重新核对` : "", stampProblem ?? ""].filter(Boolean).length
          ? `待重新核对：${[pendingBands.length ? `这一病程里有 ${pendingBands.length} 段时间的依据变化` : "", stampProblem ?? ""].filter(Boolean).join("；")}。下面的要点可能受影响，先按旧底账原样保留。` : null,
      },
      visits: b.encounters.map((x) => visitOf(H!, x)).sort((a, c) => a.date.localeCompare(c.date)),
    };
  });

  // ----- hospital facts with no visit number (from a visit-list page): still reachable, with their originals -----
  const looseHospital: HealthPage["looseHospital"] = (tl?.unattachedFacts ?? []).map((f) => ({ id: f.id, type: f.type, text: clip(clean(f.displayValue), 60), attachments: reportsOf(H!, f.documents) }));

  // ----- follow-up -----
  const epRef = (id: string) => ({ id, title: epTitle.get(id) ?? id });
  const lastNodeDay = nodes.length ? nodes[nodes.length - 1].date : null;
  let followUp: HealthPage["followUp"];
  // measures of adopted analyses (one set per episode); each is held for re-review when the facts it read changed or a span of that episode is under review
  const pendingByEp = new Map<string, string[]>();
  for (const bd of bands) if (bd.status === "needs_review" && bd.episodeId) (pendingByEp.get(bd.episodeId) ?? pendingByEp.set(bd.episodeId, []).get(bd.episodeId)!).push(bd.id);
  const aItems: { group: "care" | "visit"; item: FollowUpItem }[] = [];
  let analysisAsOf: string | null = null;
  for (const b of tl?.blocks ?? []) {
    const av = inp.analyses ? adoptedOf(inp.analyses, b.episodeId) : null;
    if (!av) continue;
    if (!analysisAsOf || av.body.dataAsOf > analysisAsOf) analysisAsOf = av.body.dataAsOf;
    const why = [...(analysisWhy.get(b.episodeId) ?? []), ...(pendingByEp.has(b.episodeId) ? ["这一病程有区间待重新核对"] : [])];
    for (const m of av.body.measures) aItems.push({ group: m.group, item: { id: `${av.id}:${m.id}`, kind: m.kind, text: m.text, detail: [m.detail, m.conditions.length ? `适用前提：${m.conditions.join("；")}` : "", m.reassessWhen.length ? `出现这些情况要重新评估：${m.reassessWhen.join("；")}` : ""].filter(Boolean).join("　") || null, episodes: [epRef(b.episodeId)], review: why.length ? `待重新核对：${[...new Set(why)].join("；")}。` : null } });
  }
  if (!inp.materials && !aItems.length) followUp = { care: [], visit: [], status: "missing", basisDate: null, staleReason: "后续措施的审核材料还没有接通。" };
  else {
    const cutoff = inp.materials ? inp.materials.dataCutoff.slice(0, 10) : analysisAsOf!;
    const mats = inp.materials?.items ?? [];
    const newer = nodes.filter((n) => n.date > cutoff);
    // per-item dependency check. General care / emergency-sign items rest on the source document and the evidence version only;
    // an item tied to an episode is also held when that episode has a span under review or a corrected key record.
    const reviewOf = (m: MaterialItem): string | null => {
      const why: string[] = [];
      // Presence of a material means its source must be verifiable: a missing checker, an unreadable file or a malformed recorded hash is
      // "not verified", never silently "current". The item's text stays visible (general care is not withdrawn).
      if (!/^[0-9a-f]{64}$/.test(m.source.sha256)) why.push("材料记录的来源哈希格式无效，无法核对来源");
      else if (!inp.materialSourceHash) why.push("来源核验没有配置，无法确认来源仍然有效");
      else {
        const cur = inp.materialSourceHash(m.source.file);
        if (cur === undefined) why.push("来源文件读不到，无法核对");
        else if (cur !== m.source.sha256) why.push("来源文件内容已变化");
      }
      for (const e of m.episodes ?? []) { if (pendingByEp.has(e)) why.push("关联的病程有区间待重新核对"); if (changedEps.has(e)) why.push("关联的病程在核对之后底账有变化"); }
      return why.length ? `待重新核对：${[...new Set(why)].join("；")}。这条通用内容仍照常显示，但来源是否仍然有效没有确认。` : null;
    };
    const item = (m: MaterialItem): FollowUpItem => ({ id: m.id, kind: m.kind, text: m.text, detail: m.detail ?? null, episodes: (m.episodes ?? []).filter((e) => epTitle.has(e)).map(epRef), review: reviewOf(m) });
    const allItems = [...mats.map(item), ...aItems.map((x) => x.item)];
    const reviewCount = allItems.filter((i) => i.review).length;
    followUp = {
      care: [...mats.filter((m) => m.group === "care").map(item), ...aItems.filter((x) => x.group === "care").map((x) => x.item)],
      visit: [...mats.filter((m) => m.group === "visit").sort((a, b) => (a.kind === "conditional" ? -1 : 0) - (b.kind === "conditional" ? -1 : 0)).map(item), ...aItems.filter((x) => x.group === "visit").sort((a, b) => (a.item.kind === "conditional" ? -1 : 0) - (b.item.kind === "conditional" ? -1 : 0)).map((x) => x.item)],
      status: newer.length || reviewCount ? "stale" : "current", basisDate: cutoff,
      staleReason: [newer.length ? `这些措施依据 ${md(cutoff)} 之前的资料整理；之后又有 ${md(newer[0].date)} 起的新记录，还没有重新审核。` : "", reviewCount ? `有 ${reviewCount} 条措施的依据发生变化，已标为待重新核对。` : ""].filter(Boolean).join("") || null,
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
  let enrolment: HealthPage["enrolment"] = null;
  if (en) {
    const bad: string[] = [];
    for (const src of en.sources) {
      if (src.ledger === "derived") { const d = (inp.derived?.records ?? []).find((x) => x.id === src.ref.id); if (!d || hashOf(d) !== src.hash) bad.push(`入托依据 ${src.ref.id} 与核查时不一致`); continue; }
      const c = checkRef(inp, { ref: src.ref, ledger: src.ledger, hash: src.hash });
      if (!c.ok) bad.push(c.why!);
    }
    enrolment = { date: en.date, status: bad.length ? "needs_review" : "ok", note: `${en.basis}${en.parentConfirmed ? "" : "（家长还没有在这里确认）"}${bad.length ? `。待重新核对：${[...new Set(bad)].join("；")}` : ""}` };
  }
  return {
    asOf: lastNodeDay, years, defaultYear: nowYear,
    nodes, bands, episodes, followUp,
    enrolment, looseHospital, coverage: cov,
    reminders,
    pendingIntervals: bands.filter((b) => b.status === "needs_review").map((b) => b.id),
    inputs: { history: !!H, records: !!R, intervals: !!inp.intervals, materials: !!inp.materials },
  };
}
