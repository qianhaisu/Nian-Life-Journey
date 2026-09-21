// Private, reviewable health timeline built from the ledger. One block per episode so a change only
// recomputes the episodes it touches (`previous` blocks are reused when their input hash is unchanged).
// Every item carries the observation version, its source chain and any corrections; unknown occurrence
// time is shown as the message record time and labelled as such — never as the event time.
import { effectiveContent, effectiveLinks, membership } from "./ledger";
import { entityKey, hashOf, type Content, type Ledger } from "./model";

export type Category = "prescription" | "plan" | "handoff" | "executed_report" | "not_given_report" | "question" | "reminder" | "recall" | "relay" | "observation";
export interface TraceInfo { observationId: string; version: number; sources: { id: string; role: "from_source" | "supports"; sha256?: string }[]; corrections: string[] }
export interface TimelineItem {
  observationId: string; displayTime: string; timeKind: "occurred" | "recorded_only"; precision: string | null;
  recordedAt: string; category: Category; role: string; text: string; trace: TraceInfo; counted: boolean;
}
export type DerivedStatus = "ongoing" | "ended" | "end_unknown" | "stale_no_recent_update";
export interface TimelineBlock {
  episodeId: string; inputHash: string; title: string; start: string | null; startBasis: string | null; end: string | null;
  declaredEnd: string; derivedStatus: DerivedStatus; lastUpdate: string | null; treatmentCourse: string;
  encounterIds: string[]; items: TimelineItem[]; candidates: TimelineItem[]; background: TimelineItem[];
}
export interface Timeline { asOf: string; blocks: TimelineBlock[]; unattached: TimelineItem[]; stats: { computed: number; reused: number } }

const ROLE_CATEGORY: [RegExp, Category][] = [
  [/prescri/, "prescription"], [/handoff|handover/, "handoff"], [/not_given|withheld|not_taken/, "not_given_report"],
  [/administered|adherence|actually_taken|executed/, "executed_report"], [/plan|regimen|intent|planned|standby|consider/, "plan"],
  [/remind/, "reminder"], [/question/, "question"], [/recall|history|recollection/, "recall"], [/relay|hearsay/, "relay"],
];
export const categoryOf = (role: string): Category => ROLE_CATEGORY.find(([re]) => re.test(role))?.[1] ?? "observation";

function itemFor(ledger: Ledger, observationId: string, counted: boolean): TimelineItem | null {
  const eff = effectiveContent(ledger, { kind: "observation", id: observationId });
  if (!eff) return null;
  const c = eff.content;
  const occurred = typeof c.occurredAt === "string" && c.occurredAt ? c.occurredAt : null;
  const recordedAt = String(c.recordedAt ?? "");
  const sources: TraceInfo["sources"] = [];
  for (const l of Object.values(ledger.links)) {
    if (l.from.kind === "observation" && l.from.id === observationId && (l.role === "from_source" || l.role === "supports")) {
      const s = ledger.entities[entityKey("source", l.to.id)];
      sources.push({ id: l.to.id, role: l.role, sha256: (s?.versions[s.versions.length - 1].content.sha256 as string | undefined) });
    }
  }
  sources.sort((a, b) => (a.role === b.role ? a.id.localeCompare(b.id) : a.role === "from_source" ? -1 : 1));
  return {
    observationId, displayTime: occurred ?? recordedAt, timeKind: occurred ? "occurred" : "recorded_only", precision: occurred ? String(c.occurredPrecision ?? "") : null,
    recordedAt, category: categoryOf(String(c.role)), role: String(c.role), text: String(c.text ?? c.basis ?? ""), trace: { observationId, version: eff.version, sources, corrections: eff.corrections }, counted,
  };
}
const byTime = (a: TimelineItem, b: TimelineItem) => (a.displayTime === b.displayTime ? a.observationId.localeCompare(b.observationId) : a.displayTime < b.displayTime ? -1 : 1);

function blockInputHash(ledger: Ledger, episodeId: string, asOf: string, staleDays: number) {
  const m = membership(ledger, episodeId);
  const ids = [...m.attached, ...m.candidate, ...m.background];
  const eff = (id: string) => { const e = effectiveContent(ledger, { kind: "observation", id }); return e ? hashOf({ v: e.version, c: e.content }) : "absent"; };
  const linkState = effectiveLinks(ledger).filter((l) => l.from.kind === "episode" && l.from.id === episodeId).map((l) => `${l.id}=${l.effectiveRole}`).sort();
  const ep = effectiveContent(ledger, { kind: "episode", id: episodeId });
  const encs = effectiveLinks(ledger).filter((l) => l.role === "encounter" && l.from.id === episodeId).map((l) => l.to.id).sort();
  return hashOf({ ep: ep ? hashOf(ep.content) + ep.version : null, m, obs: ids.map(eff), linkState, encs: encs.map((id) => hashOf(effectiveContent(ledger, { kind: "encounter", id })?.content ?? null)), asOf: staleDays > 0 ? asOf.slice(0, 10) : "-", staleDays });
}

export function buildTimeline(ledger: Ledger, opts: { asOf: string; staleDays?: number; previous?: Timeline }): Timeline {
  const staleDays = opts.staleDays ?? 14;
  const prev = new Map((opts.previous?.blocks ?? []).map((b) => [b.episodeId, b]));
  const blocks: TimelineBlock[] = [];
  let computed = 0, reused = 0;
  const placed = new Set<string>();
  const episodeIds = Object.values(ledger.entities).filter((e) => e.kind === "episode").map((e) => e.id).sort();
  for (const id of episodeIds) {
    const inputHash = blockInputHash(ledger, id, opts.asOf, staleDays);
    const m = membership(ledger, id);
    for (const oid of [...m.attached, ...m.candidate, ...m.background]) placed.add(oid);
    const old = prev.get(id);
    if (old && old.inputHash === inputHash) { blocks.push(old); reused++; continue; }
    computed++;
    const ep = effectiveContent(ledger, { kind: "episode", id })!.content as Content;
    const items = m.attached.map((o) => itemFor(ledger, o, true)).filter((x): x is TimelineItem => !!x).sort(byTime);
    const candidates = m.candidate.map((o) => itemFor(ledger, o, false)).filter((x): x is TimelineItem => !!x).sort(byTime);
    const background = m.background.map((o) => itemFor(ledger, o, false)).filter((x): x is TimelineItem => !!x).sort(byTime);
    const lastUpdate = items.length ? items[items.length - 1].displayTime : (ep.start as string | null) ?? null;
    const declaredEnd = String(ep.declaredEnd);
    let derived: DerivedStatus = declaredEnd === "ended" ? "ended" : declaredEnd === "end_unknown" ? "end_unknown" : "ongoing";
    if (derived === "ongoing" && lastUpdate && daysBetween(lastUpdate, opts.asOf) > staleDays) derived = "stale_no_recent_update";
    const encounterIds = effectiveLinks(ledger).filter((l) => l.role === "encounter" && l.from.id === id && l.effectiveRole !== "removed").map((l) => l.to.id).sort();
    blocks.push({ episodeId: id, inputHash, title: String(ep.title), start: (ep.start as string | null) ?? null, startBasis: (ep.startBasis as string | null) ?? null, end: (ep.end as string | null) ?? null, declaredEnd, derivedStatus: derived, lastUpdate, treatmentCourse: String(ep.treatmentCourse ?? "unknown"), encounterIds, items, candidates, background });
  }
  blocks.sort((a, b) => ((a.start ?? "9999") === (b.start ?? "9999") ? a.episodeId.localeCompare(b.episodeId) : (a.start ?? "9999") < (b.start ?? "9999") ? -1 : 1));
  const unattached = Object.values(ledger.entities).filter((e) => e.kind === "observation" && !placed.has(e.id)).map((e) => itemFor(ledger, e.id, false)!).sort(byTime);
  return { asOf: opts.asOf, blocks, unattached, stats: { computed, reused } };
}
function daysBetween(a: string, b: string) { return (Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000; }

// ---------- diff ----------
export interface TimelineDiff { addedBlocks: string[]; removedBlocks: string[]; changedBlocks: { episodeId: string; addedItems: string[]; removedItems: string[]; changedItems: string[]; statusChange?: [string, string] }[]; unchangedBlocks: number; unattachedDelta: { added: string[]; removed: string[] } }
export function diffTimelines(a: Timeline, b: Timeline): TimelineDiff {
  const am = new Map(a.blocks.map((x) => [x.episodeId, x])), bm = new Map(b.blocks.map((x) => [x.episodeId, x]));
  const out: TimelineDiff = { addedBlocks: [], removedBlocks: [], changedBlocks: [], unchangedBlocks: 0, unattachedDelta: { added: [], removed: [] } };
  for (const [id] of bm) if (!am.has(id)) out.addedBlocks.push(id);
  for (const [id, x] of am) {
    const y = bm.get(id);
    if (!y) { out.removedBlocks.push(id); continue; }
    const sig = (t: TimelineItem) => hashOf(t);
    const key = (t: TimelineItem[], u: TimelineItem[], v: TimelineItem[]) => new Map([...t.map((i) => [`m:${i.observationId}`, sig(i)] as const), ...u.map((i) => [`c:${i.observationId}`, sig(i)] as const), ...v.map((i) => [`b:${i.observationId}`, sig(i)] as const)]);
    const xa = key(x.items, x.candidates, x.background), ya = key(y.items, y.candidates, y.background);
    const added = [...ya.keys()].filter((k) => !xa.has(k)), removed = [...xa.keys()].filter((k) => !ya.has(k)), changed = [...ya.keys()].filter((k) => xa.has(k) && xa.get(k) !== ya.get(k));
    const statusChange = x.derivedStatus !== y.derivedStatus ? ([x.derivedStatus, y.derivedStatus] as [string, string]) : undefined;
    const metaChanged = hashOf({ ...x, items: 0, candidates: 0, background: 0, inputHash: 0, derivedStatus: 0 }) !== hashOf({ ...y, items: 0, candidates: 0, background: 0, inputHash: 0, derivedStatus: 0 });
    if (added.length || removed.length || changed.length || statusChange || metaChanged) out.changedBlocks.push({ episodeId: id, addedItems: added, removedItems: removed, changedItems: changed, statusChange });
    else out.unchangedBlocks++;
  }
  const ua = new Set(a.unattached.map((i) => i.observationId)), ub = new Set(b.unattached.map((i) => i.observationId));
  out.unattachedDelta.added = [...ub].filter((i) => !ua.has(i)).sort();
  out.unattachedDelta.removed = [...ua].filter((i) => !ub.has(i)).sort();
  return out;
}

// ---------- trace ----------
export function traceObservation(ledger: Ledger, observationId: string) {
  const e = ledger.entities[entityKey("observation", observationId)];
  if (!e) return null;
  return {
    observation: { id: observationId, versions: e.versions.map((v) => ({ version: v.version, hash: v.hash, runId: v.runId, at: v.at })) },
    sources: Object.values(ledger.links).filter((l) => l.from.id === observationId && l.from.kind === "observation" && (l.role === "from_source" || l.role === "supports")).map((l) => ({ role: l.role, source: l.to.id, entity: ledger.entities[entityKey("source", l.to.id)]?.versions.at(-1)?.content ?? null })),
    membership: effectiveLinks(ledger).filter((l) => l.from.kind === "observation" && l.from.id === observationId && l.to.kind === "episode").map((l) => ({ episode: l.to.id, declaredRole: l.role, effectiveRole: l.effectiveRole, correctionId: l.correctionId ?? null })),
    corrections: ledger.corrections.filter((c) => (c.type === "field" && c.ref.kind === "observation" && c.ref.id === observationId) || (c.type === "link" && c.linkId.includes(`observation:${observationId}|`))),
  };
}

// ---------- rendering ----------
const CATEGORY_LABEL: Record<Category, string> = { prescription: "处方", plan: "计划", handoff: "交接", executed_report: "实际执行报告", not_given_report: "未执行报告", question: "提问", reminder: "提醒", recall: "回忆", relay: "转述", observation: "观察" };
const STATUS_LABEL: Record<DerivedStatus, string> = { ongoing: "进行中", ended: "已明确结束", end_unknown: "结束时间未知", stale_no_recent_update: "进行中但近期无更新" };
const COURSE_LABEL: Record<string, string> = { unknown: "疗程未知" };

function line(i: TimelineItem) {
  const t = i.timeKind === "occurred" ? `${i.displayTime}（发生，${i.precision}）` : `${i.displayTime}（仅消息记录时间，发生时间未知）`;
  const corr = i.trace.corrections.length ? ` ✎更正 ${i.trace.corrections.join(",")}` : "";
  return `- ${t} · ${CATEGORY_LABEL[i.category]} · ${i.text.replace(/\s+/g, " ").slice(0, 160)} ⟨${i.observationId} v${i.trace.version}; 来源 ${i.trace.sources.map((s) => s.id).join("、") || "无"}⟩${corr}`;
}
export function renderMarkdown(t: Timeline): string {
  const out: string[] = [`# 健康历史时间轴（私有审阅稿）`, `截至 ${t.asOf}。候选与同期背景不计入该病程的确认事实。`, ""];
  for (const b of t.blocks) {
    out.push(`## ${b.title}（${b.episodeId}）`, `- 起：${b.start ?? "未知"}${b.startBasis ? `（${b.startBasis}）` : ""}；状态：${STATUS_LABEL[b.derivedStatus]}${b.end ? `；止：${b.end}` : ""}；${COURSE_LABEL[b.treatmentCourse] ?? b.treatmentCourse}`);
    out.push(`- 确认事实 ${b.items.length}；候选 ${b.candidates.length}；同期背景 ${b.background.length}；就诊 ${b.encounterIds.join("、") || "无"}`, "");
    out.push(...b.items.map(line));
    if (b.candidates.length) out.push("", "**候选（不计入确认事实）**", ...b.candidates.map(line));
    if (b.background.length) out.push("", "**同期背景（不计入确认事实）**", ...b.background.map(line));
    out.push("");
  }
  out.push(`## 未挂靠到任何病程（${t.unattached.length}）`, "未挂靠不等于无关，只是不据日期硬挂。", "", ...t.unattached.slice(0, 200).map(line));
  return out.join("\n");
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function renderHtml(t: Timeline): string {
  const md = renderMarkdown(t).split("\n").map((l) => (l.startsWith("## ") ? `<h2>${esc(l.slice(3))}</h2>` : l.startsWith("# ") ? `<h1>${esc(l.slice(2))}</h1>` : l.startsWith("- ") ? `<li>${esc(l.slice(2))}</li>` : l ? `<p>${esc(l)}</p>` : "")).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>health timeline</title><style>body{font:14px/1.6 system-ui;max-width:900px;margin:2em auto;padding:0 1em}li{margin:.2em 0}</style>\n${md}`;
}
