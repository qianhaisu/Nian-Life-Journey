// The private reading surface (lib/preview-reading.ts). What these hold to: a draft reaches this
// page only through a marker row a reviewer wrote, the marker can never publish anything, and the
// gate does not read the `decision` column — the 数据 track writes 'needs_human_review' there
// because the column is NOT NULL, and assembleStore() would rewrite anything else anyway.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MONTHLY_REVIEW_DRAFT_KIND, MONTHLY_REVIEW_DRAFT_PROMPT_VERSION,
  PREVIEW_EVENT_KIND, PREVIEW_EVENT_PROMPT_VERSION, PREVIEW_PROVIDER,
  buildPreviewYear, confirmedPhotoIdsByEvent, monthlyReviewDraftsFrom, previewEventIdsFrom,
} from "../lib/preview-reading.ts";

const BIRTH = "2025-01-03";
const previewMark = (id, extra = {}) => ({ targetKind: PREVIEW_EVENT_KIND, targetId: id, provider: PREVIEW_PROVIDER, promptVersion: PREVIEW_EVENT_PROMPT_VERSION, decision: "needs_human_review", reasonCodes: [], ...extra });
const identity = (id, occurredAt, story = "那天他做了一件真的发生过的事。", title = `记忆 ${id}`) => ({ id, title, story, occurredAt });
const month = (key, label, ageLabel) => ({ month: key, label, shortLabel: `${Number(key.slice(5, 7))} 月`, ageLabel });
const photo = (id, dims = { width: 1600, height: 1200 }) => ({ id, profileId: "p", type: "photo", src: `/api/media/${id}`, alt: "", visibility: "family", ...dims });

const yearOf = (input) => buildPreviewYear({
  year: "2025", months: [], identities: [], publishedIds: new Set(), previewIds: new Set(),
  reviewDrafts: new Map(), photosByEvent: new Map(), media: [], leadById: new Map(), birthDay: BIRTH, ...input,
});

test("only the exact marker triple opens the private surface — decision is not part of the gate", () => {
  const ids = previewEventIdsFrom([
    previewMark("marked"),
    previewMark("rejected-decision", { decision: "rejected_unrelated" }),
    previewMark("wrong-provider", { provider: "someone-else" }),
    previewMark("wrong-version", { promptVersion: "preview-read-v0" }),
    { targetKind: "life_event", targetId: "a-real-publication-decision", provider: PREVIEW_PROVIDER, promptVersion: PREVIEW_EVENT_PROMPT_VERSION, decision: "approved" },
  ]);
  assert.deepEqual([...ids].sort(), ["marked", "rejected-decision"]);
});

test("a month review draft is read out of its own marker row, never out of monthly_snapshot", () => {
  const drafts = monthlyReviewDraftsFrom([
    { targetKind: MONTHLY_REVIEW_DRAFT_KIND, targetId: "2025-11", provider: PREVIEW_PROVIDER, promptVersion: MONTHLY_REVIEW_DRAFT_PROMPT_VERSION, reasonCodes: ["这个月他开始…", "  ", "月底长出第七颗牙。"] },
    { targetKind: MONTHLY_REVIEW_DRAFT_KIND, targetId: "not-a-month", provider: PREVIEW_PROVIDER, promptVersion: MONTHLY_REVIEW_DRAFT_PROMPT_VERSION, reasonCodes: ["x"] },
    { targetKind: MONTHLY_REVIEW_DRAFT_KIND, targetId: "2025-10", provider: PREVIEW_PROVIDER, promptVersion: MONTHLY_REVIEW_DRAFT_PROMPT_VERSION, reasonCodes: [] },
  ]);
  assert.deepEqual([...drafts.keys()], ["2025-11"]);
  assert.deepEqual(drafts.get("2025-11"), ["这个月他开始…", "月底长出第七颗牙。"]);
});

test("a year reads January first, published and draft together, each labelled for what it is", () => {
  const year = yearOf({
    months: [month("2025-03", "2025 年 3 月", "2 个月"), month("2025-01", "2025 年 1 月", "出生的那个月")],
    identities: [
      identity("published-march", "2025-03-08 00:00:00+00"),
      identity("draft-january", "2025-01-20 00:00:00+00"),
      identity("unmarked", "2025-01-21 00:00:00+00"),
      identity("other-year", "2026-01-21 00:00:00+00"),
    ],
    publishedIds: new Set(["published-march"]),
    previewIds: new Set(["draft-january"]),
  });

  assert.deepEqual(year.months.map((item) => item.month), ["2025-01", "2025-03"], "ascending: a year is read the way it was lived");
  assert.deepEqual(year.months[0].stories.map((story) => [story.id, story.draft]), [["draft-january", true]]);
  assert.deepEqual(year.months[1].stories.map((story) => [story.id, story.draft]), [["published-march", false]]);
  assert.ok(year.months[0].stories[0].signature.ageLabel, "两个时钟: a draft carries its age like everything else");
  assert.ok(year.readable);
});

test("a story nobody marked stays out, and so does a placeholder row", () => {
  const year = yearOf({
    months: [month("2025-01", "2025 年 1 月")],
    identities: [
      identity("unmarked", "2025-01-21 00:00:00+00"),
      identity("placeholder", "2025-01-22 00:00:00+00", "[media]"),
      identity("import-label", "2025-01-23 00:00:00+00", "Quark 照片初始化 · 10 media"),
    ],
    previewIds: new Set(["placeholder", "import-label"]),
  });
  assert.deepEqual(year.months[0].stories, []);
  assert.equal(year.readable, false);
});

test("a month with nothing readable keeps its heading — the quiet index, not a fabricated review", () => {
  const year = yearOf({
    months: [month("2025-05", "2025 年 5 月", "4 个月"), month("2025-06", "2025 年 6 月", "5 个月")],
    identities: [identity("only-june", "2025-06-02 00:00:00+00")],
    previewIds: new Set(["only-june"]),
  });
  assert.deepEqual(year.months.map((item) => [item.month, item.stories.length, Boolean(item.review)]), [["2025-05", 0, false], ["2025-06", 1, false]]);
});

test("a draft is illustrated only by a picture a reviewer recorded for it, at a size worth drawing", () => {
  const reviews = [
    { targetKind: "media_binding", targetId: "draft|good-photo", decision: "approved" },
    { targetKind: "media_binding", targetId: "draft|too-small", decision: "approved" },
    { targetKind: "media_binding", targetId: "other-draft|not-approved", decision: "needs_human_review" },
    { targetKind: "media_binding", targetId: "malformed", decision: "approved" },
  ];
  assert.deepEqual([...confirmedPhotoIdsByEvent(reviews).entries()], [["draft", ["good-photo", "too-small"]]]);

  const year = yearOf({
    months: [month("2025-07", "2025 年 7 月")],
    identities: [identity("draft", "2025-07-04 00:00:00+00"), identity("other-draft", "2025-07-05 00:00:00+00")],
    previewIds: new Set(["draft", "other-draft"]),
    photosByEvent: confirmedPhotoIdsByEvent(reviews),
    media: [photo("good-photo"), photo("too-small", { width: 67, height: 120 }), photo("not-approved")],
  });
  const [first, second] = year.months[0].stories;
  assert.equal(first.photo?.id, "good-photo");
  assert.equal(second.photo, undefined, "a binding nobody approved illustrates nothing");
});
