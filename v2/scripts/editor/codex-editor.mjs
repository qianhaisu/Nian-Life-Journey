// Prepare private evidence for editorial sessions, then validate file-backed editorial decisions.
// No provider/model calls, database writes, or production publishing are performed here.
// node --import tsx scripts/editor/codex-editor.mjs prepare --out <private-directory>
// node --import tsx scripts/editor/codex-editor.mjs apply --out <same-directory> --decisions <private-json> --literary
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveEcsConnection } from "../lib/ecs-connection.mjs";
import { assertOutsideRepository } from "../lib/repo-containment.mjs";
import { validateMonthContent } from "../../lib/month-content.ts";
import { labelForSender, registeredLabels } from "./identity-rules.mjs";
import { validateDayText, validateLiteraryStyle, quoteHits, SENSITIVE_TEXT } from "./validate-day.mjs";
import { addDays, shanghaiToday, isReadable, checkDecision, timeWordProblems, sensitiveHits } from "./plan.mjs";
import { appendDay } from "./append-day.mjs";
import { aggregateDayMedia } from "./day-media.mjs";

const PACK_SCHEMA = "nianlife.codex-editor.sources/1";
const RECEIPT_SCHEMA = "nianlife.codex-editor.review/1";
const MONTH_SCHEMA = "nianlife.month-content/1";
const REPO_LITERAL = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const REPO = { literal: REPO_LITERAL, real: fs.realpathSync.native(REPO_LITERAL) };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const TECHNICAL_RE = /\[(media|图片|视频|表情包|语音|文件|动画表情)\]|\]\(media\/|https?:\/\/|undefined|Quark|微信|群聊|会话|导入|数据库|网站/i;
const MAX_PHOTO_CAPTION_CHARS = 20;
const MAX_FEATURED_QUOTE_CHARS = 72;

export class CodexEditorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CodexEditorError";
    this.code = code;
    this.details = details;
  }
}

function refuse(code, message, details) {
  throw new CodexEditorError(code, message, details);
}

function validDay(day) {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
    && !Number.isNaN(Date.parse(`${day}T00:00:00Z`))
    && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

/** Hash the actual source fields, including the untrimmed original text and resolved speaker. */
export function sourceFingerprint(source) {
  return sha256(JSON.stringify({ id: source.id, day: source.day, time: source.time, text: source.text, speaker: source.speaker ?? null }));
}

function checkedSources(sources) {
  if (!Array.isArray(sources)) refuse("INVALID_SOURCES", "Source evidence must be an array.");
  const ids = new Set();
  for (const source of sources) {
    if (!source || !nonempty(source.id) || !validDay(source.day) || !/^(?:[01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?$/.test(source.time)
      || typeof source.text !== "string" || !(source.speaker === null || nonempty(source.speaker)) || ids.has(source.id)) {
      refuse("INVALID_SOURCES", "Invalid or duplicate source evidence.");
    }
    ids.add(source.id);
    if (source.fingerprint !== sourceFingerprint(source)) refuse("SOURCE_PACK_CHANGED", "Prepared source evidence was modified.", { sourceId: source.id });
  }
  return sources;
}

function assertSourcesUnchanged(sources, currentSources) {
  checkedSources(sources);
  checkedSources(currentSources);
  const expected = sources.map((source) => `${source.id}:${source.fingerprint}`).sort();
  const actual = currentSources.map((source) => `${source.id}:${source.fingerprint}`).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    refuse("SOURCE_CHANGED", "Database evidence changed after preparation; prepare a fresh source pack.");
  }
}

function stripOuterQuotes(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(?:「([\s\S]*)」|“([\s\S]*)”)$/);
  if (!m) return s;
  const inner = (m[1] ?? m[2] ?? "").trim();
  if (inner.includes("」") || inner.includes("「") || inner.includes("”") || inner.includes("“")) return s;
  return inner;
}

/**
 * Pure candidate builder. Every existing day is immutable by default, regardless of its editor/source.
 * Explicit rewrites are allowed ONLY for days listed in allowRewriteDays (never _source="human"),
 * archiving the prior published day entry + SHA-256 into _revisions so zero history is ever lost.
 * currentSources must come from a fresh read-only database query, not the prepared file.
 */
export function buildCandidate({
  month,
  original = null,
  decisions,
  sources,
  currentSources,
  realNames = [],
  now,
  allowRewriteDays = [],
  literary = false,
  monthMeta = null,
  dayMedia = null,
}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) refuse("INVALID_MONTH", "Invalid month.");
  if (!nonempty(now) || Number.isNaN(Date.parse(now))) refuse("INVALID_TIME", "A valid review timestamp is required.");
  if (original !== null && !validateMonthContent(original, month)) refuse("INVALID_PRODUCTION", "Production snapshot failed month-content validation.");
  if (!Array.isArray(decisions)) refuse("INVALID_DECISIONS", "Decisions must be an array.");
  assertSourcesUnchanged(sources, currentSources);
  const rewriteAllowSet = new Set(allowRewriteDays);
  const allowedSpeakerLabels = new Set(registeredLabels());
  const lookup = new Map(sources.map((source) => [source.id, source]));
  const priorByDay = new Map((original?.days ?? []).map((day) => [day.day, structuredClone(day)]));
  const protectedDays = new Map(
    (original?.days ?? [])
      .filter((day) => !rewriteAllowSet.has(day.day))
      .map((day) => [day.day, JSON.stringify(day)]),
  );
  let content = original === null ? { schema: MONTH_SCHEMA, month, speakerBySourceId: {}, days: [] } : structuredClone(original);
  const seen = new Set();
  const wrote = [];
  const rewritten = [];
  const skipped = [];

  for (const decision of decisions) {
    if (!decision || !validDay(decision.day) || !decision.day.startsWith(`${month}-`) || seen.has(decision.day)) {
      refuse("INVALID_DECISIONS", "Invalid, duplicate, or wrong-month decision date.");
    }
    seen.add(decision.day);
    const prior = priorByDay.get(decision.day) ?? null;
    if (prior && !rewriteAllowSet.has(decision.day)) {
      refuse("EXISTING_DAY", "An already published day cannot be changed.", { day: decision.day });
    }
    if (prior && prior._source === "human") {
      refuse("HUMAN_DAY_PROTECTED", "A human-authored day cannot be rewritten.", { day: decision.day });
    }
    if (!sources.some((source) => source.day === decision.day)) refuse("UNPREPARED_DAY", "Decision date has no prepared source evidence.", { day: decision.day });
    if (decision.decision === "skip") {
      if (prior) refuse("INVALID_DECISIONS", "An explicit rewrite day cannot use decision=skip.", { day: decision.day });
      if (!nonempty(decision.reason)) refuse("INVALID_DECISIONS", "A skipped day requires a reason.", { day: decision.day });
      skipped.push({ day: decision.day, reason: decision.reason });
      continue;
    }

    const paragraphs = decision.paragraphs;
    if (!Array.isArray(paragraphs)) refuse("INVALID_DECISIONS", "A write decision requires cited paragraphs.", { day: decision.day });
    for (const paragraph of paragraphs) {
      if (!paragraph || !Array.isArray(paragraph.sourceIds) || paragraph.sourceIds.length === 0
        || paragraph.sourceIds.some((id) => !lookup.has(id) || lookup.get(id).day !== decision.day)) {
        refuse("UNKNOWN_SOURCE", "Each paragraph must cite prepared sources from its own day.", { day: decision.day });
      }
    }

    const curatedForDay = dayMedia?.[decision.day] ?? null;
    const firstScreenMediaIds = decision.firstScreenMediaIds
      ?? (prior?.firstScreenMediaIds?.length ? prior.firstScreenMediaIds : curatedForDay?.firstScreenMediaIds)
      ?? [];
    const expandedMediaIds = decision.expandedMediaIds
      ?? (prior?.expandedMediaIds?.length ? prior.expandedMediaIds : curatedForDay?.expandedMediaIds)
      ?? (decision.firstScreenMediaIds ? [...decision.firstScreenMediaIds] : []);
    if (!Array.isArray(firstScreenMediaIds) || !firstScreenMediaIds.every(nonempty)
      || !Array.isArray(expandedMediaIds) || !expandedMediaIds.every(nonempty)) {
      refuse("INVALID_DECISIONS", "firstScreenMediaIds and expandedMediaIds must be arrays of non-empty media IDs.", { day: decision.day });
    }
    const expandedSet = new Set(expandedMediaIds);
    if (!firstScreenMediaIds.every((id) => expandedSet.has(id))) {
      refuse("INVALID_DECISIONS", "firstScreenMediaIds must be a subset of expandedMediaIds.", { day: decision.day });
    }
    if (curatedForDay) {
      const approvedPool = new Set([
        ...(curatedForDay.allApprovedMediaIds ?? []),
        ...(curatedForDay.expandedMediaIds ?? []),
        ...(prior?.expandedMediaIds ?? []),
      ]);
      const unapproved = expandedMediaIds.filter((id) => !approvedPool.has(id));
      if (unapproved.length > 0) {
        refuse("UNKNOWN_MEDIA", "Media IDs must belong to the day's approved curated photo pool.", { day: decision.day, mediaIds: unapproved });
      }
    }

    const allowedKinds = prior || expandedMediaIds.length > 0 ? ["story", "visual-description", "text-only"] : ["story", "text-only"];
    const shape = checkDecision(
      { ...decision, kind: decision.kind ?? prior?.kind ?? "story", paragraphs: paragraphs.map((paragraph) => ({ text: paragraph.text, sources: paragraph.sourceIds })) },
      new Set(lookup.keys()),
      { kinds: allowedKinds },
    );
    if (!shape.ok) refuse("INVALID_DECISIONS", "Decision shape failed validation.", { day: decision.day, error: shape.error });

    // Validate paragraph photo anchoring (paragraphs[i].mediaIds -> paragraphMedia)
    const anchoredMediaSet = new Set();
    let hasExplicitParagraphMedia = false;
    const paragraphMedia = [];
    for (const [index, paragraph] of paragraphs.entries()) {
      if (paragraph.mediaIds !== undefined) {
        hasExplicitParagraphMedia = true;
        if (!Array.isArray(paragraph.mediaIds) || !paragraph.mediaIds.every(nonempty)) {
          refuse("INVALID_DECISIONS", "Paragraph mediaIds must be an array of non-empty media IDs.", { day: decision.day, paragraph: index + 1 });
        }
        const cleanedIds = [];
        for (const rawMid of paragraph.mediaIds) {
          const mid = rawMid.trim();
          if (!expandedSet.has(mid)) {
            refuse("UNKNOWN_MEDIA", "Paragraph mediaIds must be a subset of the day's approved photos.", { day: decision.day, paragraph: index + 1, mediaId: mid });
          }
          if (anchoredMediaSet.has(mid)) {
            refuse("DUPLICATE_MEDIA_ANCHOR", "Each photo may be anchored to at most one paragraph on the same day.", { day: decision.day, paragraph: index + 1, mediaId: mid });
          }
          anchoredMediaSet.add(mid);
          cleanedIds.push(mid);
        }
        paragraphMedia.push(cleanedIds);
      } else {
        paragraphMedia.push([]);
      }
    }
    if (firstScreenMediaIds.length > 0 && anchoredMediaSet.size === 0) {
      refuse("PHOTO_ANCHOR_REQUIRED", "When firstScreenMediaIds is non-empty, at least one paragraph must anchor photos via mediaIds.", {
        day: decision.day,
        firstScreenMediaIds,
      });
    }

    const evidence = { quotes: [], persons: [], paragraphSources: [] };
    const errors = [];
    for (const [index, paragraph] of paragraphs.entries()) {
      const cited = paragraph.sourceIds.map((id) => lookup.get(id));
      const checked = validateDayText({ day: decision.day, title: null, paragraphs: [paragraph.text] }, cited, { realNames });
      errors.push(...checked.errors.map((error) => error.replace(/^第 1 段/, `第 ${index + 1} 段`)));
      const badTimes = timeWordProblems(paragraph.text, cited.map((source) => Number(source.time.slice(0, 2))));
      if (badTimes.length) errors.push(`第 ${index + 1} 段时间不符：${badTimes.join("、")}`);
      for (const key of ["quotes", "persons"]) evidence[key].push(...checked.evidence[key].map((entry) => ({ ...entry, where: `第 ${index + 1} 段` })));
      evidence.paragraphSources.push({ paragraph: index + 1, sources: cited.map((source) => ({ id: source.id, fingerprint: source.fingerprint })) });
    }

    const ids = [...new Set(paragraphs.flatMap((paragraph) => paragraph.sourceIds))];
    const cited = ids.map((id) => lookup.get(id));
    const daySources = sources.filter((source) => source.day === decision.day);

    const titleCheck = validateDayText({ day: decision.day, title: decision.title, paragraphs: [] }, cited, { realNames });
    errors.push(...titleCheck.errors);
    if (literary) {
      errors.push(...validateLiteraryStyle({ title: decision.title, paragraphs: paragraphs.map((p) => p.text) }));
    }
    const badTitleTimes = timeWordProblems(decision.title, cited.map((source) => Number(source.time.slice(0, 2))));
    if (badTitleTimes.length) errors.push(`标题时间不符：${badTitleTimes.join("、")}`);
    const hits = sensitiveHits({ title: decision.title, paragraphs: paragraphs.map((paragraph) => paragraph.text) });
    if (hits.length) errors.push(...hits.map((hit) => `敏感兜底：${hit.category}`));

    // Validate photoCaptions (required for every firstScreenMediaIds entry; <= 20 chars; privacy/quote/style gated)
    let normalizedCaptions = undefined;
    if (decision.photoCaptions !== undefined && decision.photoCaptions !== null) {
      if (typeof decision.photoCaptions !== "object" || Array.isArray(decision.photoCaptions)) {
        refuse("INVALID_DECISIONS", "photoCaptions must be an object mapping mediaId to caption.", { day: decision.day });
      }
      normalizedCaptions = {};
      for (const [rawMid, rawCaption] of Object.entries(decision.photoCaptions)) {
        const mid = rawMid.trim();
        if (!expandedSet.has(mid)) {
          refuse("UNKNOWN_MEDIA", "photoCaptions key must belong to the day's approved photos.", { day: decision.day, mediaId: mid });
        }
        if (typeof rawCaption !== "string") {
          refuse("INVALID_PHOTO_CAPTION", "photoCaptions value must be a string.", { day: decision.day, mediaId: mid });
        }
        const trimmedCaption = rawCaption.trim();
        if (!trimmedCaption) {
          refuse("INVALID_PHOTO_CAPTION", "photoCaptions value must be non-empty.", { day: decision.day, mediaId: mid });
        }
        const captionLen = [...trimmedCaption].length;
        if (captionLen > MAX_PHOTO_CAPTION_CHARS) {
          refuse("INVALID_PHOTO_CAPTION", `Each photoCaption must be at most ${MAX_PHOTO_CAPTION_CHARS} characters.`, {
            day: decision.day,
            mediaId: mid,
            length: captionLen,
          });
        }
        if (typeof decision.title === "string" && trimmedCaption === decision.title.trim()) {
          errors.push(`图注[${mid}]: 图注不能直接重复当天标题`);
        }
        const capCheck = validateDayText({ day: decision.day, title: trimmedCaption, paragraphs: [] }, daySources, { realNames, literary: true });
        errors.push(...capCheck.errors.map((e) => e.replace(/^标题:/, `图注[${mid}]:`)));
        const capSensitive = sensitiveHits({ title: trimmedCaption, paragraphs: [] });
        if (capSensitive.length) {
          errors.push(...capSensitive.map((hit) => `图注[${mid}]: 敏感兜底（${hit.category}）`));
        }
        normalizedCaptions[mid] = trimmedCaption;
      }
    }
    if (firstScreenMediaIds.length > 0) {
      const missingCaptions = firstScreenMediaIds.filter((mid) => !normalizedCaptions || !nonempty(normalizedCaptions[mid]));
      if (missingCaptions.length > 0) {
        refuse("PHOTO_CAPTION_REQUIRED", "Every photo in firstScreenMediaIds must have a non-empty photoCaptions entry.", {
          day: decision.day,
          missingMediaIds: missingCaptions,
        });
      }
    }

    // Validate featuredQuote (optional; at most 1 verbatim-verified family quote per day)
    let normalizedFeaturedQuote = undefined;
    const extraCitedSources = [];
    if (decision.featuredQuote !== undefined && decision.featuredQuote !== null) {
      if (typeof decision.featuredQuote !== "object" || Array.isArray(decision.featuredQuote)) {
        refuse("INVALID_FEATURED_QUOTE", "featuredQuote must be an object { text, speaker, sourceId? }.", { day: decision.day });
      }
      const rawSpeaker = typeof decision.featuredQuote.speaker === "string" ? decision.featuredQuote.speaker.trim() : "";
      if (!rawSpeaker || !allowedSpeakerLabels.has(rawSpeaker)) {
        refuse("INVALID_FEATURED_QUOTE", "featuredQuote.speaker must be a registered family/teacher label.", {
          day: decision.day,
          speaker: decision.featuredQuote.speaker ?? null,
        });
      }
      if (typeof decision.featuredQuote.text !== "string") {
        refuse("INVALID_FEATURED_QUOTE", "featuredQuote.text must be a string.", { day: decision.day });
      }
      const cleanedQuote = stripOuterQuotes(decision.featuredQuote.text);
      const quoteLen = [...cleanedQuote].length;
      if (!cleanedQuote || quoteLen > MAX_FEATURED_QUOTE_CHARS) {
        refuse("INVALID_FEATURED_QUOTE", `featuredQuote.text must be non-empty and at most ${MAX_FEATURED_QUOTE_CHARS} characters.`, {
          day: decision.day,
          length: quoteLen,
        });
      }
      let candidateQuoteSources = daySources;
      if (decision.featuredQuote.sourceId !== undefined) {
        if (!nonempty(decision.featuredQuote.sourceId) || !lookup.has(decision.featuredQuote.sourceId)
          || lookup.get(decision.featuredQuote.sourceId).day !== decision.day) {
          refuse("UNKNOWN_SOURCE", "featuredQuote.sourceId must reference a prepared source from the same day.", {
            day: decision.day,
            sourceId: decision.featuredQuote.sourceId,
          });
        }
        candidateQuoteSources = [lookup.get(decision.featuredQuote.sourceId)];
      }
      if (TECHNICAL_RE.test(cleanedQuote)) {
        errors.push("featuredQuote: 含工程/技术字样");
      }
      for (const [sLabel, sRe] of SENSITIVE_TEXT) {
        const m = cleanedQuote.match(sRe);
        if (m) errors.push(`featuredQuote: 敏感信息（${sLabel}）「${m[0]}」`);
      }
      for (const hit of sensitiveHits({ title: cleanedQuote, paragraphs: [] })) {
        errors.push(`featuredQuote: 敏感兜底（${hit.category}）`);
      }
      for (const name of realNames) {
        if (name && cleanedQuote.includes(name)) errors.push("featuredQuote: 出现真实姓名，请换成称呼或节选避开");
      }
      const qHits = quoteHits(cleanedQuote, candidateQuoteSources);
      if (!qHits || qHits.length === 0) {
        errors.push(`featuredQuote: 引语找不到当天原消息来源「${cleanedQuote}」`);
      } else {
        const matchedSource = qHits.find((src) => src.speaker === rawSpeaker);
        if (!matchedSource) {
          const actual = [...new Set(qHits.map((src) => src.speaker ?? "未登记的人"))].join("、");
          errors.push(`featuredQuote: 引语归属不对，「${cleanedQuote}」写成${rawSpeaker}说的，原消息发送人是${actual}`);
        } else {
          normalizedFeaturedQuote = {
            text: cleanedQuote,
            speaker: rawSpeaker,
            sourceId: matchedSource.id,
          };
          extraCitedSources.push(matchedSource);
          evidence.featuredQuote = normalizedFeaturedQuote;
        }
      }
    }

    if (errors.length) refuse("TEXT_VALIDATION_FAILED", "Draft failed attribution, privacy, quote, literary, or time checks.", { day: decision.day, errors });

    if (prior) {
      const existingIdx = content.days.findIndex((d) => d.day === decision.day);
      if (existingIdx >= 0) content.days[existingIdx]._source = "machine";
    }

    const storyBoundMediaIds = decision.storyBoundMediaIds ?? prior?.storyBoundMediaIds ?? [];
    const eventIds = decision.eventIds ?? prior?.eventIds ?? (prior?.eventId ? [prior.eventId] : []);
    const allSpeakerSources = [...cited, ...extraCitedSources];
    const allCitedIds = [...new Set([...ids, ...extraCitedSources.map((s) => s.id)])];

    content = appendDay(content, {
      day: decision.day,
      kind: decision.kind ?? prior?.kind ?? "story",
      title: decision.title,
      paragraphs: paragraphs.map((paragraph) => paragraph.text),
      sourceIds: allCitedIds,
      firstScreenMediaIds,
      expandedMediaIds,
      storyBoundMediaIds,
      ...(anchoredMediaSet.size > 0 || hasExplicitParagraphMedia ? { paragraphMedia } : {}),
      ...(normalizedCaptions && Object.keys(normalizedCaptions).length > 0 ? { photoCaptions: normalizedCaptions } : {}),
      ...(normalizedFeaturedQuote ? { featuredQuote: normalizedFeaturedQuote } : {}),
      eventIds,
      evidence,
    }, {
      birthDay: "2025-01-03",
      now,
      dataCutoff: decision.day,
      speakerBySourceId: Object.fromEntries(allSpeakerSources.map((source) => [source.id, source.speaker ?? "未登记的人"])),
    }).content;

    const targetDay = content.days.find((day) => day.day === decision.day);
    targetDay._source = "codex";
    const emphasis = decision.emphasis ?? prior?.emphasis;
    if (emphasis === "lead" || emphasis === "quiet") targetDay.emphasis = emphasis;
    if (prior) {
      const { _revisions: priorRevs = [], ...priorSnapshot } = prior;
      targetDay._revisions = [
        ...priorRevs,
        {
          archivedAt: now,
          sha256: sha256(JSON.stringify(priorSnapshot)),
          title: priorSnapshot.title ?? null,
          kind: priorSnapshot.kind,
          paragraphs: priorSnapshot.paragraphs,
          sourceIds: priorSnapshot.sourceIds ?? [],
          ...(priorSnapshot.paragraphMedia !== undefined ? { paragraphMedia: priorSnapshot.paragraphMedia } : {}),
          ...(priorSnapshot.photoCaptions !== undefined ? { photoCaptions: priorSnapshot.photoCaptions } : {}),
          ...(priorSnapshot.featuredQuote !== undefined ? { featuredQuote: priorSnapshot.featuredQuote } : {}),
          _source: priorSnapshot._source ?? null,
        },
      ];
      rewritten.push({ day: decision.day, priorSha256: sha256(JSON.stringify(priorSnapshot)), sourceIds: allCitedIds });
    }
    wrote.push({ day: decision.day, sourceIds: allCitedIds, rewritten: Boolean(prior) });
  }

  let metaChanged = false;
  if (monthMeta && typeof monthMeta === "object") {
    const prevMeta = {
      cardLine: content.cardLine,
      intro: content.intro,
      coverMediaId: content.coverMediaId,
      homeHeroMediaId: content.homeHeroMediaId,
      coverFocal: content.coverFocal,
      coverFrame: content.coverFrame,
    };
    for (const key of ["cardLine", "intro", "coverMediaId", "homeHeroMediaId", "coverFocal", "coverFrame"]) {
      if (monthMeta[key] !== undefined && JSON.stringify(monthMeta[key]) !== JSON.stringify(content[key])) {
        content[key] = monthMeta[key];
        metaChanged = true;
      }
    }
    if (metaChanged) {
      content._metaRevisions = [...(content._metaRevisions ?? []), { archivedAt: now, ...prevMeta }];
      content.generatedAt = now;
    }
  }

  for (const [day, serialized] of protectedDays) {
    if (JSON.stringify(content.days.find((entry) => entry.day === day)) !== serialized) refuse("EXISTING_DAY_CHANGED", "An existing day changed while building the candidate.", { day });
  }
  const hasChanges = wrote.length > 0 || metaChanged;
  if (hasChanges && !validateMonthContent(content, month)) refuse("INVALID_CANDIDATE", "Candidate failed month-content validation.");
  return {
    content: hasChanges ? content : original,
    review: {
      month,
      wrote,
      rewritten,
      skipped,
      metaChanged,
      protectedDays: [...protectedDays].map(([day, serialized]) => ({ day, sha256: sha256(serialized) })),
      published: false,
    },
  };
}

/** A transfer/probe failure is never evidence that a production month is missing. */
export function readProductionSnapshot(month, destination, ecs, run = spawnSync) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) refuse("INVALID_MONTH", "Invalid month.");
  assertOutsideRepository(destination, REPO);
  const remote = `/srv/nianlife-content/${month}.json`;
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-i", ecs.key];
  const command = `if test -f '${remote}'; then printf 'PRESENT '; sha256sum '${remote}'; elif test -d /srv/nianlife-content && test -r /srv/nianlife-content && test -x /srv/nianlife-content && ! test -e '${remote}' && ! test -L '${remote}'; then echo ABSENT; else exit 3; fi`;
  const options = { encoding: "utf8", timeout: 45_000, maxBuffer: 64 * 1024 };
  const probe = () => {
    const result = run("ssh", [...args, ecs.ssh, command], options);
    if (result.status !== 0) refuse("PRODUCTION_READ_FAILED", "Production content probe failed; no empty month was assumed.", { status: result.status });
    const output = (result.stdout ?? "").trim();
    if (output === "ABSENT") return "absent";
    const match = output.match(/^PRESENT ([a-f0-9]{64})\s+\/srv\/nianlife-content\/\d{4}-\d{2}\.json$/);
    if (!match) refuse("PRODUCTION_READ_FAILED", "Production content probe was ambiguous.");
    return match[1];
  };
  const revision = probe();
  if (revision === "absent") return { month, revision, content: null };
  const copied = run("scp", ["-q", ...args, `${ecs.ssh}:${remote}`, destination], options);
  if (copied.status !== 0) refuse("PRODUCTION_READ_FAILED", "Production content transfer failed; no empty month was assumed.", { status: copied.status });
  const bytes = fs.readFileSync(destination);
  if (sha256(bytes) !== revision || probe() !== revision) refuse("PRODUCTION_CHANGED", "Production content changed while its snapshot was read.");
  let content;
  try { content = JSON.parse(bytes.toString("utf8")); } catch { refuse("INVALID_PRODUCTION", "Production content is not valid JSON."); }
  if (!validateMonthContent(content, month)) refuse("INVALID_PRODUCTION", "Production snapshot failed month-content validation.");
  return { month, revision, content };
}

async function loadSources(client, from, until) {
  const result = await client.query(`select id, to_char(captured_at at time zone 'Asia/Shanghai','YYYY-MM-DD') AS "day",
    to_char(captured_at at time zone 'Asia/Shanghai','HH24:MI:SS.US') AS "time", text,
    source_label, metadata->>'senderDigest' sender_digest from raw_sources
    where source_type='wechat' and captured_at >= ($1::date::timestamp at time zone 'Asia/Shanghai')
      and captured_at < ($2::date::timestamp at time zone 'Asia/Shanghai')
      and deleted_at is null and coalesce(metadata->>'duplicateOf','')=''
    order by captured_at,id`, [from, until]);
  // Retain media placeholders as evidence that a family member shared a file.
  // A placeholder never supplies evidence of what the unseen picture/video shows.
  return result.rows.filter((row) => typeof row.text === "string" && row.text.trim()).map((row) => {
    const source = { id: row.id, day: row.day, time: row.time, text: row.text, speaker: labelForSender(row.sender_digest, row.source_label) };
    return { ...source, fingerprint: sourceFingerprint(source) };
  });
}

async function loadApprovedDayMedia(client, from, until) {
  const rows = (await client.query(`
    with deduped as (
      select distinct on (coalesce(m.media_asset_id, m.id))
             m.id,
             m.type,
             m.width,
             m.height,
             m.duration_seconds,
             m.taken_at,
             to_char(m.taken_at, 'YYYY-MM-DD') as day,
             to_char(m.taken_at, 'YYYY-MM-DD"T"HH24:MI:SS') as ts
        from media m
       where m.visibility <> 'private'
         and m.taken_at >= $1::date
         and m.taken_at < $2::date
         and (
           (m.type = 'photo' and coalesce(m.width, 0) >= 480 and coalesce(m.height, 0) >= 480 and (
             select decision from content_quality_reviews q
              where q.target_kind = 'media_subject_check' and q.target_id = m.id
              order by q.reviewed_at desc limit 1
           ) = 'approved')
           or (m.type = 'video' and coalesce((
             select decision from content_quality_reviews q
              where q.target_kind = 'media_subject_check' and q.target_id = m.id
              order by q.reviewed_at desc limit 1
           ), 'approved') <> 'store_only')
         )
         and exists (
           select 1 from media_locations l
            where l.media_asset_id = m.media_asset_id
              and l.variant in ('web', 'thumbnail', 'poster')
              and l.status = 'ready'
              and l.provider in ('oss', 'hot')
         )
       order by coalesce(m.media_asset_id, m.id),
                (coalesce(m.width, 0) * coalesce(m.height, 0)) desc,
                m.taken_at desc,
                m.id asc
    )
    select id, type, width, height, duration_seconds, day, ts
      from deduped
     order by taken_at asc, id asc
  `, [from, until])).rows;

  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(r);
  }

  const foldBursts = (list) => {
    const outList = [];
    let burst = [];
    let lastMs = 0;
    const flush = () => {
      if (!burst.length) return;
      const videos = burst.filter((x) => x.type === "video");
      const photos = burst.filter((x) => x.type !== "video");
      const topPhotos = [...photos]
        .sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)))
        .slice(0, 3);
      outList.push(...[...videos, ...topPhotos].sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id)));
      burst = [];
    };
    for (const item of list) {
      const ms = Date.parse(`${item.ts}+08:00`);
      if (burst.length && ms - lastMs > 90_000) flush();
      burst.push(item);
      lastMs = ms;
    }
    flush();
    return outList;
  };

  const out = {};
  for (const [day, list] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const folded = foldBursts(list);
    const agg = aggregateDayMedia(
      folded.map((x) => ({ id: x.id, type: x.type === "video" ? "video" : "photo", takenAt: x.ts, allowed: true })),
      { max: 40 },
    );
    out[day] = {
      firstScreenMediaIds: agg.firstScreenMediaIds,
      expandedMediaIds: agg.expandedMediaIds,
      allApprovedMediaIds: list.map((x) => x.id),
    };
  }
  return out;
}

function privateDirectory(directory) {
  if (!nonempty(directory)) refuse("PRIVATE_OUTPUT_REQUIRED", "Specify a private directory with --out.");
  const resolved = path.resolve(directory);
  assertOutsideRepository(resolved, REPO);
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  assertOutsideRepository(resolved, REPO);
  return resolved;
}

function writePrivateJson(file, value) {
  assertOutsideRepository(file, REPO);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function resolveNightRdsUrl() {
  const local = new URL("../../.data/night-rds.mjs", import.meta.url);
  if (fs.existsSync(fileURLToPath(local))) return local.href;
  const fallback = process.env.NIANLIFE_NIGHT_RDS ?? path.join(homedir(), "Documents", "Nianlife", "v2", ".data", "night-rds.mjs");
  return pathToFileURL(fallback).href;
}

async function connectReadOnly() {
  const { openRds } = await import(resolveNightRdsUrl());
  return openRds({ readOnly: true, localPort: Number(process.env.NIANLIFE_RDS_PORT ?? (15470 + Math.floor(Math.random() * 100))) });
}

function realNames() {
  const ops = process.env.NIANLIFE_OPS_DIR ?? path.join(homedir(), "NianlifeOps", "ops-daily");
  const file = path.join(ops, "real-names.private.json");
  if (!fs.existsSync(file)) refuse("REAL_NAMES_REQUIRED", "Private real-name privacy rules are missing.");
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(value.names) || !value.names.every(nonempty)) refuse("REAL_NAMES_REQUIRED", "Private real-name privacy rules are invalid.");
  return value.names;
}

export async function prepare(out, { today = shanghaiToday(), lookbackDays = 14, rewriteDays = [] } = {}) {
  if (!validDay(today)) refuse("INVALID_TIME", "Invalid Shanghai date.");
  const span = Math.max(1, Math.min(366, Number(lookbackDays) || 14));
  for (const rd of rewriteDays) {
    if (!validDay(rd) || rd >= today) refuse("INVALID_REWRITE_DAY", "Rewrite days must be valid past YYYY-MM-DD dates.", { day: rd });
  }
  const directory = privateDirectory(out);
  if (fs.existsSync(path.join(directory, "source-pack.json"))) refuse("OUTPUT_EXISTS", "Source pack already exists; use a fresh private directory.");
  realNames();
  const ecs = resolveEcsConnection();
  const windowFrom = addDays(today, -span);
  const earliestRewrite = [...rewriteDays].sort()[0] ?? windowFrom;
  const from = earliestRewrite < windowFrom ? earliestRewrite : windowFrom;
  const readyThrough = addDays(today, -1);
  const allDays = [];
  for (let d = windowFrom; d <= readyThrough; d = addDays(d, 1)) allDays.push(d);
  for (const rd of rewriteDays) if (!allDays.includes(rd)) allDays.push(rd);
  allDays.sort();
  const months = [...new Set(allDays.map((day) => day.slice(0, 7)))];
  const production = path.join(directory, "production");
  fs.mkdirSync(production, { recursive: true, mode: 0o700 });
  const snapshots = months.map((month) => {
    const snapshotFile = `production/${month}.json`;
    const snapshot = readProductionSnapshot(month, path.join(directory, snapshotFile), ecs);
    return { month, revision: snapshot.revision, snapshotFile: snapshot.content === null ? null : snapshotFile, content: snapshot.content };
  });
  const rds = await connectReadOnly();
  let allSources;
  let rdsDayMedia;
  try {
    allSources = await loadSources(rds.client, from, today);
    rdsDayMedia = await loadApprovedDayMedia(rds.client, from, today);
  } finally {
    await rds.close();
  }
  const priorByDay = new Map(snapshots.flatMap((s) => (s.content?.days ?? []).map((d) => [d.day, d])));
  const covered = new Set(priorByDay.keys());
  const rewriteSet = new Set(rewriteDays);
  for (const rd of rewriteSet) {
    if (!covered.has(rd)) refuse("INVALID_REWRITE_DAY", "Cannot rewrite a day that is not currently published.", { day: rd });
  }
  const days = allDays.filter((day) => (rewriteSet.has(day) || !covered.has(day)) && (
    allSources.some((source) => source.day === day && isReadable(source.text))
    || ((rdsDayMedia[day]?.firstScreenMediaIds?.length ?? 0) > 0 && allSources.some((source) => source.day === day))
  ));
  const sources = allSources.filter((source) => days.includes(source.day));
  const dayMedia = {};
  for (const d of days) {
    const prior = priorByDay.get(d);
    const live = rdsDayMedia[d];
    if (prior) {
      dayMedia[d] = {
        firstScreenMediaIds: prior.firstScreenMediaIds?.length ? prior.firstScreenMediaIds : (live?.firstScreenMediaIds ?? []),
        expandedMediaIds: prior.expandedMediaIds?.length ? prior.expandedMediaIds : (live?.expandedMediaIds ?? []),
        allApprovedMediaIds: [...new Set([
          ...(prior.expandedMediaIds ?? []),
          ...(live?.allApprovedMediaIds ?? []),
        ])],
      };
    } else if (live) {
      dayMedia[d] = live;
    } else {
      dayMedia[d] = { firstScreenMediaIds: [], expandedMediaIds: [], allApprovedMediaIds: [] };
    }
  }
  const pack = {
    schema: PACK_SCHEMA,
    generatedAt: new Date().toISOString(),
    today,
    from,
    lookbackDays: span,
    rewriteDays: [...rewriteSet].sort(),
    readyThrough,
    days,
    sources,
    dayMedia,
    sourceFingerprint: sha256(JSON.stringify(sources)),
    months: snapshots.map(({ month, revision, snapshotFile }) => ({ month, revision, snapshotFile })),
    coveredDays: [...covered].sort(),
    noReadableSourceDays: allDays.filter((day) => !covered.has(day) && !days.includes(day)),
  };
  writePrivateJson(path.join(directory, "source-pack.json"), pack);
  return { days: days.length, rewriteDays: rewriteSet.size, sources: sources.length, sourcePack: path.join(directory, "source-pack.json") };
}

export async function apply(out, decisionsFile, { literary = false, monthMetaFile = null } = {}) {
  const directory = privateDirectory(out);
  if (!nonempty(decisionsFile)) refuse("DECISIONS_REQUIRED", "Specify the private decisions JSON with --decisions.");
  assertOutsideRepository(path.resolve(decisionsFile), REPO);
  const packFile = path.join(directory, "source-pack.json");
  const packBytes = fs.readFileSync(packFile);
  const pack = JSON.parse(packBytes.toString("utf8"));
  const decisionBytes = fs.readFileSync(decisionsFile);
  const decisions = JSON.parse(decisionBytes.toString("utf8"));
  const monthMetaByMonth = monthMetaFile ? JSON.parse(fs.readFileSync(path.resolve(monthMetaFile), "utf8")) : {};
  if (monthMetaFile) assertOutsideRepository(path.resolve(monthMetaFile), REPO);
  if (pack.schema !== PACK_SCHEMA || !Array.isArray(pack.days) || !Array.isArray(pack.months)
    || !validDay(pack.today) || !validDay(pack.from) || pack.readyThrough !== addDays(pack.today, -1)
    || sha256(JSON.stringify(pack.sources)) !== pack.sourceFingerprint) refuse("INVALID_SOURCE_PACK", "Prepared source pack failed integrity checks.");
  checkedSources(pack.sources);
  if (!Array.isArray(decisions) || decisions.some((decision) => !decision || !pack.days.includes(decision.day))) refuse("UNPREPARED_DAY", "Decisions may only address prepared days.");
  const allowRewriteDays = Array.isArray(pack.rewriteDays) ? pack.rewriteDays : [];
  const names = realNames();
  const ecs = resolveEcsConnection();
  const rds = await connectReadOnly();
  let currentSources;
  try { currentSources = (await loadSources(rds.client, pack.from, pack.today)).filter((source) => pack.days.includes(source.day)); } finally { await rds.close(); }
  assertSourcesUnchanged(pack.sources, currentSources);

  const candidateDir = path.join(directory, "candidates");
  const checkDir = path.join(directory, "apply-production");
  if (fs.existsSync(path.join(directory, "review-receipt.json"))) refuse("OUTPUT_EXISTS", "Reviewed candidates already exist; prepare a fresh source pack.");
  fs.mkdirSync(candidateDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(checkDir, { recursive: true, mode: 0o700 });
  const targetMonths = [...new Set([
    ...decisions.map((decision) => decision.day.slice(0, 7)),
    ...Object.keys(monthMetaByMonth),
  ])];
  const results = [];
  for (const month of targetMonths) {
    const prepared = pack.months.find((snapshot) => snapshot.month === month);
    if (!prepared || !(prepared.revision === "absent" || /^[a-f0-9]{64}$/.test(prepared.revision))) refuse("INVALID_SOURCE_PACK", "Missing production revision evidence.");
    let original = null;
    if (prepared.revision !== "absent") {
      if (prepared.snapshotFile !== `production/${month}.json`) refuse("INVALID_SOURCE_PACK", "Invalid production snapshot path.");
      const snapshotBytes = fs.readFileSync(path.join(directory, prepared.snapshotFile));
      if (sha256(snapshotBytes) !== prepared.revision) refuse("PRODUCTION_SNAPSHOT_CHANGED", "Prepared production snapshot was modified.");
      original = JSON.parse(snapshotBytes.toString("utf8"));
    }
    const fresh = readProductionSnapshot(month, path.join(checkDir, `${month}.json`), ecs);
    if (fresh.revision !== prepared.revision) refuse("PRODUCTION_CHANGED", "Production changed after preparation; prepare a fresh source pack.");
    const built = buildCandidate({
      month,
      original,
      decisions: decisions.filter((decision) => decision.day.startsWith(`${month}-`)),
      sources: pack.sources.filter((source) => source.day.startsWith(`${month}-`)),
      currentSources: currentSources.filter((source) => source.day.startsWith(`${month}-`)),
      realNames: names,
      now: new Date().toISOString(),
      allowRewriteDays: allowRewriteDays.filter((d) => d.startsWith(`${month}-`)),
      literary,
      monthMeta: monthMetaByMonth[month] ?? null,
      dayMedia: pack.dayMedia ?? null,
    });
    results.push({ ...built, expectedRevision: prepared.revision });
  }

  const reviews = [];
  for (const result of results) {
    const review = { ...result.review, expectedRevision: result.expectedRevision, candidateFile: null, candidateSha256: null };
    if (result.review.wrote.length || result.review.metaChanged) {
      review.candidateFile = `candidates/${result.review.month}.json`;
      const destination = path.join(directory, review.candidateFile);
      writePrivateJson(destination, result.content);
      review.candidateSha256 = sha256(fs.readFileSync(destination));
    }
    reviews.push(review);
  }
  const receipt = { schema: RECEIPT_SCHEMA, reviewedAt: new Date().toISOString(), sourcePackSha256: sha256(packBytes), decisionsSha256: sha256(decisionBytes),
    editor: "antigravity", modelCalls: 0, databaseWrites: 0, published: false, months: reviews };
  writePrivateJson(path.join(directory, "review-receipt.json"), receipt);
  return { candidates: reviews.filter((review) => review.candidateFile).length, wroteDays: reviews.reduce((count, review) => count + review.wrote.length, 0), rewrittenDays: reviews.reduce((count, review) => count + (review.rewritten?.length ?? 0), 0), published: false, receipt: path.join(directory, "review-receipt.json") };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : undefined; };
  const flag = (name) => args.includes(`--${name}`);
  const out = option("out");
  try {
    if (args[0] === "prepare") {
      const lookbackDays = option("lookback-days") ? Number(option("lookback-days")) : 21;
      const rewriteDays = option("rewrite-days") ? option("rewrite-days").split(",").map((s) => s.trim()).filter(Boolean) : [];
      console.log(JSON.stringify(await prepare(out, { today: option("today") ?? shanghaiToday(), lookbackDays, rewriteDays })));
    } else if (args[0] === "apply") {
      console.log(JSON.stringify(await apply(out, option("decisions"), { literary: flag("literary"), monthMetaFile: option("month-meta") ?? null })));
    } else {
      refuse("INVALID_COMMAND", "Use prepare --out <private-directory> [--lookback-days N] [--rewrite-days d1,d2] or apply --out <same-directory> --decisions <private-json> [--literary] [--month-meta <json>].");
    }
  } catch (error) {
    // Detailed validation findings may contain private quotations. Save privately, never log them.
    try {
      const directory = privateDirectory(out);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      writePrivateJson(path.join(directory, `review-failed-${stamp}.json`), { schema: RECEIPT_SCHEMA, published: false, code: error.code ?? "EDITOR_FAILED", message: error.message, details: error.details ?? {} });
    } catch { /* No unsafe fallback destination. */ }
    console.error(`Codex editor refused: ${error.code ?? "EDITOR_FAILED"}. Details are in the private output directory when available.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
