#!/usr/bin/env node
// T20-C + T19, 2026-09-04 (Cowork, 原则五): every T7-written life_event was forced to
// memoryWeight="trace" regardless of content, so "小年年升入大班了" and "老师提醒尿不湿不多了" render
// identically. This re-grades the already-published T7 events (organizer_version =
// 'organizer-v2-t7-subject-gate') into three tiers, using only the title+story already written
// (no new facts, no re-reading raw chat):
//
//   high   -> memoryWeight "memory" (a real chapter: 1-4 per month, a genuine change/milestone)
//   medium -> memoryWeight "trace" (an ordinary day worth keeping, current default, unchanged)
//   low    -> UNPUBLISHED (content_quality_reviews decision -> "store_only": the row, its
//             sourceIds and its evidence stay intact, it just stops rendering as a titled memory)
//
// "low" also covers T19's finding: the subject is an adult's logistics/errand/administration with
// the child only mentioned in passing, not something he did or that happened to him.
//
//   node --import tsx scripts/t20c-regrade-memories.mjs --month=2026-08 [--commit]
//
// P1-3, 2026-09-05: grading logic extracted to t20c-grade-events.mjs (shared with
// organizer-month-write.mjs which now calls it automatically after --commit). This script is kept
// for manual re-runs (e.g. after a prompt fix or to regrade a month that was written before P1-3).
// Idempotent: re-running always recomputes from current title/story and overwrites.
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { gradeMonthEvents } from "./t20c-grade-events.mjs";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });
process.env.REPOSITORY_BACKEND = "postgres";

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const hasFlag = (name) => args.includes(`--${name}`);
const MONTH = argOf("month", null);
const COMMIT = hasFlag("commit");

const dbUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const apiKey = process.env.DEEPSEEK_API_KEY;
const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");
const model = process.env.AI_MODEL || "deepseek-v4-pro";
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
if (!apiKey) { console.error("Need DEEPSEEK_API_KEY."); process.exit(1); }
if (!MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) { console.error("--month=YYYY-MM is required"); process.exit(1); }

const { persistQualityReview } = await import("../lib/db/repository.ts");

const result = await gradeMonthEvents(MONTH, { dbUrl, apiKey, baseUrl, model, persistQualityReview, commit: COMMIT });
console.log(`=== SUMMARY ===\n${JSON.stringify({ ...result, commit: COMMIT }, null, 2)}`);
if (!COMMIT) console.log("Dry run — nothing written. Pass --commit to persist.");
