// Explicit adapters from the HEALTH-01 file formats to ledger batches (accepted-fact path).
// They map fields by the actual schema of those files; they invent nothing: an unknown time stays
// unknown (`timeBasis: message_time_only`), a missing precision is left for the validator to reject,
// and no reviewer or correction is fabricated. No family-specific id, date or disease word decides anything.
// Raw chat messages (incremental WeChat) are handled by scripts/health-import/message-adapters.mjs and
// become `source` entities only — they are NOT health events until an accepted-fact file (this module) says so.
import type { Batch, BatchItem, HistoricalCorrection, StandaloneLink } from "./ledger";
import type { Ref } from "./model";

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
    const occurredAt = r.occurred_at ?? r.occurred_range?.[0] ?? r.occurred_range?.start ?? null;
    const precision = r.time_precision ?? (r.occurred_range ? "range" : null);
    const c: Row = {
      role: mapFactKindToRole(String(r.fact_kind)), factKind: r.fact_kind, layer: r.layer, conversation: r.conversation,
      recordedAt: r.message_time, occurredAt, occurredPrecision: occurredAt ? precision : null, timeBasis: occurredAt ? r.time_basis : "message_time_only",
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

/**
 * R4 episodes. Optional inputs keep the accepted terminal state whole: `groups` (episode-groups-r4.jsonl) for
 * canonical/group views, `association` (episode-association-review.jsonl) so each link's basis is the recorded decision reason.
 * handoff_refs become links from the summary-relay observation to the episode: never "attached" (they are relays and are
 * not counted as new facts): candidate when the record itself says candidate, otherwise same-period background.
 */
export function adaptEpisodesR4(rows: Row[], batchId: string, opts: { groups?: Row[]; association?: Row[] } = {}): Batch {
  const items: BatchItem[] = [];
  const links: StandaloneLink[] = [];
  const groups = new Map((opts.groups ?? []).map((g) => [g.group_id, g]));
  const assoc = new Map((opts.association ?? []).map((a) => [`${a.fact_id}>${a.episode}`, a]));
  for (const e of rows) {
    const g = groups.get(e.group_id);
    const content: Row = {
      title: e.label, start: e.start ?? null, startBasis: e.start_basis ?? null, end: e.end ?? null, endBasis: e.end_basis ?? null,
      // r4 never asserts "still ongoing": no end record => end unknown, not "ongoing".
      declaredEnd: e.end ? "ended" : "end_unknown", canonical: !!e.canonical, canonicalBasis: e.canonical_basis ?? null, supersededBy: e.superseded_by ?? null,
      groupId: e.group_id ?? null, primaryInGroup: e.primary_in_group ?? null,
      group: g ? { views: g.views, primaryView: g.primary_view, encounters: g.encounters, basis: g.basis } : null,
      keyFindings: e.key_findings ?? [], openQuestions: e.open_q ?? [], encounterRefs: e.encounters ?? [], hospitalSource: e.hospital_source ?? null,
      execution: { actuallyTaken: e.actually_taken ?? null, detail: e.execution_detail ?? null, reports: e.execution_reports ?? [], reportedNotGiven: e.reported_not_given ?? [] },
      treatmentCourse: "unknown",
    };
    items.push({ kind: "episode", id: e.id, content });
    const candidates = new Set<string>(e.candidate_fact_ids ?? []);
    const basisOf = (fid: string, fallback: string) => {
      const a = assoc.get(`${fid}>${e.id}`);
      return a ? `${a.decision}: ${a.reason}` : fallback;
    };
    for (const fid of e.wechat_fact_ids ?? []) if (!candidates.has(fid)) links.push({ from: { kind: "observation", id: fid }, role: "attached", to: { kind: "episode", id: e.id }, basis: basisOf(fid, e.fact_attach_basis?.[fid] ?? "r4_episode_membership") });
    for (const fid of candidates) links.push({ from: { kind: "observation", id: fid }, role: "candidate", to: { kind: "episode", id: e.id }, basis: basisOf(fid, "r4_association_review_candidate") });
    for (const enc of e.enc ?? []) links.push({ from: { kind: "episode", id: e.id }, role: "encounter", to: { kind: "encounter", id: enc } });
    for (const h of e.handoff_refs ?? []) {
      const candidate = /candidate/.test(String(h.decision));
      links.push({ from: { kind: "observation", id: h.record_id }, role: candidate ? "candidate" : "background", to: { kind: "episode", id: e.id }, basis: `handoff ${h.decision} via ${h.link_basis}; upstream_accessible=${h.upstream_accessible}` });
    }
  }
  return { batchId, items, links };
}

/**
 * R2 hospital layer. Keeps: every original file under a shared document id (one-to-many), primary source and
 * agreement detail per fact, the OCR observation ids, and the historical correction chain (author never invented).
 * A canonical fact with no encounter id stays a fact (unattached), it is not dropped and no encounter is invented.
 */
export function adaptHospitalR2(input: { encounters: Row[]; canonicalFacts: Row[]; manifest: Row[]; corrections?: Row[] }, batchId: string): { batch: Batch; skipped: { id: string; reason: string }[] } {
  const items: BatchItem[] = [];
  const links: StandaloneLink[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const srcId = (r: Row) => `doc:${r.sha256}`;
  const byTag = new Map<string, string[]>(), byDocId = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => { const a = m.get(k) ?? []; if (!a.includes(v)) a.push(v); m.set(k, a); };
  for (const m of input.manifest) {
    if (!m.sha256) { skipped.push({ id: String(m.source_id ?? m.tag ?? "?"), reason: "manifest_row_without_sha256" }); continue; }
    items.push({ kind: "source", id: srcId(m), content: {
      sha256: m.sha256, docKind: m.doc_kind ?? m.media_kind, documentId: m.document_id ?? null, documentIdBasis: m.document_id_basis ?? null, captureKind: m.capture_kind ?? null,
      valueAuthority: m.value_authority ?? null, layer: "hospital_document", root: m.root ?? null, relPath: m.rel_path ?? null, bytes: m.bytes ?? null, tag: m.tag ?? null,
      patientSubject: m.patient_subject ?? null, patientBasis: m.patient_basis ?? null, encounterId: m.encounter_id ?? null, datePrecision: m.date_precision ?? null,
      claudeVerified: m.claude_verified ?? null, reviewNote: m.review_note ?? null, status: m.status ?? null, supersededBy: m.superseded_by ?? null, canonicalInput: m.canonical_input ?? null,
    } });
    if (m.tag) push(byTag, String(m.tag), srcId(m));
    if (m.document_id) push(byDocId, String(m.document_id), srcId(m));
  }
  const encIds = new Set<string>();
  for (const e of input.encounters) {
    if (e.excluded || !e.kind) { skipped.push({ id: e.id, reason: e.excluded ? "not_patient" : "no_encounter_kind" }); continue; }
    encIds.add(e.id);
    items.push({ kind: "encounter", id: e.id, content: { kind: e.kind, date: e.date, precision: e.prec, hospital: e.hosp ?? null, dept: e.dept ?? null, doctor: e.doctor ?? null, diagnoses: e.dx ?? [], timeBasis: e.time_basis ?? null, time: e.time ?? null, note: e.note ?? null } });
    for (const d of e.docs ?? []) for (const s of byTag.get(String(d)) ?? []) links.push({ from: { kind: "encounter", id: e.id }, role: "documented_in", to: { kind: "source", id: s } });
  }
  const primaryTagOf = (v: unknown) => String(v ?? "").replace(/^[a-z]+:/, "");
  const factsByTagValue: { id: string; tags: string[]; value: string }[] = [];
  for (const f of input.canonicalFacts) {
    if (f.encounter_id && !encIds.has(f.encounter_id)) { skipped.push({ id: f.canonical_fact_id, reason: "encounter_not_imported_or_not_patient" }); continue; }
    items.push({ kind: "canonical_fact", id: f.canonical_fact_id, content: {
      type: f.type, identity: f.identity, value: f.value, structured: f.structured ?? null, agreement: f.agreement, agreementDetail: f.agreement_detail ?? null, valueConflict: !!f.value_conflict,
      allSourceValues: f.all_source_values ?? null, sourceCount: f.source_count ?? null, primarySource: f.primary_source ?? null, primarySourceReason: f.primary_source_reason ?? null,
      rawObservations: f.observations ?? [], reviewStatus: f.review_status, corrected: !!f.corrected, abnormal: f.abnormal ?? null, actuallyTaken: f.actually_taken ?? null, patient: f.patient ?? null,
    } });
    if (f.encounter_id) links.push({ from: { kind: "canonical_fact", id: f.canonical_fact_id }, role: "of_encounter", to: { kind: "encounter", id: f.encounter_id } });
    const docs = new Map<string, string>(); // every original file behind each document id, one-to-many
    for (const d of f.documents ?? []) for (const s of byDocId.get(String(d)) ?? []) docs.set(s, "document_id");
    for (const s of byTag.get(primaryTagOf(f.primary_source)) ?? []) docs.set(s, "primary_source");
    for (const [s, why] of docs) links.push({ from: { kind: "canonical_fact", id: f.canonical_fact_id }, role: "documented_in", to: { kind: "source", id: s }, basis: why });
    factsByTagValue.push({ id: f.canonical_fact_id, tags: [...docs.keys()], value: String(f.value ?? "") });
  }
  // Historical corrections: recorded as history only (values are already corrected in the imported facts). Targets are
  // the facts whose primary or document sources carry the corrected text; none found => no target, reported, not guessed.
  const historical: HistoricalCorrection[] = [];
  for (const c of input.corrections ?? []) {
    const srcs = byTag.get(String(c.tag)) ?? [];
    if (!srcs.length) { skipped.push({ id: String(c.id), reason: "historical_correction_source_tag_not_in_manifest" }); continue; }
    const targets: Ref[] = factsByTagValue.filter((f) => f.tags.some((t) => srcs.includes(t)) && String(c.corrected ?? "") !== "" && f.value.includes(String(c.corrected))).map((f) => ({ kind: "canonical_fact" as const, id: f.id }));
    historical.push({ id: `hist:${c.id}`, ref: { kind: "source", id: srcs[0] }, field: String(c.field), before: c.original ?? null, after: c.corrected ?? null, method: String(c.method ?? "unknown"), status: String(c.status ?? "unknown"), at: String(c.reviewed_at ?? ""), reason: String(c.basis ?? c.note ?? ""), targets });
  }
  return { batch: { batchId, items, links, historical }, skipped };
}

/**
 * Summary-document relay layer (a GPT summary the family pasted, NOT a medication handover): role `summary_relay`,
 * never counted as a new fact, upstream inaccessibility preserved. Episode links come from the episode file's handoff_refs.
 */
export function adaptHandoff(rows: Row[], batchId: string): Batch {
  const items: BatchItem[] = [];
  const header = rows.find((r) => r.type === "document_header");
  const docId = header ? `handoff:${header.sha256 ?? header.handoff_id}` : null;
  if (header && docId) items.push({ kind: "source", id: docId, content: { layer: "summary_relay", handoffId: header.handoff_id, sha256: header.sha256 ?? null, nature: header.nature, upstreamAccessible: !!header.upstream_accessible_to_us, coverageDeclared: header.coverage_declared ?? null, exportDateDeclared: header.export_date_declared ?? null } });
  for (const r of rows) {
    if (r.type === "document_header" || !r.record_id) continue;
    items.push({ kind: "observation", id: r.record_id, content: {
      role: "summary_relay", contentNature: r.content_nature, topic: r.topic, text: r.summary, recordedAt: r.recorded_at ?? header?.read_at,
      occurredAt: null, occurredPrecision: null, timeBasis: "unknown", upstreamAccessible: !!r.upstream_accessible, countedAsNewFact: !!r.counted_as_new_fact, decision: r.decision, section: r.section ?? null, layer: "summary_relay",
    }, links: docId ? [{ role: "from_source", to: { kind: "source", id: docId } }] : [] });
  }
  return { batchId, items };
}
