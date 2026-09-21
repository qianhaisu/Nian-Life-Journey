// Import orchestration. Default is dry-run: plan against the current ledger, report, write nothing.
// Apply re-plans INSIDE the store transaction on the freshly locked ledger, so a concurrent writer
// between "look" and "write" cannot be overwritten; a rejected plan throws before anything is written.
import { randomUUID } from "node:crypto";
import { HealthFileStore } from "./file-store";
import { applyCorrection, applyPlan, planImport, type Batch, type CorrectionInput, type Impact, type Plan, type Validator, CONTENT_VALIDATORS } from "./ledger";
import { businessDigest } from "./model";

export interface ImportReport {
  mode: "dry-run" | "apply";
  applied: boolean;
  batchId: string;
  counts: Plan["counts"];
  items: Plan["items"];
  links: Plan["links"];
  impact: Impact;
  rejected: boolean;
  digestBefore: string;
  digestAfter: string;
}

export async function runImport(store: HealthFileStore, batch: Batch, opts: { apply?: boolean; now?: () => string; runId?: string; validators?: Validator[] } = {}): Promise<ImportReport> {
  const validators = opts.validators ?? CONTENT_VALIDATORS;
  const now = opts.now ?? (() => new Date().toISOString());
  const strip = (plan: Plan, mode: ImportReport["mode"], applied: boolean, before: string, after: string): ImportReport =>
    ({ mode, applied, batchId: plan.batchId, counts: plan.counts, items: plan.items, links: plan.links, impact: plan.impact, rejected: plan.rejected, digestBefore: before, digestAfter: after });
  if (!opts.apply) {
    const ledger = await store.read();
    const plan = planImport(ledger, batch, validators);
    const d = businessDigest(ledger);
    return strip(plan, "dry-run", false, d, d);
  }
  return store.transaction((ledger) => {
    const plan = planImport(ledger, batch, validators);
    const before = businessDigest(ledger);
    if (plan.rejected) throw Object.assign(new Error(`batch ${batch.batchId} rejected; nothing written`), { report: strip(plan, "apply", false, before, before) });
    const next = applyPlan(ledger, plan, { runId: opts.runId ?? randomUUID(), at: now() });
    return { ledger: next, result: strip(plan, "apply", true, before, businessDigest(next)) };
  });
}

export async function runCorrection(store: HealthFileStore, input: CorrectionInput) {
  return store.transaction((ledger) => {
    const r = applyCorrection(ledger, input);
    return { ledger: r.action === "duplicate" ? ledger : r.ledger, result: { action: r.action, impact: r.impact } };
  });
}
