#!/usr/bin/env node
// Reorganize one manifest-proven Quark capture date after a mistaken mock event was removed.
// This is intentionally narrow: the manifest checksum -> MediaAsset relation is the proof that
// the supplied sources are real imports, never a timestamp-only selection.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(root, "..");
loadDotenv({ path: path.join(root, ".env.local"), quiet: true });
process.env.REPOSITORY_BACKEND = "postgres";
process.env.MEMORY_ORGANIZER = "ai";
process.env.AI_ORGANIZER_ENABLED = "true";
process.env.AI_PROVIDER = "gemini";
if (!process.env.DATABASE_URL || !process.env.GEMINI_API_KEY || !process.env.AI_MODEL) throw new Error("DATABASE_URL, GEMINI_API_KEY, and AI_MODEL are required");

const date = process.argv.find((arg) => arg.startsWith("--date="))?.slice(7) ?? "2026-08-17";
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date must be YYYY-MM-DD");
const manifestPath = path.join(repoRoot, ".github", "skills", "quarkclouddrive", "workbuddy", "storage", "quark-photo-prep-20260831", "artifacts", "task-items.jsonl");
const manifest = (await readFile(manifestPath, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const checksums = new Set(manifest.filter((item) => item.kind === "photo" && item.download_status === "success" && item.checksum_duplicate === false && item.date_label === "in_window" && item.capture_time?.reliable === true).map((item) => `sha256:${item.sha256}`));
const seed = JSON.parse(await readFile(path.join(root, ".data", "nian-life.json"), "utf8"));
const seedEventIds = new Set((seed.events ?? []).map((event) => event.id));

const repo = await import("../lib/db/repository.ts");
const { runOrganizerWorker } = await import("../lib/organizer/worker.ts");
const { getConfiguredOrganizer } = await import("../lib/organizer/index.ts");
const initial = await repo.getStore();
const assets = new Map(initial.mediaAssets.map((asset) => [asset.id, asset]));
const media = new Map(initial.media.map((item) => [item.id, item]));
const sources = initial.rawSources.filter((source) => source.capturedAt.slice(0, 10) === date && source.mediaIds.length > 0 && source.mediaIds.every((id) => checksums.has(assets.get(media.get(id)?.mediaAssetId ?? "")?.checksum ?? "")));
const sourceIds = sources.map((source) => source.id).sort();
if (sourceIds.length !== 12) throw new Error(`Expected 12 manifest-proven sources on ${date}; found ${sourceIds.length}`);
const before = { events: initial.events.length, traces: initial.dailyTraces.length, runs: initial.organizerRuns.length };
const job = await repo.enqueueOrganizerJob({ profileId: "profile-zhangnian", sourceIds, force: true });
const outcomes = await runOrganizerWorker({ once: true, maxJobs: 1 });
const after = await repo.getStore();
const eventRefs = after.events.filter((event) => event.sourceIds.some((id) => sourceIds.includes(id)));
const traceRefs = after.dailyTraces.filter((trace) => trace.sourceIds.some((id) => sourceIds.includes(id)));
const mockRefs = eventRefs.filter((event) => seedEventIds.has(event.id));
if (outcomes.length !== 1 || !outcomes[0].ok || mockRefs.length || (!eventRefs.length && !traceRefs.length)) throw new Error(`Organizer verification failed: outcomes=${JSON.stringify(outcomes.map((outcome) => ({ ok: outcome.ok, action: outcome.ok ? outcome.action : outcome.error })))}, eventRefs=${eventRefs.length}, traceRefs=${traceRefs.length}, mockRefs=${mockRefs.length}`);
const idempotent = await getConfiguredOrganizer().organize(sourceIds);
const final = await repo.getStore();
if (final.events.length !== after.events.length || final.dailyTraces.length !== after.dailyTraces.length || final.organizerRuns.length !== after.organizerRuns.length) throw new Error("Idempotency verification created an additional record");
console.log(JSON.stringify({ date, sourceCount: sourceIds.length, job: { id: job.id, status: job.status }, outcome: outcomes[0].ok ? { ok: true, action: outcomes[0].action } : { ok: false, error: outcomes[0].error }, result: { eventRefs: eventRefs.map((event) => event.id), traceRefs: traceRefs.map((trace) => trace.id), mockRefs: mockRefs.map((event) => event.id) }, before, after: { events: after.events.length, traces: after.dailyTraces.length, runs: after.organizerRuns.length }, idempotent: { action: idempotent.action, unchanged: true } }, null, 2));
