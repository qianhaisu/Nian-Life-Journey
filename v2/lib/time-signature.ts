// The one place that turns a stored date into something a family member reads. Every page that used
// to slice `occurredAt` by hand ended up showing "08.11 00:00:00+00"; route all display through here.
//
// Two facts, nothing more: the calendar day the record belongs to, and how old 张年 was that day.
// No life-stage guessing ("学步期") — that is a data question, not a formatting one.
import { calendarDayOf } from "@/lib/timeline-dates";

export type TimeSignature = {
  // "YYYY-MM-DD", stable for `<time dateTime>`.
  day: string;
  // "2026 年 8 月 14 日"
  dateLabel: string;
  // "1 岁 7 个月" / "7 个月" / "出生的那天", undefined when the date predates birth or birth is unknown.
  ageLabel?: string;
};

export type AgeParts = { years: number; months: number; days: number };

// Profile.birthDate is a calendar day ("2025-01-03"), not an instant: it is taken as written and
// never passed through a timezone conversion, which is how a midnight-UTC birth date used to turn
// into the day before. Anything that is not a YYYY-MM-DD prefix is treated as unknown rather than
// guessed. The only place pages should get 张年's birth day from.
export function birthDayOf(profile: { birthDate?: string | null } | null | undefined): string | undefined {
  const match = profile?.birthDate?.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : undefined;
}

function ymd(day: string): [number, number, number] {
  return [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const utcDay = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day) / 86_400_000;

// Calendar age between two "YYYY-MM-DD" days, the way a parent counts "1 岁 7 个月 30 天": whole
// months are complete on the monthly anniversary of the birth day, and the days are the exact days
// since the last anniversary. When a month is too short for the birth day (born on the 31st,
// or on 29 February), the anniversary is that month's last day. Pure calendar arithmetic — no
// milliseconds/365, no days/30, no year subtraction.
export function ageBetween(birthDay: string, day: string): AgeParts | undefined {
  const [by, bm, bd] = ymd(birthDay);
  const [y, m, d] = ymd(day);
  if ([by, bm, bd, y, m, d].some((part) => Number.isNaN(part))) return undefined;
  let months = (y - by) * 12 + (m - bm);
  const anniversary = (offset: number) => {
    const year = by + Math.floor((bm - 1 + offset) / 12);
    const month = ((bm - 1 + offset) % 12) + 1;
    return utcDay(year, month, Math.min(bd, daysInMonth(year, month)));
  };
  const today = utcDay(y, m, d);
  if (today < anniversary(months)) months -= 1;
  if (months < 0) return undefined;
  return { years: Math.floor(months / 12), months: months % 12, days: today - anniversary(months) };
}

export function formatAge(age: AgeParts | undefined): string | undefined {
  if (!age) return undefined;
  if (age.years === 0 && age.months === 0) return age.days === 0 ? "出生的那天" : `${age.days} 天`;
  if (age.years === 0) return `${age.months} 个月`;
  if (age.months === 0) return `${age.years} 岁`;
  return `${age.years} 岁 ${age.months} 个月`;
}

export function formatDay(day: string): string {
  const [y, m, d] = ymd(day);
  if ([y, m, d].some((part) => Number.isNaN(part))) return day;
  return `${y} 年 ${m} 月 ${d} 日`;
}

// "2026 年 8 月"
export function formatMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (Number.isNaN(y) || Number.isNaN(m)) return month;
  return `${y} 年 ${m} 月`;
}

// The age reached during a month, counted in whole months from the birth month with the day of
// month ignored. A month is a chapter, not a day: "2026 年 8 月" reads "1 岁 7 个月" even though the
// 1st and 2nd are still 1 岁 6 个月, and it never carries a day count that would be false for most
// of the month. Undefined before the birth month.
export function ageInMonth(birthDay: string, month: string): AgeParts | undefined {
  const [by, bm] = ymd(birthDay);
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if ([by, bm, y, m].some((part) => Number.isNaN(part))) return undefined;
  const months = (y - by) * 12 + (m - bm);
  if (months < 0) return undefined;
  return { years: Math.floor(months / 12), months: months % 12, days: 0 };
}

// "当时 1 岁 7 个月" for a month chapter; the birth month reads as itself.
export function ageAtMonth(birthDay: string | undefined, month: string): string | undefined {
  if (!birthDay) return undefined;
  const age = ageInMonth(birthDay, month);
  if (!age) return undefined;
  if (age.years === 0 && age.months === 0) return "出生的那个月";
  return formatAge(age);
}

// "1 岁 到 1 岁 10 个月" across a year — the range its months cover, collapsed when both ends agree.
export function ageSpan(birthDay: string | undefined, months: string[]): string | undefined {
  if (!birthDay || months.length === 0) return undefined;
  const sorted = [...months].sort();
  const first = ageAtMonth(birthDay, sorted[0]);
  const last = ageAtMonth(birthDay, sorted[sorted.length - 1]);
  if (!first || !last) return undefined;
  if (first === last) return first;
  return `${first} 到 ${last}`;
}

export function timeSignatureFor(occurredAt: string | undefined | null, birthDay?: string): TimeSignature | undefined {
  const day = calendarDayOf(occurredAt);
  if (!day) return undefined;
  return { day, dateLabel: formatDay(day), ageLabel: ageOn(birthDay, day) };
}

// Two different questions, one algorithm (ageBetween):
//   ageOn      — how old 张年 was on the day a memory happened (historical age; timeSignatureFor uses it).
//   currentAge — how old he is today, where "today" is the calendar day in the family's timezone,
//                so an evening in Shanghai never reads as the previous UTC day. For the 张年 page.
export function ageOn(birthDay: string | undefined, day: string): string | undefined {
  if (!birthDay) return undefined;
  return formatAge(ageBetween(birthDay, day));
}

export function currentAge(birthDay: string | undefined, today: Date = new Date()): string | undefined {
  if (!birthDay) return undefined;
  const day = calendarDayOf(today.toISOString());
  return day ? ageOn(birthDay, day) : undefined;
}
