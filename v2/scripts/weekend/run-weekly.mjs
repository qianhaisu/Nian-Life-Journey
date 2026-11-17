// Weekly orchestration CLI for Nianlife "Weekend Planner" (Phase 2/3).
// Stages:
//   collect-init      (Mon 20:00) Weather + Stage1/2 XHS persistent crawl
//   verify-deep       (Tue 20:00) Supplemental XHS + Ctrip logged-in hotels + official detail cleanup
//   build-and-publish (Wed 20:00) Hard-gates + ranking + snapshot build (or honest unavailable) + ECS weekend-install
//   refresh-friday    (Fri 17:30) Weather + wttr.in calibration + fridayAlert (keeps selected proposal order)
//   sync-feedback     (Sun 20:30) Idempotent feedback weight tuning + 90d cooldown + read-only trip-hint
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertOutsideRepository } from "../lib/repo-containment.mjs";
import { acquireProcessLock, releaseProcessLock, writeJsonAtomic } from "../editor/pipeline-status.mjs";
import { addDays, shanghaiToday } from "../editor/plan.mjs";
import { fetchWeekendWeatherBundle } from "./sources-weather.mjs";
import {
  DEFAULT_OPS_WEEKEND_STATE_DIR,
  DEFAULT_WEEKEND_BASE_DIR,
  crawlXhsBatch,
  generateStage2PlaceKeywords,
  readExcludedTypesFile,
} from "./sources-xhs.mjs";
import { checkCtripHotels, verifyOfficialSources } from "./sources-official-ota.mjs";
import {
  applyFridayRefresh,
  buildWeekendSnapshot,
  loadLocalWeekendContext,
} from "./rank-and-build.mjs";
import { fetchWeekendStateBundle, runFeedbackTune } from "./feedback-tune.mjs";
import { writeCandidateTripHint } from "./candidate-trip-hint.mjs";
import { sendWeekendWebhook } from "./notify-webhook.mjs";

const REPO_LITERAL = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const REPO = { literal: REPO_LITERAL, real: fs.realpathSync.native(REPO_LITERAL) };
const V2_DIR = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

export function resolveTargetWeekId(stage, todayYmd = shanghaiToday()) {
  const dt = new Date(`${todayYmd}T00:00:00Z`);
  const dow = dt.getUTCDay(); // 0=Sun .. 6=Sat
  if (stage === "sync-feedback") {
    // On Sunday (0), yesterday is Saturday (-1); on Mon..Fri, look back to previous Saturday.
    const daysSinceSat = dow === 6 ? 0 : (dow + 1);
    return addDays(todayYmd, -daysSinceSat);
  }
  const daysUntilSat = (6 - dow + 7) % 7;
  return addDays(todayYmd, daysUntilSat);
}

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readRunLedger(ledgerPath) {
  const parsed = readJsonSafe(ledgerPath, null);
  if (parsed && parsed.schema === "nianlife.weekend-run-ledger/1" && parsed.weeks) return parsed;
  return { schema: "nianlife.weekend-run-ledger/1", updatedAt: null, weeks: {} };
}

function updateRunLedger(ledgerPath, weekId, stage, patch) {
  assertOutsideRepository(ledgerPath, REPO);
  const ledger = readRunLedger(ledgerPath);
  if (!ledger.weeks[weekId]) ledger.weeks[weekId] = { stages: {} };
  ledger.weeks[weekId].stages[stage] = {
    at: new Date().toISOString(),
    ...patch,
  };
  ledger.updatedAt = new Date().toISOString();
  writeJsonAtomic(ledgerPath, ledger);
  return ledger;
}

function deploySnapshotToEcs(weekId, snapshotPath) {
  const bashExe = fs.existsSync("C:\\Program Files\\Git\\bin\\bash.exe")
    ? "C:\\Program Files\\Git\\bin\\bash.exe"
    : "bash";
  const ecsSsh = process.env.ECS_SSH || "ecs-user@47.99.243.155";
  const ecsKey = process.env.ECS_KEY || "/c/Users/teddy/.ssh/nianlife-prod-ecs.pem";
  const posixSnap = snapshotPath.replace(/\\/g, "/").replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);

  const installRes = spawnSync(
    bashExe,
    ["-lc", `ECS_SSH='${ecsSsh}' ECS_KEY='${ecsKey}' ./scripts/deploy-ecs-public.sh weekend-install '${weekId}' '${posixSnap}'`],
    { cwd: V2_DIR, encoding: "utf8", timeout: 120_000 },
  );
  if (installRes.status !== 0) {
    throw new Error(`weekend-install failed (${installRes.status}): ${(installRes.stderr || installRes.stdout || "").slice(0, 300)}`);
  }

  const revalRes = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/editor/pipeline-status.mjs", "revalidate", "--scope", "weekend"],
    { cwd: V2_DIR, encoding: "utf8", timeout: 60_000 },
  );
  if (revalRes.status !== 0) {
    throw new Error(`revalidate --scope weekend failed (${revalRes.status}): ${(revalRes.stderr || revalRes.stdout || "").slice(0, 300)}`);
  }

  return {
    deployed: true,
    installStdout: (installRes.stdout || "").trim(),
    revalidateStdout: (revalRes.stdout || "").trim(),
  };
}

export async function runWeeklyStage(stage, options = {}) {
  const validStages = ["collect-init", "verify-deep", "build-and-publish", "refresh-friday", "sync-feedback"];
  if (!validStages.includes(stage)) {
    throw new Error(`Unknown stage "${stage}". Expected one of: ${validStages.join(", ")}`);
  }

  const todayYmd = options.today ?? shanghaiToday();
  const weekId = options.weekId ?? resolveTargetWeekId(stage, todayYmd);
  const satDay = weekId;
  const sunDay = addDays(weekId, 1);

  const baseDir = options.baseDir ?? DEFAULT_WEEKEND_BASE_DIR;
  const opsStateDir = options.opsStateDir ?? DEFAULT_OPS_WEEKEND_STATE_DIR;
  const lockPath = path.join(opsStateDir, "weekend.lock");
  const ledgerPath = path.join(opsStateDir, "run-ledger.json");
  const candidatesPath = options.candidatesFile ?? path.join(opsStateDir, "candidates", `${weekId}.json`);
  const snapshotPath = path.join(baseDir, "snapshots", `${weekId}.json`);

  assertOutsideRepository(opsStateDir, REPO);
  assertOutsideRepository(baseDir, REPO);

  let weAcquiredLock = false;
  if (!options.lockHeld) {
    const lock = acquireProcessLock(lockPath, { label: `weekend-${stage}` });
    if (!lock.acquired) {
      return {
        ok: false,
        skipped: true,
        exitCode: 75,
        reason: lock.reason,
        holderPid: lock.holderPid ?? null,
      };
    }
    weAcquiredLock = true;
  }

  try {
    // Always sync latest excluded types before starting collection/build
    const stateBundle = await fetchWeekendStateBundle(weekId, {
      localStateDir: options.remoteStateDir ?? null,
      useRemoteHttp: !options.offline,
      useSsh: false,
    });
    const excludedTypes = stateBundle.excludedExperienceTypes?.length
      ? stateBundle.excludedExperienceTypes
      : readExcludedTypesFile(path.join(opsStateDir, "excluded-types.json"));

    if (stage === "collect-init") {
      const weather = options.offline
        ? readJsonSafe(path.join(opsStateDir, "cache", `weather-bundle-${weekId}.json`), null)
        : await fetchWeekendWeatherBundle({
            satDay,
            sunDay,
            isFridayRefresh: false,
            cacheDir: path.join(opsStateDir, "cache"),
          });
      if (weather) {
        writeJsonAtomic(path.join(opsStateDir, "cache", `weather-bundle-${weekId}.json`), weather);
      }

      const xhs = await crawlXhsBatch({
        weekId,
        targetFromDay: satDay,
        todayYmd,
        excludedTypes,
        baseDir,
        opsStateDir,
        dryRun: Boolean(options.dryRun),
        headless: true,
      });

      updateRunLedger(ledgerPath, weekId, stage, {
        ok: xhs.ok,
        reusedCount: xhs.reusedCount,
        newNotesCount: xhs.newNotesCount,
        stoppedByRiskOrAuth: xhs.stoppedByRiskOrAuth,
        authStatus: xhs.authStatus?.status ?? "healthy",
        weatherCities: weather?.cities?.length ?? 0,
      });

      return { ok: xhs.ok, stage, weekId, weatherCities: weather?.cities?.length ?? 0, xhs };
    }

    if (stage === "verify-deep") {
      const existingCandidatesDoc = readJsonSafe(candidatesPath, { candidates: [], hotelCandidates: [], sources: [] });
      const { cooldown } = loadLocalWeekendContext(opsStateDir);
      const cooldownNames = (cooldown.venues ?? []).map((v) => v.venueName).filter(Boolean);

      const candidatePlaces = (existingCandidatesDoc.candidates ?? [])
        .filter((c) => c?.title || c?.region)
        .map((c) => ({ name: c.placeQueryName || c.region || c.title, experienceType: c.experienceType }));
      const s2Keywords = generateStage2PlaceKeywords({
        candidatePlaces,
        excludedTypes,
        cooldownVenueNames: cooldownNames,
        maxKeywords: 3,
      });

      const xhs = options.offline
        ? { ok: true, reusedCount: 0, newNotesCount: 0, notes: [], stoppedByRiskOrAuth: false }
        : await crawlXhsBatch({
            weekId,
            targetFromDay: satDay,
            todayYmd,
            stage1Keywords: [],
            stage2Keywords: s2Keywords,
            excludedTypes,
            baseDir,
            opsStateDir,
            dryRun: Boolean(options.dryRun),
            headless: true,
          });

      const ctripResult = options.offline
        ? { ok: true, options: [], eliminatedOptions: [], authExpired: false }
        : await checkCtripHotels({
            weekId,
            checkIn: satDay,
            checkOut: sunDay,
            hotelCandidates: existingCandidatesDoc.hotelCandidates ?? [],
            baseDir,
            opsStateDir,
            dryRun: Boolean(options.dryRun),
            headless: true,
          });

      const cleanedSources = await verifyOfficialSources(existingCandidatesDoc.sources ?? [], {
        probeRemote: !options.offline && !options.dryRun,
      });

      const outBundle = {
        ...existingCandidatesDoc,
        weekId,
        verifiedAt: new Date().toISOString(),
        xhsNotes: xhs.notes ?? existingCandidatesDoc.xhsNotes ?? [],
        ctripResult,
        cleanedSources: cleanedSources.sources,
      };
      if (!options.dryRun) {
        writeJsonAtomic(candidatesPath, outBundle);
      }

      updateRunLedger(ledgerPath, weekId, stage, {
        ok: xhs.ok && ctripResult.ok,
        xhsNotesTotal: outBundle.xhsNotes.length,
        ctripWithinBudget: ctripResult.options?.length ?? 0,
        ctripAuthExpired: Boolean(ctripResult.authExpired),
      });

      return { ok: xhs.ok && ctripResult.ok, stage, weekId, xhs, ctripResult };
    }

    if (stage === "build-and-publish") {
      const ctx = loadLocalWeekendContext(opsStateDir);
      const authStatus = readJsonSafe(path.join(opsStateDir, "auth-status.json"), { ok: true, status: "healthy" });
      const candidatesDoc = readJsonSafe(candidatesPath, { candidates: [], inspirationPool: [], noGoAlerts: [] });
      const weatherBundle = readJsonSafe(path.join(opsStateDir, "cache", `weather-bundle-${weekId}.json`), null)
        ?? (!options.offline
          ? await fetchWeekendWeatherBundle({ satDay, sunDay, cacheDir: path.join(opsStateDir, "cache") })
          : {
              testedAt: new Date().toISOString(),
              primarySourceLabel: "中国天气网 7 天与逐 3 小时预报",
              secondarySourceLabel: "待周五 17:30 短时校准",
              precipProbabilityPct: null,
              precipProbabilityStatus: "unconfirmed",
              precipProbabilityNote: "当前免费公开 7 天与逐 3 小时预报不含精确降水概率百分比",
              horizonConfidence: "medium",
              horizonConfidenceLabel: "周中预报",
              fridayRefreshHint: "待刷新",
              cities: [{ city: "杭州", code: "101210101", sourceUrl: "https://www.weather.com.cn/weather/101210101.shtml", daysSummary: [], hour3Segments: {}, weekendTip: "待更新" }],
            });

      const crawlStatus = {
        authExpired: authStatus?.ok === false && authStatus?.status === "xhs_auth_expired",
        riskStopped: authStatus?.ok === false && authStatus?.status === "xhs_risk_stopped",
        pcOffline: Boolean(options.pcOffline),
      };

      const built = buildWeekendSnapshot({
        weekId,
        candidates: candidatesDoc.candidates ?? [],
        inspirationPool: candidatesDoc.inspirationPool ?? [],
        noGoAlerts: candidatesDoc.noGoAlerts ?? [],
        weatherSummary: weatherBundle,
        crawlAudit: candidatesDoc.crawlAudit ?? {
          testedAt: new Date().toISOString(),
          manifestPath: path.join(baseDir, "raw", weekId, `xhs-crawl-manifest-${weekId}.json`),
          manifestMdPath: path.join(baseDir, "raw", weekId, `xhs-crawl-manifest-${weekId}.md`),
          xiaohongshuLoggedIn: { profileDir: path.join(baseDir, "browser-profile"), authBackupPath: path.join(baseDir, "storage-state.backup.json"), rateLimitPolicy: { concurrency: 1, randomDelayMsRange: "8000–20000", riskStopRule: "遇验证码/登录墙立即停抓", riskStopTriggered: crawlStatus.riskStopped }, summary: {} },
          ctripLoggedIn: candidatesDoc.ctripResult ?? {},
          weatherAndOfficial: {},
        },
        crawlStatus,
        excludedExperienceTypes: excludedTypes,
        weights: ctx.weights,
        cooldown: ctx.cooldown,
        fallbackArchiveWeekId: options.fallbackArchiveWeekId ?? null,
        requireOssMedia: options.requireOssMedia !== false,
      });

      if (!built.ok) {
        throw new Error(`BUILD_HARD_GATES_FAILED: ${built.errors.join("; ")}`);
      }

      if (!options.dryRun) {
        writeJsonAtomic(snapshotPath, built.snapshot);
      }

      let deployResult = { deployed: false };
      if (!options.dryRun && !options.noDeploy) {
        deployResult = deploySnapshotToEcs(weekId, snapshotPath);
      }

      let webhookResult = null;
      if (built.snapshot.status === "unavailable") {
        webhookResult = await sendWeekendWebhook({
          title: "Nianlife 本周周末推荐暂未更新",
          message: built.snapshot.unavailableNotice?.summary ?? "小红书近 30 天实拍依据不足，已安全停发。",
          level: "warning",
          weekId,
          event: built.snapshot.unavailableNotice?.reason ?? "unavailable",
        });
      }

      updateRunLedger(ledgerPath, weekId, stage, {
        ok: true,
        status: built.snapshot.status,
        proposalsCount: built.snapshot.proposals.length,
        deployed: deployResult.deployed,
      });

      return { ok: true, stage, weekId, status: built.snapshot.status, snapshotPath, deployResult, webhookResult };
    }

    if (stage === "refresh-friday") {
      const existing = readJsonSafe(snapshotPath, null);
      if (!existing) {
        return { ok: false, stage, weekId, reason: "snapshot_missing" };
      }
      const weatherBundle = options.offline
        ? readJsonSafe(path.join(opsStateDir, "cache", `weather-bundle-${weekId}.json`), null)
        : await fetchWeekendWeatherBundle({
            satDay,
            sunDay,
            isFridayRefresh: true,
            cacheDir: path.join(opsStateDir, "cache"),
            forceRefresh: true,
          });
      const updated = applyFridayRefresh({
        snapshot: existing,
        weatherBundle,
        state: stateBundle.state,
      });
      if (!options.dryRun) {
        writeJsonAtomic(snapshotPath, updated);
      }
      let deployResult = { deployed: false };
      if (!options.dryRun && !options.noDeploy && updated.status === "published") {
        deployResult = deploySnapshotToEcs(weekId, snapshotPath);
      }
      updateRunLedger(ledgerPath, weekId, stage, {
        ok: true,
        severity: updated.fridayAlert?.severity ?? "info",
        selectedProposalId: stateBundle.state?.selectedProposalId ?? null,
        deployed: deployResult.deployed,
      });
      return { ok: true, stage, weekId, fridayAlert: updated.fridayAlert, deployResult };
    }

    if (stage === "sync-feedback") {
      const snapshot = readJsonSafe(snapshotPath, null);
      const selectedId = stateBundle.state?.sundayFeedback?.proposalId ?? stateBundle.state?.selectedProposalId ?? null;
      const proposalMeta = (snapshot?.proposals ?? []).find((p) => p?.id === selectedId) ?? null;

      const tuneRes = await runFeedbackTune({
        weekId,
        opsStateDir,
        remoteStateDir: options.remoteStateDir ?? null,
        proposalMeta,
        useRemoteHttp: !options.offline,
        useSsh: !options.offline && !options.remoteStateDir,
      });

      const hintRes = writeCandidateTripHint({
        weekId,
        snapshot,
        state: tuneRes.state,
        opsStateDir,
      });

      updateRunLedger(ledgerPath, weekId, stage, {
        ok: true,
        appliedFeedback: tuneRes.appliedFeedback,
        reason: tuneRes.reason,
        tripHintCreated: hintRes.created,
      });

      return { ok: true, stage, weekId, tuneRes, hintRes };
    }
  } finally {
    if (weAcquiredLock) {
      releaseProcessLock(lockPath, process.pid);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const stage = args[0];
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const flag = (name) => args.includes(`--${name}`);

  if (!stage || flag("help") || flag("h")) {
    console.log("Usage: run-weekly.mjs <collect-init|verify-deep|build-and-publish|refresh-friday|sync-feedback> [--week YYYY-MM-DD] [--dry-run] [--offline] [--no-deploy] [--lock-held]");
    return;
  }

  const res = await runWeeklyStage(stage, {
    weekId: opt("week"),
    today: opt("today"),
    candidatesFile: opt("candidates"),
    dryRun: flag("dry-run"),
    offline: flag("offline"),
    noDeploy: flag("no-deploy"),
    lockHeld: flag("lock-held"),
    pcOffline: flag("pc-offline"),
  });
  console.log(JSON.stringify(res, null, 2));
  if (res.exitCode) process.exitCode = res.exitCode;
  else if (!res.ok) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((err) => {
    console.error(err?.stack ?? err);
    process.exitCode = 1;
  });
}
