// 妈妈月报 (docs/mom-reports-implementation-handoff.md): real 苏静月报 text (lib/mom-report-content.ts)
// paired with a real, vouched cover photo for the same month (lib/mom-report-view.ts). These tests
// check the seam between the two, and the invariants the content module itself must hold — not the
// exact prose (that is transcribed, reviewed content, not something a test should re-assert word for
// word).
import test from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_PROFILE_ID } from "../lib/db/config.ts";
import { composeFamilyArchive } from "../lib/family-archive.ts";
import { buildChapters } from "../lib/memory-chapters.ts";
import { listMomReportMonths, MOM_REPORTS } from "../lib/mom-report-content.ts";
import { buildMomReportView, resolveMomReportMonth } from "../lib/mom-report-view.ts";

const BIRTH = "2025-01-03";

function store({ events = [], media = [], mediaAssets = [], mediaLocations = [], rawSources = [], qualityReviews = [] } = {}) {
  return {
    profile: { id: CANONICAL_PROFILE_ID, displayName: "张年", birthDate: BIRTH, timezone: "Asia/Shanghai", visibility: "family" },
    contributors: [], mediaAssets, mediaLocations, connectorStates: [], rawSources, dailyTraces: [], careEpisodes: [], monthlyFocusGoals: [], organizerRuns: [], organizerJobs: [], chatImportTasks: [], links: [], qualityReviews, monthlySnapshots: [],
    events, media, growthRecords: [], careRecords: [],
  };
}

test("每个月报条目里，测量点都没有虚构日期（dayKnown 恒为 false）", () => {
  for (const month of listMomReportMonths()) {
    const content = MOM_REPORTS[month];
    assert.ok(content.measurements.every((point) => point.dayKnown === false), `${month} 的测量点不该声称有具体日期`);
    assert.ok(content.measurements.length > 0, `${month} 应该至少有一个测量点`);
  }
});

test("六个方面顺序固定为：性格、健康、睡眠、饮食、运动、语言", () => {
  const content = MOM_REPORTS["2026-08"];
  assert.deepEqual(content.aspects.map((aspect) => aspect.key), ["personality", "health", "sleep", "food", "motor", "language"]);
});

test("resolveMomReportMonth: 合法月份原样返回，未知或缺省的月份回退到最新一期", () => {
  const months = listMomReportMonths();
  const latest = months[months.length - 1];
  assert.equal(resolveMomReportMonth("2026-08"), "2026-08");
  assert.equal(resolveMomReportMonth(undefined), latest);
  assert.equal(resolveMomReportMonth("2099-01"), latest, "不存在的月份不能渲染出一个假月报，只能回退");
});

test("buildMomReportView: 这个月没有可用照片时，正文照常渲染，封面照实留空", () => {
  const s = store();
  const archive = composeFamilyArchive(s, s.events, new Date("2026-09-17T00:00:00Z"));
  const view = buildMomReportView(archive, "2026-08");
  assert.ok(view);
  assert.equal(view.month, "2026-08");
  assert.equal(view.cover, undefined, "没有经过 subject-check 的照片，封面不能凭空出现");
  assert.equal(view.content.title, "八月的张年");
});

test("buildMomReportView: 一张真正经过审核的照片会被选为封面，并带上当时的日期和年龄", () => {
  const media = [{
    id: "media-mom-report-1", profileId: CANONICAL_PROFILE_ID, rawSourceId: "src-1", mediaAssetId: "asset-1", type: "photo",
    src: "/api/media/media-mom-report-1", alt: "8 月的一张照片", takenAt: "2026-08-20T03:00:00Z",
    visibility: "family", width: 1200, height: 1600,
  }];
  const mediaAssets = [{ id: "asset-1", profileId: CANONICAL_PROFILE_ID, mediaType: "photo", mimeType: "image/jpeg", createdAt: "2026-08-20T03:00:00Z" }];
  const mediaLocations = [{ id: "loc-1", mediaAssetId: "asset-1", provider: "hot", variant: "web", providerRef: "media-mom-report-1", status: "ready", createdAt: "2026-08-20T03:00:00Z", updatedAt: "2026-08-20T03:00:00Z" }];
  const rawSources = [{ id: "src-1", profileId: CANONICAL_PROFILE_ID, contributorId: "c1", sourceType: "family_photo", contentTypes: ["photo"], capturedAt: "2026-08-20T03:00:00Z", sourceLabel: "家庭相册", status: "processed", visibility: "family" }];
  const qualityReviews = [{ id: "qr-1", profileId: CANONICAL_PROFILE_ID, targetKind: "media_subject_check", targetId: "media-mom-report-1", decision: "approved", reviewedAt: "2026-08-21T00:00:00Z" }];
  const s = store({ media, mediaAssets, mediaLocations, rawSources, qualityReviews });
  const archive = composeFamilyArchive(s, s.events, new Date("2026-09-17T00:00:00Z"));
  const view = buildMomReportView(archive, "2026-08");
  assert.ok(view.cover, "trusted + subject-checked 的照片应该成为封面");
  assert.equal(view.cover.photo.id, "media-mom-report-1");
  assert.equal(view.cover.ageLabel, "1 岁 7 个月", "封面必须带着拍摄当时的年龄，不是现在的年龄");
});

test("身高体重曲线只用真实测量，height 里的空缺（2026-02）保持缺测而不是被抹平", () => {
  const content = MOM_REPORTS["2026-08"];
  const feb = content.measurements.find((point) => point.month === "2026-02");
  assert.equal(feb.height, null);
  assert.equal(feb.weight, 11.45);
});
