import { NextResponse } from "next/server";
import { isValidWeekId } from "@/lib/weekend/content";
import { WeekendStateError, WeekendStateStore } from "@/lib/weekend/state-store";
import type { DepartureKey, SundayOutcome } from "@/lib/weekend/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 32 * 1024;
const MAX_ID_LENGTH = 120;
const MAX_LABEL_LENGTH = 80;
const MAX_TAG_LENGTH = 48;
const MAX_TAGS_COUNT = 10;
const MAX_NOTE_LENGTH = 240;

const VALID_DEPARTURES = new Set<DepartureKey>(["sat_morning", "sat_afternoon"]);
const VALID_OUTCOMES = new Set<SundayOutcome>([
  "went_loved",
  "went_adult_meh",
  "went_tired",
  "went_pitfall",
  "stayed_home",
]);

function jsonResponse(status: number, body: unknown): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
  { allowEmpty = false } = {},
): string {
  if (typeof value !== "string") {
    throw new WeekendStateError(400, "INVALID_FIELD", `${field} must be a string`);
  }
  if (/[\r\n\0]/.test(value)) {
    throw new WeekendStateError(400, "INVALID_FIELD", `${field} contains disallowed control characters`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    throw new WeekendStateError(400, "INVALID_FIELD", `${field} must not be empty`);
  }
  if (trimmed.length > maxLength) {
    throw new WeekendStateError(400, "STRING_TOO_LONG", `${field} exceeds maximum length of ${maxLength}`);
  }
  return trimmed;
}

function parseOptionalNullableId(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return parseBoundedString(value, field, MAX_ID_LENGTH);
}

function parseRequiredNullableId(value: unknown, field: string): string | null {
  if (value === null) return null;
  return parseBoundedString(value, field, MAX_ID_LENGTH);
}

function parseTags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new WeekendStateError(400, "INVALID_TAGS", "tags must be an array");
  }
  if (value.length > MAX_TAGS_COUNT) {
    throw new WeekendStateError(400, "TOO_MANY_TAGS", `tags exceeds maximum count of ${MAX_TAGS_COUNT}`);
  }
  return value.map((item, idx) => parseBoundedString(item, `tags[${idx}]`, MAX_TAG_LENGTH));
}

function extractWeekId(body: Record<string, unknown>, url: URL, required: boolean): string | undefined {
  const raw = body.weekId !== undefined ? body.weekId : url.searchParams.get("weekId") ?? undefined;
  if (raw === undefined) {
    if (required) {
      throw new WeekendStateError(400, "MISSING_WEEK_ID", "weekId is required");
    }
    return undefined;
  }
  if (typeof raw !== "string" || !isValidWeekId(raw)) {
    throw new WeekendStateError(400, "INVALID_WEEK_ID", "weekId must be a valid YYYY-MM-DD date");
  }
  return raw;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new WeekendStateError(400, "BODY_TOO_LARGE", "Request body is too large");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new WeekendStateError(400, "BODY_TOO_LARGE", "Request body is too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WeekendStateError(400, "INVALID_JSON", "Invalid JSON body");
  }
  if (!isPlainObject(parsed)) {
    throw new WeekendStateError(400, "INVALID_BODY", "Request body must be a JSON object");
  }
  return parsed;
}

function handleRouteError(error: unknown): NextResponse {
  if (error instanceof WeekendStateError) {
    return jsonResponse(error.status, { ok: false, code: error.code, error: error.message });
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  return jsonResponse(500, { ok: false, code: "INTERNAL_ERROR", error: message });
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const weekId = url.searchParams.get("weekId");
    if (!weekId || !isValidWeekId(weekId)) {
      return jsonResponse(400, {
        ok: false,
        code: "INVALID_WEEK_ID",
        error: "Query parameter weekId must be a valid YYYY-MM-DD date",
      });
    }

    const store = new WeekendStateStore();
    const [state, excludedExperienceTypes] = await Promise.all([
      store.readWeekState(weekId),
      store.readExcludedTypes(),
    ]);
    return jsonResponse(200, { ok: true, state, excludedExperienceTypes });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const body = await readJsonBody(request);
    const action = body.action;
    const store = new WeekendStateStore();

    if (action === "selectProposal") {
      const weekId = extractWeekId(body, url, true)!;
      const proposalId = parseRequiredNullableId(body.proposalId, "proposalId");
      let departure: DepartureKey | undefined;
      if (body.departure !== undefined) {
        if (typeof body.departure !== "string" || !VALID_DEPARTURES.has(body.departure as DepartureKey)) {
          throw new WeekendStateError(400, "INVALID_DEPARTURE", "departure must be sat_morning or sat_afternoon");
        }
        departure = body.departure as DepartureKey;
      }

      const state = await store.selectProposal({ weekId, proposalId, departure });
      const excludedExperienceTypes = await store.readExcludedTypes();
      return jsonResponse(200, { ok: true, state, excludedExperienceTypes });
    }

    if (action === "ackFridayAlert") {
      const weekId = extractWeekId(body, url, true)!;
      if (typeof body.adoptedSwap !== "boolean") {
        throw new WeekendStateError(400, "INVALID_ADOPTED_SWAP", "adoptedSwap must be a boolean");
      }

      const state = await store.ackFridayAlert({ weekId, adoptedSwap: body.adoptedSwap });
      const excludedExperienceTypes = await store.readExcludedTypes();
      return jsonResponse(200, { ok: true, state, excludedExperienceTypes });
    }

    if (action === "submitSundayFeedback") {
      const weekId = extractWeekId(body, url, true)!;
      if (typeof body.outcome !== "string" || !VALID_OUTCOMES.has(body.outcome as SundayOutcome)) {
        throw new WeekendStateError(400, "INVALID_OUTCOME", "Invalid Sunday feedback outcome");
      }
      const tags = parseTags(body.tags);
      const proposalId = parseOptionalNullableId(body.proposalId, "proposalId");
      const receiptKey =
        body.receiptKey === undefined ? undefined : parseBoundedString(body.receiptKey, "receiptKey", MAX_ID_LENGTH);

      const { state, deduplicated } = await store.submitSundayFeedback({
        weekId,
        outcome: body.outcome as SundayOutcome,
        tags,
        proposalId,
        receiptKey,
      });
      const excludedExperienceTypes = await store.readExcludedTypes();
      return jsonResponse(200, {
        ok: true,
        state,
        excludedExperienceTypes,
        ...(deduplicated ? { deduplicated: true } : {}),
      });
    }

    if (action === "excludeType") {
      const weekId = extractWeekId(body, url, false);
      if (body.mode !== "add" && body.mode !== "remove") {
        throw new WeekendStateError(400, "INVALID_MODE", "mode must be add or remove");
      }
      const experienceType = parseBoundedString(body.experienceType, "experienceType", MAX_ID_LENGTH);
      const label =
        body.label === undefined ? undefined : parseBoundedString(body.label, "label", MAX_LABEL_LENGTH);
      const addedBy =
        body.addedBy === undefined ? undefined : parseBoundedString(body.addedBy, "addedBy", MAX_LABEL_LENGTH);
      const note =
        body.note === undefined ? undefined : parseBoundedString(body.note, "note", MAX_NOTE_LENGTH, { allowEmpty: true });

      const excludedExperienceTypes = await store.updateExcludedType({
        mode: body.mode,
        experienceType,
        label,
        addedBy,
        note,
      });
      const state = weekId ? await store.readWeekState(weekId) : null;
      return jsonResponse(200, { ok: true, state, excludedExperienceTypes });
    }

    throw new WeekendStateError(400, "INVALID_ACTION", "Unsupported weekend-state action");
  } catch (error) {
    return handleRouteError(error);
  }
}
