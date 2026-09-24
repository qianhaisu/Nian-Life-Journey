import type { YearChapter, MonthChapter } from "./memory-chapters";
import type { MonthContent } from "./month-content";
import { ageAtMonth, formatMonth } from "./time-signature";

export function contentOnlyChapter(month: string, birthDay?: string): MonthChapter {
  const beforeBirth = birthDay && month < birthDay.slice(0, 7)
    ? `出生前 ${(Number(birthDay.slice(0, 4)) - Number(month.slice(0, 4))) * 12 + Number(birthDay.slice(5, 7)) - Number(month.slice(5, 7))} 个月`
    : undefined;
  return { month, label: formatMonth(month), shortLabel: `${Number(month.slice(5))} 月`,
    ageLabel: beforeBirth ?? ageAtMonth(birthDay, month), memories: [], traceDays: [], photos: [],
    photoCount: 0, videoCount: 0, photoDays: [], withheldMediaCount: 0 };
}

// Edited months belong in every navigation and timeline, even without a database chapter.
// April and May 2024 are intentionally outside the published archive (Teddy, 2026-09-24).
export function withEditedChapters(chapters: YearChapter[], contents: MonthContent[], birthDay?: string): YearChapter[] {
  const years = new Map(chapters.map(y => [y.year, { ...y, months: y.months.filter(m => m.month !== "2024-04" && m.month !== "2024-05") }]));
  for (const content of contents) {
    if (content.month < "2024-06" || !content.days.length) continue;
    const year = content.month.slice(0, 4);
    const entry = years.get(year) ?? { year, months: [] };
    if (!entry.months.some(m => m.month === content.month)) entry.months.push(contentOnlyChapter(content.month, birthDay));
    years.set(year, entry);
  }
  return [...years.values()].filter(y => y.months.length).map(y => ({ ...y, months: [...y.months].sort((a,b) => b.month.localeCompare(a.month)) }))
    .sort((a,b) => b.year.localeCompare(a.year));
}
