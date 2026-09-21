// Explicit adapters from the HEALTH-01 file formats (and incremental WeChat text) to ledger batches.
// They map fields by the actual schema of those files; they invent nothing: an unknown time stays
// unknown (`timeBasis: message_time_only`), a missing precision is left for the validator to reject.
// No family-specific id, date or disease word is used to decide anything here.
import type { Batch, BatchItem, StandaloneLink } from "./ledger";
import { hashOf } from "./model";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ROLE_RULES: [RegExp, string][] = [
  [/medication_(not_given|withheld)/, "medication_not_given"], [/medication_(administered|adherence|course)$/, "medication_administered"],
  [/handoff|handover/, "handoff"], [/remind/, "reminder"], [/question/, "question"],
  [/recollection|_history$|^history$|care_history/, "recall"], [/relayed|hearsay|diagnosis_relayed/, "relay"],
  [/plan|regimen|intent|planned|standby|consider|advice$/, "plan"],
];
export const mapFactKindToRole = (kind: string): string => ROLE_RULES.find(([re]) => re.test(kind))?.[1] ?? "observation";

export function adaptWechatFactsR4(rows: Row[], batchId: string): Batch {
  const items: BatchItem[] = [];
  const links: StandaloneLink[] = [];
  const sourceSeen = new Set<string>();
  const msgIds = new Set(rows.map((r) => r.message_identity));
  const source = (messageIdentity: string, r?: Row) => {
    const id = `wechat:${messageIdentity}`;
    if (sourceSeen.has(id)) return id;
    sourceSeen.add(id);
    items.push({ kind: "source", id, content: r
      ? { conversation: r.conversation, messageIdentity, recordedAt: r.message_time, speaker: r.source_speaker ?? r.speaker, sha1: r.source_sha1, layer: "wechat" }
      : { messageIdentity, layer: "wechat", stub: true, note: "referenced as supporting evidence; message body not in this input" } });
    return id;
  };
  for (const r of rows) if (r.message_identity) source(r.message_identity, r);
  for (const r of rows) {
    const occurredAt = r.occurred_at ?? r.occurred_range?.start ?? r.occurred_range?.[0] ?? null;
    const precision = r.time_precision ?? (r.occurred_range ? "range" : null);
    const c: Row = {
      role: mapFactKindToRole(String(r.fact_kind)), factKind: r.fact_kind, layer: r.layer, conversation: r.conversation,
      recordedAt: r.message_time, occurredAt, occurredPrecision: precision, timeBasis: occurredAt ? r.time_basis : "message_time_only",
      speaker: r.speaker, subject: r.subject ?? null, text: r.source_excerpt, basis: r.basis, reviewStatus: r.review_status, clinicianReviewed: !!r.clinician_reviewed,
    };
    if (r.occurred_range) c.occurredRange = r.occurred_range;
    if (r.time_note) c.timeNote = r.time_note;
    const item: BatchItem = { kind: "observation", id: r.fact_id, content: c, links: [{ role: "from_source", to: { kind: "source", id: source(r.message_identity) } }] };
    for (const sid of r.supporting_message_ids ?? []) item.links!.push({ role: "supports", to: { kind: "source", id: source(sid) } });
    items.push(item);
  }
  return { batchId, items, links };
}

export function adaptEpisodesR4(rows: Row[], batchId: string): Batch {
  const items: BatchItem[] = [];
  const links: StandaloneLink[] = [];
  for (const e of rows) {
    const content: Row = {
      title: e.label, start: e.start ?? null, startBasis: e.start_basis ?? null, end: e.end ?? null, endBasis: e.end_basis ?? null,
      // r4 never asserts "still ongoing": no end record => end unknown, not "ongoing".
      declaredEnd: e.end ? "ended" : "end_unknown", canonical: !!e.canonical, groupId: e.group_id ?? null, keyFindings: e.key_findings ?? [], openQuestions: e.open_q ?? [],
      execution: { actuallyTaken: e.actually_taken ?? null, detail: e.execution_detail ?? null }, treatmentCourse: "unknown",
    };
    items.push({ kind: "episode", id: e.id, content });
    const candidates = new Set<string>(e.candidate_fact_ids ?? []);
    for (const fid of e.wechat_fact_ids ?? []) if (!candidates.has(fid)) links.push({ from: { kind: "observation", id: fid }, role: "attached", to: { kind: "episode", id: e.id }, basis: e.fact_attach_basis?.[fid] ?? "r4_episode_membership" });
    for (const fid of candidates) links.push({ from: { kind: "observation", id: fid }, role: "candidate", to: { kind: "episode", id: e.id }, basis: "r4_association_review_candidate" });
    for (const enc of e.enc ?? []) links.push({ from: { kind: "episode", id: e.id }, role: "encounter", to: { kind: "encounter", id: enc } });
  }
  return { batchId, items, links };
}

export function adaptHospitalR2(input: { encounters: Row[]; canonicalFacts: Row[]; manifest: Row[] }, batchId: string): { batch: Batch; skipped: { id: string; reason: string }[] } {
  const items: BatchItem[] = [];
  const links: StandaloneLink[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const srcId = (r: Row) => `doc:${r.sha256}`;
  const byTag = new Map<string, string>(), byDocId = new Map<string, string>();
  for (const m of input.manifest) {
    if (!m.sha256) continue;
    items.push({ kind: "source", id: srcId(m), content: { sha256: m.sha256, docKind: m.doc_kind ?? m.media_kind, documentId: m.document_id ?? null, captureKind: m.capture_kind ?? null, valueAuthority: m.value_authority ?? null, layer: "hospital_document" } });
    if (m.tag) byTag.set(String(m.tag), srcId(m));
    if (m.document_id) byDocId.set(String(m.document_id), srcId(m));
  }
  const encIds = new Set<string>();
  for (const e of input.encounters) {
    if (e.excluded || !e.kind) { skipped.push({ id: e.id, reason: e.excluded ? "not_patient" : "no_encounter_kind" }); continue; }
    encIds.add(e.id);
    items.push({ kind: "encounter", id: e.id, content: { kind: e.kind, date: e.date, precision: e.prec, hospital: e.hosp ?? null, dept: e.dept ?? null, doctor: e.doctor ?? null, diagnoses: e.dx ?? [], timeBasis: e.time_basis ?? null, time: e.time ?? null, note: e.note ?? null } });
    for (const d of e.docs ?? []) { const s = byTag.get(String(d)); if (s) links.push({ from: { kind: "encounter", id: e.id }, role: "documented_in", to: { kind: "source", id: s } }); }
  }
  for (const f of input.canonicalFacts) {
    if (!encIds.has(f.encounter_id)) { skipped.push({ id: f.canonical_fact_id, reason: f.encounter_id ? "encounter_not_imported" : "no_encounter_id_in_source" }); continue; }
    items.push({ kind: "canonical_fact", id: f.canonical_fact_id, content: { type: f.type, identity: f.identity, value: f.value, structured: f.structured ?? null, agreement: f.agreement, valueConflict: !!f.value_conflict, reviewStatus: f.review_status, corrected: !!f.corrected, abnormal: f.abnormal ?? null, actuallyTaken: f.actually_taken ?? null } });
    links.push({ from: { kind: "canonical_fact", id: f.canonical_fact_id }, role: "of_encounter", to: { kind: "encounter", id: f.encounter_id } });
    for (const d of f.documents ?? []) { const s = byDocId.get(String(d)); if (s) links.push({ from: { kind: "canonical_fact", id: f.canonical_fact_id }, role: "documented_in", to: { kind: "source", id: s } }); }
  }
  return { batch: { batchId, items, links }, skipped };
}

/** Handoff (summary-doc relay layer): kept as its own layer; never counted as a new fact; upstream not accessible is preserved. */
export function adaptHandoff(rows: Row[], batchId: string): Batch {
  const items: BatchItem[] = [];
  const header = rows.find((r) => r.type === "document_header");
  const docId = header ? `handoff:${header.sha256 ?? header.handoff_id}` : null;
  if (header && docId) items.push({ kind: "source", id: docId, content: { layer: "handoff", handoffId: header.handoff_id, sha256: header.sha256 ?? null, nature: header.nature, upstreamAccessible: !!header.upstream_accessible_to_us } });
  for (const r of rows) {
    if (r.type === "document_header" || !r.record_id) continue;
    const recordedAt = r.recorded_at ?? header?.read_at;
    items.push({ kind: "observation", id: r.record_id, content: {
      role: r.content_nature === "parent_recall" ? "recall" : "handoff", contentNature: r.content_nature, topic: r.topic, text: r.summary, recordedAt,
      occurredAt: null, occurredPrecision: null, timeBasis: "unknown", upstreamAccessible: !!r.upstream_accessible, countedAsNewFact: !!r.counted_as_new_fact, decision: r.decision, layer: "handoff",
    }, links: docId ? [{ role: "from_source", to: { kind: "source", id: docId } }] : [] });
  }
  return { batchId, items };
}

// ---------- incremental WeChat text: JSONL or Markdown; sources only (no model extraction here) ----------
export function adaptMessagesJsonl(text: string, batchId: string): Batch {
  const items: BatchItem[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let m: Row;
    try { m = JSON.parse(line); } catch { items.push({ kind: "source", id: `bad-line:${i + 1}`, content: null as unknown as Row }); return; }
    items.push(messageItem(m));
  });
  return { batchId, items };
}
const MD_LINE = /^\s*(?:[-*]\s*)?\[?(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)\]?\s+([^:：\n]{1,40})[:：]\s*(.*)$/;
/** Markdown slices have no message id: identity is weak (conversation+time+speaker+text). */
export function adaptMessagesMarkdown(text: string, conversation: string, batchId: string): Batch {
  const items: BatchItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = MD_LINE.exec(line);
    if (m) items.push(messageItem({ conversation, time: m[1].replace("T", " ").padEnd(19, ":00").slice(0, 19), speaker: m[2].trim(), text: m[3] }));
  }
  return { batchId, items };
}
function messageItem(m: Row): BatchItem {
  const content = { layer: "wechat", conversation: m.conversation, recordedAt: m.time, speaker: m.speaker, text: m.text, sha256: hashOf(m.text ?? "") };
  return m.id ? { kind: "source", id: `wechat:${m.conversation}::${m.id}`, content } : { kind: "source", identity: "weak", content };
}
