// HEALTH-03 record service: 爸妈手记 / 就医 / 已记录 on top of the HEALTH-02 file ledger.
//
//  - A note or a visit is ONE `observation` entity (id hr-<entryId>); uploaded report images are `source` entities
//    (hr-img-<sha256>) linked with `from_source`. Nothing here creates a confirmed diagnosis, medication or "actual visit" fact.
//  - Corrections, void (记错孩子) and restore are HEALTH-02 field corrections. Each entity has a revision counter
//    (1 + number of correction requests applied to it) that is compared INSIDE the locked transaction.
//  - Idempotency: creation by entryId (same request -> the stored record, different request -> 409);
//    corrections by requestId, remembered in the ledger's operational run log.
//  - Author always comes from the session, never from the request.
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { HealthFileStore, type StoreOptions } from "../file-store";
import { applyCorrection, applyPlan, effectiveContent, isValidTimeString, planImport, type Batch, type BatchItem } from "../ledger";
import { entityKey, hashOf, type Content, type Correction, type Ledger, type Ref } from "../model";
import { WHO_LABEL, type HealthWho } from "./config";
import { HASH_RE, OriginalsStore, RecordError, type InspectedImage } from "./media";
import { isInside, repoRootOf } from "./paths";

export const HOSPITALS = ["省儿保（滨江）", "省儿保（莫干山）", "市儿童医院", "浙一", "三墩", "其他"] as const;
export const DEPARTMENTS = ["呼吸内科", "耳鼻喉", "外科", "其他"] as const;
const NOSE = ["浓鼻涕", "清鼻涕"], COUGH = ["重度", "轻微"], SLEEP = ["哄睡困难", "夜醒多"];
const LAYER = "health_record", IMG_LAYER = "health_record_original";
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_TEXT = 4000, MAX_OTHER = 60, MAX_REASON = 200;

export interface ServiceOptions { repo?: string; now?: () => number; store?: StoreOptions; originalsHooks?: { failWrite?: () => boolean } }

// ---------- time ----------
const pad = (n: number) => String(n).padStart(2, "0");
/** Shanghai wall clock (the ledger convention for offset-less times). */
export function wallOf(ms: number, secs = true): string {
  const d = new Date(ms + 8 * 3600_000);
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return secs ? `${base}:${pad(d.getUTCSeconds())}` : base;
}
const bad = (message: string, code = "invalid", extra: Record<string, unknown> = {}) => new RecordError(400, code, message, extra);
const wallMs = (s: string) => Date.parse(`${s.length === 10 ? `${s}T00:00` : s}${s.length > 16 ? "" : ":00"}+08:00`);

export interface WhenInput { mode?: string; at?: string; date?: string; time?: string; precision?: string }
interface TimeFields { occurredAt: string | null; occurredPrecision: string | null; timeBasis: string }

/** Nothing is assumed: a missing choice is "unknown", never "now". */
export function normalizeWhen(w: WhenInput | undefined, nowMs: number): TimeFields {
  const mode = w?.mode ?? "unknown";
  const today = wallOf(nowMs).slice(0, 10);
  if (mode === "unknown") return { occurredAt: null, occurredPrecision: null, timeBasis: "unknown" };
  if (mode === "now") {
    const at = String(w?.at ?? "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) || !isValidTimeString(at)) throw bad("“刚刚”的时间不正确，请重新选择。");
    if (wallMs(at) > nowMs + 5 * 60_000) throw bad("“刚刚”的时间在未来，请检查手机时间。");
    if (wallMs(at) < nowMs - 48 * 3600_000) throw bad("“刚刚”已经过去太久了，请改选具体日期。");
    return { occurredAt: at, occurredPrecision: "minute", timeBasis: "parent_reported_now" };
  }
  if (mode === "today") {
    const d = String(w?.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isValidTimeString(d) || d > today) throw bad("“今天”的日期不正确。");
    if (wallMs(d) < nowMs - 3 * 86400_000) throw bad("“今天”已经过去太久了，请改选具体日期。");
    return { occurredAt: d, occurredPrecision: "day", timeBasis: "parent_reported_today" };
  }
  if (mode === "date") {
    const d = String(w?.date ?? ""), p = w?.precision ?? "day";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isValidTimeString(d)) throw bad("请选择是哪一天，或者改选“不确定”。");
    if (d > today) throw bad("这一天还没到，历史日期不能晚于今天。");
    if (p === "minute") {
      const t = String(w?.time ?? "");
      if (!/^\d{2}:\d{2}$/.test(t) || !isValidTimeString(`${d}T${t}`)) throw bad("选了“能到几点几分”，请填正确的几点；不知道就改成“只知道是哪天”。");
      if (wallMs(`${d}T${t}`) > nowMs + 5 * 60_000) throw bad("这个时间还没到。");
      return { occurredAt: `${d}T${t}`, occurredPrecision: "minute", timeBasis: "parent_reported_date" };
    }
    if (p !== "day" && p !== "approx") throw bad("时间精度不正确。");
    return { occurredAt: d, occurredPrecision: p, timeBasis: "parent_reported_date" };
  }
  throw bad("发生时间的选择不正确。");
}
function normalizeVisitDate(v: unknown, nowMs: number): TimeFields {
  if (v === undefined || v === null || v === "") return { occurredAt: null, occurredPrecision: null, timeBasis: "unknown" };
  const d = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isValidTimeString(d)) throw bad("就医日期不正确。");
  if (d > wallOf(nowMs).slice(0, 10)) throw bad("就医日期不能晚于今天。");
  return { occurredAt: d, occurredPrecision: "day", timeBasis: "parent_reported_date" };
}

// ---------- fields ----------
const cleanText = (v: unknown, max: number, label: string): string => {
  const s = typeof v === "string" ? v.replace(/\u0000/g, "").trim() : "";
  if (s.length > max) throw bad(`${label}太长了（最多 ${max} 个字）。`);
  return s;
};
const oneOf = (v: unknown, list: readonly string[], label: string): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !list.includes(v)) throw bad(`${label}的选项不正确。`);
  return v;
};

export interface Symptoms { temperature?: { value: number; unit: "℃" }; temperatureFlag?: "unusual_confirmed"; nose?: string; cough?: string; nasalVoice?: true; sleep?: string[] }

/** Fixed ℃. Outside a usual body-temperature range the parent is asked to confirm; once confirmed the number is kept, flagged. */
function normalizeSymptoms(raw: Record<string, unknown> | undefined, confirmUnusual: boolean, current?: Symptoms): Symptoms {
  const s: Symptoms = {};
  const t = raw?.temperature === undefined || raw.temperature === null ? "" : String(raw.temperature).trim();
  if (t) {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) throw bad("体温请填数字，例如 37.8（单位固定 ℃）。", "invalid_temperature");
    const n = Number(t);
    if (n <= 0 || n > 100) throw bad("这个数字不像体温（单位是 ℃）。请核对，或者清空不填。", "invalid_temperature");
    s.temperature = { value: n, unit: "℃" };
    if (n < 35 || n > 41.5) {
      const kept = current?.temperature?.value === n && current.temperatureFlag === "unusual_confirmed";
      if (!kept && !confirmUnusual) throw new RecordError(422, "temperature_needs_confirmation", `${n} ℃ 不太常见，请核对。确认没有写错的话，点“确认无误，保存”会按你写的记录。`, { value: n });
      s.temperatureFlag = "unusual_confirmed";
    }
  }
  const nose = oneOf(raw?.nose, NOSE, "鼻涕"); if (nose) s.nose = nose;
  const cough = oneOf(raw?.cough, COUGH, "咳嗽"); if (cough) s.cough = cough;
  if (raw?.nasalVoice === true) s.nasalVoice = true; else if (raw?.nasalVoice !== undefined && raw.nasalVoice !== false && raw.nasalVoice !== null) throw bad("鼻音的选项不正确。");
  if (raw?.sleep !== undefined && raw.sleep !== null) {
    if (!Array.isArray(raw.sleep)) throw bad("睡眠的选项不正确。");
    for (const x of raw.sleep) if (typeof x !== "string" || !SLEEP.includes(x)) throw bad("睡眠的选项不正确。");
    const picked = SLEEP.filter((x) => (raw.sleep as string[]).includes(x));
    if (picked.length) s.sleep = picked;
  }
  return s;
}
const hasSymptoms = (s: Symptoms) => Object.keys(s).length > 0;

interface OtherPair { value: string | null; other: string }
function pair(v: unknown, other: unknown, list: readonly string[], label: string): OtherPair {
  const value = oneOf(v, list, label);
  const text = cleanText(other, MAX_OTHER, `${label}名称`);
  if (value !== "其他" && text) throw bad(`只有选“其他”时才能填${label}名称。`);
  return { value, other: value === "其他" ? text : "" };
}

// ---------- views ----------
export interface RecordView {
  id: string; kind: "note" | "visit" | "legacy"; recordedAt: string; author: string | null; revision: number; voided: boolean; editable: boolean;
  occurred: { at: string | null; precision: string | null; basis: string | null };
  text?: string; symptoms?: Symptoms;
  hospital?: string; hospitalOther?: string; department?: string; departmentOther?: string; note?: string; images?: { sha256: string; name: string }[];
  legacy?: Record<string, unknown>;
}
export interface HistoryEntry { id: string; at: string; author: string; reason: string; kind: "created" | "corrected"; changes: { field: string; before: unknown; after: unknown }[] }

const baseId = (id: string) => id.split("#")[0];
type FieldCorr = Extract<Correction, { type: "field" }>;
class CorrIndex {
  private by = new Map<string, FieldCorr[]>();
  constructor(ledger: Ledger) { for (const c of ledger.corrections) if (c.type === "field") { const k = entityKey(c.ref.kind, c.ref.id); (this.by.get(k) ?? this.by.set(k, []).get(k)!).push(c); } }
  of(ref: Ref) { return this.by.get(entityKey(ref.kind, ref.id)) ?? []; }
  revision(ref: Ref) { return 1 + new Set(this.of(ref).map((c) => baseId(c.id))).size; }
}
const nn = <T>(v: T | null | undefined): T | undefined => (v === null || v === undefined ? undefined : v);

function viewOf(ledger: Ledger, ref: Ref, idx: CorrIndex): RecordView | null {
  const e = ledger.entities[entityKey(ref.kind, ref.id)];
  if (!e || e.kind !== "observation") return null;
  const c = effectiveContent(ledger, ref)!.content;
  const base = { id: ref.id, recordedAt: String(c.recordedAt ?? ""), author: nn(c.speaker as string | undefined) ?? null, revision: idx.revision(ref), voided: c.attribution === "not_child",
    occurred: { at: (c.occurredAt as string | null) ?? null, precision: (c.occurredPrecision as string | null) ?? null, basis: (c.timeBasis as string | null) ?? null } };
  if (c.layer !== LAYER) {
    return { ...base, kind: "legacy", editable: false, text: typeof c.text === "string" ? c.text : undefined, legacy: c };
  }
  const images = Array.isArray(c.images) ? (c.images as { sha256: string; name: string }[]) : [];
  if (c.kind === "visit") return { ...base, kind: "visit", editable: true, hospital: nn(c.hospital as string), hospitalOther: nn(c.hospitalOther as string), department: nn(c.department as string), departmentOther: nn(c.departmentOther as string), note: nn(c.note as string), images };
  return { ...base, kind: "note", editable: true, text: (c.text as string) ?? "", symptoms: pruneSymptoms(c.symptoms) };
}
function pruneSymptoms(v: unknown): Symptoms {
  const s = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>, out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(s)) if (x !== null && x !== undefined && !(Array.isArray(x) && !x.length)) out[k] = x;
  return out as Symptoms;
}
const sortKey = (v: RecordView) => `${v.recordedAt.replace(" ", "T")}|${v.id}`;

export class HealthRecordService {
  readonly store: HealthFileStore;
  readonly originals: OriginalsStore;
  private now: () => number;
  private cache: { sig: string; views: RecordView[]; images: Map<string, string> } | null = null;
  private ledgerFile: string;
  private repo: string;

  /** Checked before every read and write: where ledger / originals / thumbs REALLY land (links followed) must be outside the repository. */
  private guard() {
    for (const sub of ["ledger", "originals", "thumbs"]) {
      let inside = true;
      try { inside = isInside(path.join(this.root, sub), this.repo); } catch { inside = true; }
      if (inside) throw new RecordError(500, "private_path", "数据目录位置不安全，已拒绝读写。");
    }
  }

  constructor(readonly root: string, opts: ServiceOptions = {}) {
    this.store = new HealthFileStore(path.join(root, "ledger"), opts.store);
    this.repo = opts.repo ?? repoRootOf(process.cwd());
    this.originals = new OriginalsStore(root, opts.originalsHooks, () => this.guard());
    this.now = opts.now ?? Date.now;
    this.ledgerFile = path.join(root, "ledger", "ledger.json");
  }

  // ----- read side (projection cached until ledger.json changes) -----
  private async index() {
    this.guard();
    let sig = "none";
    try { const s = await stat(this.ledgerFile); sig = `${s.mtimeMs}:${s.size}`; } catch { /* no ledger yet */ }
    if (this.cache && this.cache.sig === sig) return this.cache;
    const ledger = await this.store.read();
    const idx = new CorrIndex(ledger);
    const views: RecordView[] = [];
    for (const e of Object.values(ledger.entities)) if (e.kind === "observation") { const v = viewOf(ledger, { kind: "observation", id: e.id }, idx); if (v) views.push(v); }
    views.sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1));
    const images = new Map<string, string>();
    for (const e of Object.values(ledger.entities)) if (e.kind === "source" && e.versions[0].content.layer === IMG_LAYER) images.set(String(e.versions[0].content.sha256), String(e.versions[0].content.ext));
    return (this.cache = { sig, views, images });
  }

  async list(opts: { cursor?: string | null; limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const { views } = await this.index();
    let start = 0;
    if (opts.cursor) { const i = views.findIndex((v) => sortKey(v) < opts.cursor!); start = i < 0 ? views.length : i; }
    const page = views.slice(start, start + limit);
    return { items: page, nextCursor: start + limit < views.length ? sortKey(page[page.length - 1]) : null };
  }

  async detail(id: string): Promise<{ record: RecordView; history: HistoryEntry[] } | null> {
    if (!/^[\w:.-]{1,120}$/.test(id)) return null;
    const ledger = await this.store.read();
    return this.detailFrom(ledger, id);
  }
  private detailFrom(ledger: Ledger, id: string) {
    const idx = new CorrIndex(ledger), ref: Ref = { kind: "observation", id };
    const record = viewOf(ledger, ref, idx);
    if (!record) return null;
    const e = ledger.entities[entityKey("observation", id)];
    const first = e.versions[0].content;
    const history: HistoryEntry[] = [{ id: "created", at: String(first.recordedAt ?? ""), author: String(first.speaker ?? "未记录"), reason: "", kind: "created", changes: [] }];
    const groups = new Map<string, HistoryEntry>();
    for (const c of idx.of(ref)) {
      const k = baseId(c.id);
      const g = groups.get(k) ?? { id: k, at: c.at, author: c.author, reason: c.reason, kind: "corrected" as const, changes: [] };
      g.changes.push({ field: c.field, before: c.before, after: c.after });
      groups.set(k, g);
    }
    history.push(...groups.values());
    return { record, history };
  }

  async readOriginal(sha: string, thumb: boolean) {
    if (!HASH_RE.test(sha)) return null;
    const ext = (await this.index()).images.get(sha);
    if (!ext) return null; // only images a committed record refers to are ever served
    return this.originals.read(sha, ext, thumb);
  }

  // ----- write side -----
  private invalidate() { this.cache = null; }

  async createNote(who: HealthWho, body: Record<string, unknown>) {
    const entryId = this.entryId(body.entryId);
    const nowMs = this.now();
    const time = normalizeWhen(body.when as WhenInput | undefined, nowMs);
    const symptoms = normalizeSymptoms(body.symptoms as Record<string, unknown> | undefined, body.confirmUnusualTemp === true);
    const text = cleanText(body.text, MAX_TEXT, "手记");
    if (!text && !hasSymptoms(symptoms)) throw bad("写一句话，或者在“再补充一点”里选一项。", "empty_entry");
    const content: Content = { role: "observation", factKind: "parent_note", layer: LAYER, kind: "note", entryId, subject: "child", attribution: "child",
      author: who, speaker: WHO_LABEL[who], text, symptoms, ...time, reviewStatus: "unreviewed", clinicianReviewed: false };
    const reqHash = hashOf({ t: "note", who, text, symptoms, time });
    return this.commitNew(`hr-${entryId}`, content, reqHash, [], []);
  }

  async createVisit(who: HealthWho, body: Record<string, unknown>, images: InspectedImage[]) {
    const entryId = this.entryId(body.entryId);
    const nowMs = this.now();
    const hospital = pair(body.hospital, body.hospitalOther, HOSPITALS, "医院");
    const dept = pair(body.department, body.departmentOther, DEPARTMENTS, "科室");
    const note = cleanText(body.note, MAX_TEXT, "备注");
    const time = normalizeVisitDate(body.visitDate, nowMs);
    const uniq = [...new Map(images.map((i) => [i.sha256, i])).values()];
    if (!uniq.length && !note) throw bad("请上传一张报告图，或者写一点备注，至少要有一项。", "empty_entry");
    const content: Content = { role: "observation", factKind: "visit_material", layer: LAYER, kind: "visit", entryId, subject: "child", attribution: "child",
      author: who, speaker: WHO_LABEL[who], hospital: hospital.value ?? undefined, hospitalOther: hospital.other || undefined, department: dept.value ?? undefined, departmentOther: dept.other || undefined,
      note, images: images.map((i) => ({ sha256: i.sha256, name: i.name })), ...time, reviewStatus: "unreviewed", clinicianReviewed: false };
    const reqHash = hashOf({ t: "visit", who, hospital, dept, note, time, imgs: images.map((i) => [i.sha256, i.name]) });
    // originals first (content-addressed, so a retry writes the same files); a record only ever references stored originals
    for (const i of uniq) await this.originals.save(i);
    return this.commitNew(`hr-${entryId}`, content, reqHash, uniq, uniq.map((i) => i.sha256));
  }

  private entryId(v: unknown): string {
    if (typeof v !== "string" || !ID_RE.test(v)) throw bad("提交标识不正确，请刷新页面后重试。", "bad_entry_id");
    return v;
  }

  private async commitNew(id: string, content: Content, reqHash: string, imgs: InspectedImage[], shas: string[]) {
    this.guard();
    const at = () => wallOf(this.now());
    try {
      const result = await this.store.transaction<{ duplicate: boolean }>((ledger) => {
        const existing = ledger.entities[entityKey("observation", id)];
        if (existing) {
          if (existing.versions[0].content.reqHash === reqHash) return { ledger, result: { duplicate: true as const } };
          throw new RecordError(409, "entry_reused", "这一次提交已经保存过了，而且内容和现在不同。想再记一条，请点“再记一条”。", { id });
        }
        const full: Content = { ...content, recordedAt: at(), reqHash };
        const items: BatchItem[] = imgs.map((i) => ({ kind: "source", id: `hr-img-${i.sha256}`, content: { layer: IMG_LAYER, sha256: i.sha256, ext: i.ext, mime: i.mime, bytes: i.bytes, width: i.width, height: i.height } }));
        items.push({ kind: "observation", id, content: full, links: shas.map((s) => ({ role: "from_source" as const, to: { kind: "source" as const, id: `hr-img-${s}` }, basis: "uploaded_original" })) });
        const batch: Batch = { batchId: `hr-new:${id}`, items };
        const plan = planImport(ledger, batch);
        if (plan.rejected) throw bad(`记录没有通过检查（${plan.items.find((p) => p.action === "rejected")?.reason ?? "格式"}）。`, "rejected");
        return { ledger: applyPlan(ledger, plan, { runId: randomUUID(), at: new Date(this.now()).toISOString() }), result: { duplicate: false as const } };
      });
      this.invalidate();
      const d = await this.detail(id);
      return { duplicate: result.duplicate, ...d! };
    } catch (e) { throw this.asRecordError(e); }
  }

  private asRecordError(e: unknown): RecordError {
    if (e instanceof RecordError) return e;
    return new RecordError(500, "storage_failed", "没有保存成功，你填的内容还在，请稍后重试。");
  }

  /** Field corrections and void/restore: one pipeline, revision compared inside the locked transaction. */
  private async correctVia(who: HealthWho, id: string, p: { requestId: unknown; expectedRevision: unknown; reason: unknown; defaultReason: string; input: unknown; build: (view: RecordView, content: Content) => { field: string; after: unknown }[] }) {
    if (typeof p.requestId !== "string" || !ID_RE.test(p.requestId)) throw bad("提交标识不正确，请刷新页面后重试。", "bad_request_id");
    if (typeof p.expectedRevision !== "number" || !Number.isInteger(p.expectedRevision) || p.expectedRevision < 1) throw bad("缺少版本信息，请刷新页面后重试。", "bad_revision");
    const reason = cleanText(p.reason, MAX_REASON, "理由") || p.defaultReason;
    this.guard();
    const ref: Ref = { kind: "observation", id };
    const inputHash = hashOf({ id, who, rev: p.expectedRevision, reason, input: p.input });
    try {
      const out = await this.store.transaction<{ duplicate: boolean }>((ledger) => {
        const run = ledger.runs.find((r) => r.batchId === `hr-req:${p.requestId}`);
        if (run) {
          if (run.inputHash !== inputHash) throw new RecordError(409, "request_reused", "这个提交标识已经用于另一次不同的更正，请刷新页面后重试。");
          return { ledger, result: { duplicate: true } };
        }
        if (!ledger.entities[entityKey("observation", id)]) throw new RecordError(404, "not_found", "找不到这条记录。");
        const idx = new CorrIndex(ledger);
        const view = viewOf(ledger, ref, idx)!;
        if (!view.editable) throw new RecordError(403, "read_only", "旧记录只能查看，不能在这里更正。");
        if (view.revision !== p.expectedRevision) {
          throw new RecordError(409, "revision_conflict", "这条记录刚刚被改过，你的改动还没有保存。", { current: this.detailFrom(ledger, id) });
        }
        const eff = effectiveContent(ledger, ref)!.content;
        const changes = p.build(view, eff);
        if (!changes.length) throw bad("没有改动。", "no_change");
        let result;
        try { result = applyCorrection(ledger, { id: p.requestId as string, type: "field", ref, changes, author: WHO_LABEL[who], at: wallOf(this.now()), reason }); }
        catch (e) { throw bad(`这次更正没有通过检查（${(e as Error).message.slice(0, 120)}）。`, "rejected"); }
        const next = result.ledger;
        next.runs.push({ runId: randomUUID(), at: new Date(this.now()).toISOString(), mode: "apply", batchId: `hr-req:${p.requestId}`, inputHash, counts: { corrections: changes.length } });
        return { ledger: next, result: { duplicate: false } };
      });
      this.invalidate();
      const d = await this.detail(id);
      return { duplicate: out.duplicate, ...d! };
    } catch (e) { throw this.asRecordError(e); }
  }

  async correct(who: HealthWho, id: string, body: Record<string, unknown>) {
    const edit = (body.edit ?? {}) as Record<string, unknown>;
    return this.correctVia(who, id, {
      requestId: body.requestId, expectedRevision: body.expectedRevision, reason: body.reason, defaultReason: "家长更正", input: edit,
      build: (view, cur) => {
        const out: { field: string; after: unknown }[] = [];
        const put = (field: string, after: unknown) => { if (hashOf(getVal(cur, field) ?? null) !== hashOf(after ?? null)) out.push({ field, after: after ?? null }); };
        const nowMs = this.now();
        if (view.kind === "note") {
          const sy = normalizeSymptoms(edit.symptoms as Record<string, unknown> | undefined, edit.confirmUnusualTemp === true, view.symptoms);
          const text = cleanText(edit.text, MAX_TEXT, "手记");
          if (!text && !hasSymptoms(sy)) throw bad("手记不能改成空的：写一句话，或者保留一项补充。", "empty_entry");
          put("text", text);
          put("symptoms.temperature", sy.temperature); put("symptoms.temperatureFlag", sy.temperatureFlag);
          put("symptoms.nose", sy.nose); put("symptoms.cough", sy.cough); put("symptoms.nasalVoice", sy.nasalVoice); put("symptoms.sleep", sy.sleep);
          if (edit.when !== undefined) { const t = normalizeWhen(edit.when as WhenInput, nowMs); put("occurredAt", t.occurredAt); put("occurredPrecision", t.occurredPrecision); put("timeBasis", t.timeBasis); }
        } else {
          const h = pair(edit.hospital, edit.hospitalOther, HOSPITALS, "医院"), d = pair(edit.department, edit.departmentOther, DEPARTMENTS, "科室");
          const note = cleanText(edit.note, MAX_TEXT, "备注");
          if (!note && !(view.images?.length)) throw bad("没有报告图时，备注不能清空。", "empty_entry");
          put("hospital", h.value); put("hospitalOther", h.other || null); put("department", d.value); put("departmentOther", d.other || null); put("note", note);
          if (edit.visitDate !== undefined) { const t = normalizeVisitDate(edit.visitDate, nowMs); put("occurredAt", t.occurredAt); put("occurredPrecision", t.occurredPrecision); put("timeBasis", t.timeBasis); }
        }
        return out;
      },
    });
  }

  /** 记错孩子: the record stays (content and history intact) but no longer counts as this child's. Reversible. */
  async setAttribution(who: HealthWho, id: string, body: Record<string, unknown>) {
    const action = body.action;
    if (action !== "void" && action !== "restore") throw bad("操作不正确。");
    return this.correctVia(who, id, {
      requestId: body.requestId, expectedRevision: body.expectedRevision, reason: body.reason, defaultReason: action === "void" ? "记错了孩子" : "恢复归属", input: { action },
      build: (view) => {
        if (action === "void" && view.voided) throw bad("这条已经撤销过归属了。", "no_change");
        if (action === "restore" && !view.voided) throw bad("这条没有被撤销，不需要恢复。", "no_change");
        return [{ field: "attribution", after: action === "void" ? "not_child" : "child" }];
      },
    });
  }
}
const getVal = (c: Content, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (typeof o === "object" && o !== null ? (o as Record<string, unknown>)[k] : undefined), c);
