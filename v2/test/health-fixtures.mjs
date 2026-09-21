// Synthetic health fixtures: invented ids/dates/text only. No real family data.
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HealthFileStore } from "../lib/health/file-store.ts";

export async function tmpStore(opts) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "health-test-"));
  return { dir, store: new HealthFileStore(dir, opts) };
}
export const NOW = () => "2030-01-01T00:00:00Z";

export const src = (id, extra = {}) => ({ kind: "source", id, content: { layer: "chat", conversation: "c1", recordedAt: "2030-03-01 10:00:00", speaker: "A", ...extra } });
export function obs(id, { role = "observation", recordedAt = "2030-03-01 10:00:00", occurredAt = null, precision = null, text = `t-${id}`, sources = ["s1"], extra = {} } = {}) {
  return {
    kind: "observation", id,
    content: { role, recordedAt, occurredAt, occurredPrecision: precision, timeBasis: occurredAt ? "explicit_in_text" : "message_time_only", text, ...extra },
    links: sources.map((s, i) => ({ role: i === 0 ? "from_source" : "supports", to: { kind: "source", id: s } })),
  };
}
export const episode = (id, extra = {}) => ({ kind: "episode", id, content: { title: `ep ${id}`, start: "2030-03-01", startBasis: "test", end: null, declaredEnd: "end_unknown", treatmentCourse: "unknown", ...extra } });
export const encounter = (id, extra = {}) => ({ kind: "encounter", id, content: { kind: "visit", date: "2030-03-01", ...extra } });
export const link = (fromKind, fromId, role, toKind, toId) => ({ from: { kind: fromKind, id: fromId }, role, to: { kind: toKind, id: toId } });
export const batch = (batchId, items, links = []) => ({ batchId, items, links });

/** Three episodes; e1 and e2 fall on the same day (different events), e3 is a later follow-up. */
export function baseBatch() {
  return batch("base", [
    src("s1"), src("s2", { recordedAt: "2030-03-02 09:00:00" }), src("s3", { recordedAt: "2030-03-09 09:00:00" }),
    obs("o1", { role: "symptom_report", sources: ["s1", "s2"] }),
    obs("o2", { role: "medication_administered", recordedAt: "2030-03-02 09:00:00", sources: ["s2"], extra: { measure: { value: 5, unit: "ml" } } }),
    obs("o3", { role: "plan", recordedAt: "2030-03-09 09:00:00", sources: ["s3"] }),
    obs("o4", { role: "question", sources: ["s1"] }),
    obs("o5", { role: "recall", recordedAt: "2030-03-09 09:00:00", sources: ["s3"] }),
    encounter("E1"),
    episode("e1"), episode("e2", { title: "other part same day" }), episode("e3", { start: "2030-03-09" }),
  ], [
    link("observation", "o1", "attached", "episode", "e1"), link("observation", "o2", "attached", "episode", "e1"),
    link("observation", "o4", "candidate", "episode", "e1"), link("observation", "o3", "attached", "episode", "e3"),
    link("observation", "o5", "background", "episode", "e3"), link("episode", "e1", "encounter", "encounter", "E1"),
  ]);
}
