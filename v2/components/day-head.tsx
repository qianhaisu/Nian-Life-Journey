// A day inside a month chapter names itself "7 月 1 日": the masthead above already carries the
// year, so repeating it on every day turns the page into a register. `dateTime` keeps the full ISO
// day, so nothing machine-readable is lost.
export function dayLabel(dateLabel: string, year: string): string {
  return dateLabel.replace(`${year} 年 `, "");
}

// The running head of a day: the two clocks, calendar and life, and nothing else (原则二). In the
// reading column it hangs in the left margin; on a narrow screen it sits above the words.
//
// V1 (T16, 2026-09-04): the chapter masthead already states the month's age once ("当时 1 岁 6 个
// 月"). Printing the same label on every day turned a month into twenty repeats of one fact — a
// magazine does not restate its issue date under every article. `monthAgeLabel` is that one
// statement; a day only prints its own age when it actually differs (the days that cross a
// "岁/个月" boundary within the month).
export function DayHead({ day, dateLabel, ageLabel, monthAgeLabel, year }: { day: string; dateLabel: string; ageLabel?: string; monthAgeLabel?: string; year: string }) {
  const showAge = ageLabel && ageLabel !== monthAgeLabel;
  return <p className="month-day-date"><time dateTime={day}>{dayLabel(dateLabel, year)}</time>{showAge ? <span>{ageLabel}</span> : null}</p>;
}
