// Assembles a /mom-reports page from the curated real report content (lib/mom-report-content.ts).
// The only thing this file reads from the live archive is 张年's birth date, to compute the age at
// the report's own month the same way every other page does (lib/time-signature.ts's ageAtMonth) —
// never hand-typed, so it stays correct if the birth date record is ever corrected.
//
// 2026-09-17: the cover photo and every other image in a report (闪光时刻, 外出小抄的实拍照片) are
// now part of the curated content itself — 苏静 asked for full V1.3 fidelity, and the photo she
// picked for August IS the content, not a stand-in a selection algorithm found. This file no longer
// reaches into the archive's media/publication pipeline for a substitute cover.
import type { FamilyArchive } from "@/lib/family-archive";
import { listMomReportMonths, MOM_REPORTS, type MomReportContent } from "@/lib/mom-report-content";
import { ageAtMonth, formatDay } from "@/lib/time-signature";

export type MomReportView = {
  month: string;
  months: string[];
  content: MomReportContent;
  ageLabel?: string;
  birthLabel?: string;
  // "2025.01.03" — V1.3's own compact date punctuation for the hero subtitle line
  // ("2025.01.03 出生｜2026年8月约 1岁7个月"), kept apart from birthLabel's "2025 年 1 月 3 日"
  // (used everywhere else on the site) because that one line is the one place quoting V1.3 verbatim.
  birthCompact?: string;
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

export function buildMomReportView(archive: Pick<FamilyArchive, "birthDay">, requested: string | undefined): MomReportView | undefined {
  const month = resolveMomReportMonth(requested);
  if (!month) return undefined;
  const content = MOM_REPORTS[month];
  return {
    month,
    months: listMomReportMonths(),
    content,
    ageLabel: ageAtMonth(archive.birthDay, month),
    birthLabel: archive.birthDay ? formatDay(archive.birthDay) : undefined,
    birthCompact: archive.birthDay?.replaceAll("-", "."),
  };
}

export type { MomReportContent };
