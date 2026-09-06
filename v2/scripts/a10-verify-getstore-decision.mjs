#!/usr/bin/env node
// READ-ONLY verification for A-10: calls the real getStore() (postgres-repository.ts, the exact
// path family-archive.ts and every page use) and checks whether the A-6 trace_eligible rows come
// back as their true stored decision instead of the silently-rewritten "needs_human_review".
//
//   node --import tsx -r dotenv/config scripts/a10-verify-getstore-decision.mjs dotenv_config_path=.env.local
process.env.REPOSITORY_BACKEND = "postgres";
console.error("[a10] importing repository...");
const { getStore } = await import("../lib/db/repository.ts");
console.error("[a10] calling getStore()...");
const start = Date.now();
const store = await getStore();
console.error(`[a10] getStore() resolved in ${Date.now() - start}ms`);
const traceRows = store.qualityReviews.filter((r) => r.targetKind === "life_event_trace" && r.provider === "cowork-a6");
const byDecision = new Map();
for (const r of traceRows) byDecision.set(r.decision, (byDecision.get(r.decision) ?? 0) + 1);

console.log(`target_kind='life_event_trace' rows seen via getStore(): ${traceRows.length}`);
console.log(`decision breakdown:`, Object.fromEntries(byDecision));

const ok = traceRows.length === 153 && byDecision.get("trace_eligible") === 153 && byDecision.size === 1;
console.log(ok ? "PASS: all 153 rows read back as decision='trace_eligible'" : "FAIL: see breakdown above");
process.exit(ok ? 0 : 1);
