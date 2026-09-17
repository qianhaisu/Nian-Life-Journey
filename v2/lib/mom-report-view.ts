// Assembles a /mom-reports page from two independent things, kept apart on purpose:
//   - the curated real report text (lib/mom-report-content.ts) — never touched by archive state;
//   - the cover photograph, which DOES come from the live archive, through the exact same
//     vouching/deliverability gate every other family page uses (buildMonthComposition's `cover`,
//     lib/publication-moments.ts) — so a mom report never ships a picture nothing stands behind.
//
// The two are allowed to disagree (docs/nianlife-zhangnian-design-2026-09-16.md: "月报数据与当前
// 数据库可能不是同一组证据"). A month with real report text but no deliverable cover photo yet still
// renders — honestly, without one — rather than borrowing a photo from a different month.
import type { FamilyArchive } from "@/lib/family-archive";
import { listMomReportMonths, MOM_REPORTS, type MomReportContent } from "@/lib/mom-report-content";
import { findMonth } from "@/lib/memory-chapters";
import { buildMonthComposition } from "@/lib/publication-moments";
import type { MediaRef } from "@/lib/memory-chapters";
import { formatDay, timeSignatureFor } from "@/lib/time-signature";

export type MomReportCover = { photo: MediaRef; day?: string; dateLabel?: string; ageLabel?: string };

export type MomReportView = {
  month: string;
  months: string[];
  content: MomReportContent;
  ageLabel?: string;
  birthLabel?: string;
  cover?: MomReportCover;
};

// The month a reader lands on with no `?month=` in the URL, or an unrecognised one: the newest real
// report. "Newest" is a string-sort on "YYYY-MM", which is correct for calendar months and never
// needs today's date — this list only ever holds months that already have a real 苏静月报.
export function resolveMomReportMonth(requested: string | undefined): string | undefined {
  const months = listMomReportMonths();
  if (months.length === 0) return undefined;
  if (requested && months.includes(requested)) return requested;
  return months[months.length - 1];
}

export function buildMomReportView(archive: FamilyArchive, requested: string | undefined): MomReportView | undefined {
  const month = resolveMomReportMonth(requested);
  if (!month) return undefined;
  const content = MOM_REPORTS[month];
  const chapter = findMonth(archive.chapters, month);
  let cover: MomReportCover | undefined;
  if (chapter) {
    const composition = buildMonthComposition(chapter, archive.privilege, archive.traceEvents, archive.birthDay);
    if (composition.cover) {
      const signature = timeSignatureFor(composition.cover.takenAt, archive.birthDay);
      cover = { photo: composition.cover, day: signature?.day, dateLabel: signature?.dateLabel, ageLabel: signature?.ageLabel };
    }
  }
  return {
    month,
    months: listMomReportMonths(),
    content,
    ageLabel: chapter?.ageLabel,
    birthLabel: archive.birthDay ? formatDay(archive.birthDay) : undefined,
    cover,
  };
}
