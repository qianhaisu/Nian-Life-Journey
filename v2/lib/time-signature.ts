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

function ymd(day: string): [number, number, number] {
  return [Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10))];
}

// Whole years and months elapsed between two "YYYY-MM-DD" days, borrowing a month when the day of
// month has not been reached yet — the way a parent counts "1 岁 7 个月".
export function ageBetween(birthDay: string, day: string): AgeParts | undefined {
  const [by, bm, bd] = ymd(birthDay);
  const [y, m, d] = ymd(day);
  if ([by, bm, bd, y, m, d].some((part) => Number.isNaN(part))) return undefined;
  let months = (y - by) * 12 + (m - bm);
  let days = d - bd;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  }
  if (months < 0) return undefined;
  return { years: Math.floor(months / 12), months: months % 12, days };
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

// Age on the first day of a month: "当时 1 岁 7 个月".
export function ageAtMonth(birthDay: string | undefined, month: string): string | undefined {
  if (!birthDay) return undefined;
  return formatAge(ageBetween(birthDay, `${month}-01`));
}

// "1 岁 7 个月 到 1 岁 11 个月" across a year, collapsed when both ends agree.
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
  return { day, dateLabel: formatDay(day), ageLabel: birthDay ? formatAge(ageBetween(birthDay, day)) : undefined };
}

// Age today, for the 张年 page.
export function currentAge(birthDay: string | undefined, today: Date = new Date()): string | undefined {
  if (!birthDay) return undefined;
  const day = calendarDayOf(today.toISOString());
  return day ? formatAge(ageBetween(birthDay, day)) : undefined;
}
