// Read-only candidate trip hint generator (Phase 3).
// Writes ONLY to C:/Users/teddy/NianlifeOps/ops-daily/state/weekend/trip-hints/<weekId>.json.
// NEVER mutates v2/lib/travel/trips.json (formal travel archive requires Quark GPS photos >=3
// outside Hangzhou or published daily story facts).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { assertOutsideRepository } from "../lib/repo-containment.mjs";
import { addDays } from "../editor/plan.mjs";

const REPO_LITERAL = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const REPO = { literal: REPO_LITERAL, real: fs.realpathSync.native(REPO_LITERAL) };
export const TRIP_HINT_SCHEMA = "nianlife.weekend-trip-hint/1";

function loadPlacesReadOnly() {
  try {
    const placesPath = fileURLToPath(new URL("../../lib/travel/places.json", import.meta.url));
    const parsed = JSON.parse(fs.readFileSync(placesPath, "utf8"));
    return Array.isArray(parsed?.places) ? parsed.places : [];
  } catch {
    return [];
  }
}

export function matchSuggestedPlaces(text, places = loadPlacesReadOnly()) {
  const haystack = String(text ?? "");
  const matched = [];
  for (const p of places) {
    if (p.level !== "city" && p.level !== "spot") continue;
    if (p.home) continue;
    const names = [p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])].filter(Boolean);
    if (names.some((n) => haystack.includes(n))) {
      matched.push({ id: p.id, name: p.name, level: p.level });
    }
  }
  return matched;
}

export function buildCandidateTripHint({
  weekId,
  snapshot = null,
  state = null,
  nowIso = new Date().toISOString(),
}) {
  const outcome = state?.sundayFeedback?.outcome ?? null;
  if (outcome === "stayed_home") {
    return { shouldEmit: false, reason: "stayed_home", hint: null };
  }

  const wentOutcome = typeof outcome === "string" && outcome.startsWith("went_");
  const targetProposalId = state?.sundayFeedback?.proposalId ?? state?.selectedProposalId ?? null;
  if (!targetProposalId && !wentOutcome) {
    return { shouldEmit: false, reason: "no_selection_or_went_feedback", hint: null };
  }

  const proposals = Array.isArray(snapshot?.proposals) ? snapshot.proposals : [];
  const proposal = proposals.find((p) => p?.id === targetProposalId) ?? null;
  const from = snapshot?.weekendRange?.from ?? weekId;
  const to = snapshot?.weekendRange?.to ?? addDays(weekId, 1);
  const searchText = [proposal?.title, proposal?.region, proposal?.subtitle].filter(Boolean).join(" ");
  const suggestedPlaces = matchSuggestedPlaces(searchText);

  return {
    shouldEmit: true,
    reason: wentOutcome ? `sunday_feedback:${outcome}` : "selected_proposal",
    hint: {
      schema: TRIP_HINT_SCHEMA,
      readonly: true,
      autoMutateTripsJson: false,
      weekId,
      weekendRange: { from, to },
      generatedAt: nowIso,
      proposalId: targetProposalId,
      proposalTitle: proposal?.title ?? null,
      region: proposal?.region ?? null,
      experienceType: proposal?.experienceType ?? null,
      experienceTypeLabel: proposal?.experienceTypeLabel ?? null,
      isOvernight: proposal?.isOvernight ?? null,
      selectedDeparture: state?.selectedDeparture ?? null,
      sundayFeedback: state?.sundayFeedback ?? null,
      suggestedPlaces,
      verificationRequirement:
        "仅作每日审编参考线索（绝不自动改写 v2/lib/travel/trips.json）：须经 Quark 杭州市域外带坐标照片（>=3 张）或当周已发布日页原话实证后，才由审编会话或人工确认是否转入正式旅行档案。",
    },
  };
}

export function writeCandidateTripHint({
  weekId,
  snapshot = null,
  state = null,
  opsStateDir = path.join(os.homedir(), "NianlifeOps", "ops-daily", "state", "weekend"),
  nowIso = new Date().toISOString(),
}) {
  const res = buildCandidateTripHint({ weekId, snapshot, state, nowIso });
  if (!res.shouldEmit || !res.hint) {
    return { created: false, reason: res.reason, path: null, hint: null };
  }
  const hintPath = path.join(opsStateDir, "trip-hints", `${weekId}.json`);
  assertOutsideRepository(hintPath, REPO);
  fs.mkdirSync(path.dirname(hintPath), { recursive: true });
  const tmp = `${hintPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(res.hint, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, hintPath);
  return { created: true, reason: res.reason, path: hintPath, hint: res.hint };
}

/**
 * Finds read-only weekend trip hints whose weekendRange overlaps `[fromDay, throughDay]`.
 * Used by `codex-editor.mjs prepare` without mutating any repository file.
 */
export function loadOverlappingTripHints({
  fromDay,
  throughDay,
  opsStateDir = path.join(os.homedir(), "NianlifeOps", "ops-daily", "state", "weekend"),
}) {
  const hintsDir = path.join(opsStateDir, "trip-hints");
  if (!fs.existsSync(hintsDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(hintsDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(hintsDir, name), "utf8"));
      if (parsed?.schema !== TRIP_HINT_SCHEMA) continue;
      const wFrom = parsed.weekendRange?.from ?? parsed.weekId;
      const wTo = parsed.weekendRange?.to ?? wFrom;
      if (wTo >= fromDay && wFrom <= throughDay) {
        out.push(parsed);
      }
    } catch { /* ignore invalid file */ }
  }
  return out;
}
