// Sunday 5-choice feedback & excludedExperienceTypes idempotent weight tuning (Phase 3).
// Idempotent by `(weekId, sundayFeedback.submittedAt)`: re-running never double-applies weight deltas.
// Handles `went_pitfall` 90-day cooldown pool, `went_tired` walkCapKm tightening (1.2 -> 0.8),
// `stayed_home` zero content deduction, and syncing excluded types.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertOutsideRepository } from "../lib/repo-containment.mjs";
import { resolveEcsConnection } from "../lib/ecs-connection.mjs";
import { addDays } from "../editor/plan.mjs";
import {
  DEFAULT_WALK_CAP_KM,
  TIGHTENED_WALK_CAP_KM,
  normalizeExcludedTypes,
} from "./hard-gates.mjs";

const REPO_LITERAL = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const REPO = { literal: REPO_LITERAL, real: fs.realpathSync.native(REPO_LITERAL) };
export const WEIGHTS_SCHEMA = "nianlife.weekend-weights/1";
export const COOLDOWN_SCHEMA = "nianlife.weekend-cooldown/1";
export const MAX_HYPOTHESIS_WEIGHT = 25;
export const PITFALL_COOLDOWN_DAYS = 90;
export const LOVED_REPEAT_COOLDOWN_DAYS = 60;

export function defaultPreferenceWeights() {
  return {
    schema: WEIGHTS_SCHEMA,
    updatedAt: null,
    walkCapKm: DEFAULT_WALK_CAP_KM,
    minStrippedContentHours: 2.5,
    weatherRestSensitivity: 1.0,
    driveOver90Penalty: 0,
    kidOnlyPenalty: 0,
    hypotheses: {
      H1_water_boat: 18,
      H2_transport_farm: 16,
      H3_gentle_animals: 15,
      H4_adult_scenery_food: 14,
      H5_overnight_atour: 12,
      H6_flat_stroller: 15,
      H7_seasonal_texture: 15,
      H8_sensory_avoid: -40,
    },
    typeMultipliers: {},
    excludedExperienceTypes: [
      {
        experienceType: "art_museum_exhibition",
        label: "美术馆/艺术展",
        excludedAt: "2026-11-17T00:10:00.000Z",
        addedBy: "family_rule",
      },
    ],
    processedReceipts: {},
  };
}

export function defaultCooldownPool() {
  return {
    schema: COOLDOWN_SCHEMA,
    updatedAt: null,
    venues: [],
  };
}

function writeJsonAtomicOutsideRepo(filePath, value) {
  assertOutsideRepository(filePath, REPO);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

export function readPreferenceWeights(weightsPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(weightsPath, "utf8"));
    if (parsed && parsed.schema === WEIGHTS_SCHEMA) {
      return {
        ...defaultPreferenceWeights(),
        ...parsed,
        hypotheses: { ...defaultPreferenceWeights().hypotheses, ...(parsed.hypotheses ?? {}) },
        processedReceipts: { ...(parsed.processedReceipts ?? {}) },
      };
    }
  } catch { /* fallback */ }
  return defaultPreferenceWeights();
}

export function readCooldownPool(cooldownPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cooldownPath, "utf8"));
    if (parsed && parsed.schema === COOLDOWN_SCHEMA && Array.isArray(parsed.venues)) {
      return parsed;
    }
  } catch { /* fallback */ }
  return defaultCooldownPool();
}

export function isVenueInCooldown(venueKeyOrTitle, cooldownPool, targetDay) {
  const venues = cooldownPool?.venues ?? [];
  const needle = String(venueKeyOrTitle ?? "").trim().toLowerCase();
  if (!needle) return { active: false, entry: null };
  for (const entry of venues) {
    if (!entry || entry.kind === "loved_repeat_cooldown") continue;
    if (entry.cooldownUntil && targetDay && targetDay > entry.cooldownUntil) continue;
    const key = String(entry.venueKey ?? "").toLowerCase();
    const name = String(entry.venueName ?? "").toLowerCase();
    const pid = String(entry.proposalId ?? "").toLowerCase();
    if ((key && (needle.includes(key) || key.includes(needle))) ||
        (name && (needle.includes(name) || name.includes(needle))) ||
        (pid && pid === needle)) {
      return { active: true, entry };
    }
  }
  return { active: false, entry: null };
}

function clampHypothesis(val) {
  return Math.min(MAX_HYPOTHESIS_WEIGHT, Math.max(-50, val));
}

function inferHypothesesForProposal(proposal) {
  const text = `${proposal?.experienceType ?? ""} ${proposal?.experienceTypeLabel ?? ""} ${proposal?.title ?? ""}`;
  const hits = [];
  if (/boat|water|wetland|船|湖|湿地|水岸/.test(text)) hits.push("H1_water_boat");
  if (/train|farm|harvest|rail|火车|农|采摘|牧场/.test(text)) hits.push("H2_transport_farm");
  if (/animal|bird|pigeon|羊|鸽|动物|鱼/.test(text)) hits.push("H3_gentle_animals");
  if (/street|market|mall|shop|逛|街|市集|草坪|放空|风物/.test(text)) hits.push("H4_adult_scenery_food");
  if (proposal?.isOvernight || /亚朵|住一晚/.test(text)) hits.push("H5_overnight_atour");
  if (/平路|绿道|推车/.test(text)) hits.push("H6_flat_stroller");
  if (/芦苇|水杉|银杏|季节|红叶|秋/.test(text)) hits.push("H7_seasonal_texture");
  return hits.length > 0 ? hits : ["H4_adult_scenery_food"];
}

/**
 * Pure idempotent tuner: applies `state.sundayFeedback` (keyed by `weekId::submittedAt`) and
 * `excludedExperienceTypes` onto `weights` and `cooldown`.
 */
export function applyFeedbackAndExclusions({
  weekId,
  state,
  excludedExperienceTypes = [],
  proposalMeta = null,
  weights,
  cooldown,
  nowIso = new Date().toISOString(),
}) {
  const nextWeights = structuredClone(weights ?? defaultPreferenceWeights());
  const nextCooldown = structuredClone(cooldown ?? defaultCooldownPool());

  const normalizedExcl = Array.isArray(excludedExperienceTypes)
    ? excludedExperienceTypes
    : Array.isArray(excludedExperienceTypes?.excludedExperienceTypes)
      ? excludedExperienceTypes.excludedExperienceTypes
      : [];
  nextWeights.excludedExperienceTypes = normalizedExcl;
  const { typeSet } = normalizeExcludedTypes(normalizedExcl);

  // Zero out multipliers for any excluded experience type (hard guard: never restore art)
  for (const expType of typeSet) {
    nextWeights.typeMultipliers[expType] = 0;
  }

  const fb = state?.sundayFeedback;
  const outcome = fb?.outcome ?? null;
  const submittedAt = fb?.submittedAt ?? null;
  const tags = Array.isArray(fb?.tags) ? fb.tags : [];
  const proposalId = fb?.proposalId ?? state?.selectedProposalId ?? proposalMeta?.id ?? null;

  if (!outcome || !submittedAt) {
    nextWeights.updatedAt = nowIso;
    return { appliedFeedback: false, reason: "no_sunday_feedback", weights: nextWeights, cooldown: nextCooldown };
  }

  const receiptKey = `${weekId}::${submittedAt}`;
  if (nextWeights.processedReceipts[receiptKey]) {
    return {
      appliedFeedback: false,
      reason: "already_processed_idempotent",
      receiptKey,
      weights: nextWeights,
      cooldown: nextCooldown,
    };
  }

  const anchorDate = weekId;
  const matchedHypotheses = inferHypothesesForProposal(proposalMeta);

  if (outcome === "went_loved") {
    for (const hKey of matchedHypotheses) {
      const delta = hKey === "H2_transport_farm" ? 4 : 3;
      nextWeights.hypotheses[hKey] = clampHypothesis((nextWeights.hypotheses[hKey] ?? 14) + delta);
    }
    if (proposalMeta?.experienceType && !typeSet.has(proposalMeta.experienceType)) {
      nextWeights.typeMultipliers[proposalMeta.experienceType] = Number(
        ((nextWeights.typeMultipliers[proposalMeta.experienceType] ?? 1.0) + 0.1).toFixed(2),
      );
    }
    if (proposalId) {
      nextCooldown.venues.push({
        kind: "loved_repeat_cooldown",
        venueKey: proposalMeta?.region || proposalMeta?.title || proposalId,
        venueName: proposalMeta?.title || proposalId,
        proposalId,
        experienceType: proposalMeta?.experienceType ?? null,
        outcome,
        enteredAt: submittedAt,
        cooldownUntil: addDays(anchorDate, LOVED_REPEAT_COOLDOWN_DAYS),
        cooldownDays: LOVED_REPEAT_COOLDOWN_DAYS,
      });
    }
  } else if (outcome === "went_adult_meh") {
    nextWeights.kidOnlyPenalty = Math.min(20, (nextWeights.kidOnlyPenalty ?? 0) + 2);
    // Boost adult non-art delight (never art_exhibition / art_museum_exhibition)
    nextWeights.hypotheses.H4_adult_scenery_food = clampHypothesis(
      (nextWeights.hypotheses.H4_adult_scenery_food ?? 14) + 4,
    );
  } else if (outcome === "went_tired") {
    nextWeights.driveOver90Penalty = (nextWeights.driveOver90Penalty ?? 0) - 5;
    nextWeights.walkCapKm = TIGHTENED_WALK_CAP_KM;
    nextWeights.hypotheses.H5_overnight_atour = clampHypothesis(
      (nextWeights.hypotheses.H5_overnight_atour ?? 12) + 3,
    );
  } else if (outcome === "went_pitfall") {
    const cooldownUntil = addDays(anchorDate, PITFALL_COOLDOWN_DAYS);
    const venueName = proposalMeta?.title || proposalId || weekId;
    nextCooldown.venues.push({
      kind: "pitfall_90d_cooldown",
      venueKey: proposalMeta?.region || venueName,
      venueName,
      proposalId,
      experienceType: proposalMeta?.experienceType ?? null,
      outcome,
      tags,
      enteredAt: submittedAt,
      cooldownUntil,
      cooldownDays: PITFALL_COOLDOWN_DAYS,
    });
    if (tags.some((t) => /异味|闷热|人太多|排队/.test(String(t)))) {
      nextWeights.hypotheses.H8_sensory_avoid = Math.max(
        -80,
        Math.round((nextWeights.hypotheses.H8_sensory_avoid ?? -40) * 1.5),
      );
    }
    if (tags.some((t) => /跑一趟只吃饭/.test(String(t)))) {
      nextWeights.minStrippedContentHours = Math.min(4.0, (nextWeights.minStrippedContentHours ?? 2.5) + 0.5);
    }
  } else if (outcome === "stayed_home") {
    // Strictly zero content preference deduction on stayed_home!
    if (tags.some((t) => /天气/.test(String(t)))) {
      nextWeights.weatherRestSensitivity = Number(((nextWeights.weatherRestSensitivity ?? 1.0) + 0.1).toFixed(2));
    }
  }

  nextWeights.processedReceipts[receiptKey] = {
    weekId,
    outcome,
    tags,
    proposalId,
    submittedAt,
    processedAt: nowIso,
  };
  nextWeights.updatedAt = nowIso;
  nextCooldown.updatedAt = nowIso;

  return {
    appliedFeedback: true,
    receiptKey,
    outcome,
    weights: nextWeights,
    cooldown: nextCooldown,
  };
}

/**
 * Fetches live weekend state + excluded types from local stateDir, HTTPS `/api/weekend-state`,
 * or ECS SSH fallback (read-only).
 */
export async function fetchWeekendStateBundle(
  weekId,
  {
    localStateDir = null,
    siteUrl = process.env.NIANLIFE_SITE_URL || "https://nianlife.cn",
    fetchImpl = fetch,
    useRemoteHttp = true,
    useSsh = false,
  } = {},
) {
  let state = null;
  let excludedExperienceTypes = null;
  let source = "none";

  if (localStateDir) {
    const stateFile = path.join(localStateDir, `${weekId}.json`);
    const exclFile = path.join(localStateDir, "excluded-types.json");
    if (fs.existsSync(stateFile)) {
      try {
        state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        source = "local_file";
      } catch { /* ignore */ }
    }
    if (fs.existsSync(exclFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(exclFile, "utf8"));
        excludedExperienceTypes = Array.isArray(parsed)
          ? parsed
          : parsed?.excludedExperienceTypes ?? parsed?.items ?? null;
      } catch { /* ignore */ }
    }
  }

  if (!state && useRemoteHttp) {
    try {
      const res = await fetchImpl(`${siteUrl.replace(/\/+$/, "")}/api/weekend-state?weekId=${encodeURIComponent(weekId)}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const body = await res.json();
        if (body?.ok && body?.state) {
          state = body.state;
          if (Array.isArray(body.excludedExperienceTypes)) {
            excludedExperienceTypes = body.excludedExperienceTypes;
          }
          source = "http_api";
        }
      }
    } catch { /* fallback to ssh or local */ }
  }

  if (!state && useSsh) {
    try {
      const ecs = resolveEcsConnection();
      const sshBin = fs.existsSync("C:\\Program Files\\Git\\usr\\bin\\ssh.exe")
        ? "C:\\Program Files\\Git\\usr\\bin\\ssh.exe"
        : "ssh";
      const remoteCmd = `sudo cat /srv/nianlife-content/weekend/state/${weekId}.json 2>/dev/null || echo '{}'; echo '---SPLIT---'; sudo cat /srv/nianlife-content/weekend/state/excluded-types.json 2>/dev/null || echo '[]'`;
      const res = spawnSync(sshBin, ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-i", ecs.key, ecs.ssh, remoteCmd], {
        encoding: "utf8",
        timeout: 25_000,
      });
      if (res.status === 0 && res.stdout) {
        const [rawState, rawExcl] = res.stdout.split("---SPLIT---");
        const parsedState = JSON.parse((rawState || "{}").trim());
        if (parsedState?.weekId) {
          state = parsedState;
          source = "ecs_ssh";
        }
        const parsedExcl = JSON.parse((rawExcl || "[]").trim());
        excludedExperienceTypes = Array.isArray(parsedExcl)
          ? parsedExcl
          : parsedExcl?.excludedExperienceTypes ?? parsedExcl?.items ?? excludedExperienceTypes;
      }
    } catch { /* ignore */ }
  }

  return {
    source,
    state: state ?? {
      schema: "nianlife.weekend-state/1",
      weekId,
      updatedAt: null,
      selectedProposalId: null,
      selectedDeparture: null,
      fridayAlertAck: { adoptedSwap: false, updatedAt: null },
      sundayFeedback: { outcome: null, tags: [], submittedAt: null, proposalId: null },
      feedbackReceiptKeys: [],
    },
    excludedExperienceTypes: excludedExperienceTypes ?? defaultPreferenceWeights().excludedExperienceTypes,
  };
}

export async function runFeedbackTune({
  weekId,
  opsStateDir = path.join(os.homedir(), "NianlifeOps", "ops-daily", "state", "weekend"),
  remoteStateDir = null,
  proposalMeta = null,
  useRemoteHttp = true,
  useSsh = false,
  fetchImpl = fetch,
} = {}) {
  const weightsPath = path.join(opsStateDir, "preference-weights.json");
  const cooldownPath = path.join(opsStateDir, "cooldown-venues.json");
  const excludedLocalPath = path.join(opsStateDir, "excluded-types.json");

  const bundle = await fetchWeekendStateBundle(weekId, {
    localStateDir: remoteStateDir,
    useRemoteHttp,
    useSsh,
    fetchImpl,
  });

  const weights = readPreferenceWeights(weightsPath);
  const cooldown = readCooldownPool(cooldownPath);

  const res = applyFeedbackAndExclusions({
    weekId,
    state: bundle.state,
    excludedExperienceTypes: bundle.excludedExperienceTypes,
    proposalMeta,
    weights,
    cooldown,
  });

  writeJsonAtomicOutsideRepo(weightsPath, res.weights);
  writeJsonAtomicOutsideRepo(cooldownPath, res.cooldown);
  writeJsonAtomicOutsideRepo(excludedLocalPath, {
    schema: "nianlife.weekend-excluded-types/1",
    updatedAt: new Date().toISOString(),
    excludedExperienceTypes: res.weights.excludedExperienceTypes,
  });

  return {
    ok: true,
    weekId,
    source: bundle.source,
    appliedFeedback: res.appliedFeedback,
    reason: res.reason ?? null,
    receiptKey: res.receiptKey ?? null,
    weightsPath,
    cooldownPath,
    state: bundle.state,
    excludedExperienceTypes: res.weights.excludedExperienceTypes,
  };
}
