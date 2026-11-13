"use client";

import type { MouseEvent } from "react";
import { CardThumbnail } from "@/components/card-thumbnail";
import type { ThumbnailChoice } from "@/lib/day-photo-layout";

export type MonthCalendarDay = {
  day: string;
  title?: string;
  thumbnail?: ThumbnailChoice;
  hasPhotos?: boolean;
  isMilestone?: boolean;
  badge?: string;
};

export type CalendarCell = {
  day: string;
  dateNumber: number;
  isWeekend: boolean;
  entry?: MonthCalendarDay;
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;

/**
 * Build a Monday-first 7-column calendar grid for `year`-`month` (`YYYY`, `MM`),
 * padding leading and trailing slots with `null` so every row has 7 cells.
 */
export function buildMonthCalendarGrid(
  year: string,
  month: string,
  days: readonly MonthCalendarDay[],
): (CalendarCell | null)[] {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return [];

  const totalDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const byDay = new Map(days.map((item) => [item.day, item]));
  const monthPrefix = `${year}-${month.padStart(2, "0")}`;

  const cells: (CalendarCell | null)[] = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);

  for (let d = 1; d <= totalDays; d += 1) {
    const dayStr = `${monthPrefix}-${String(d).padStart(2, "0")}`;
    const weekdayIdx = (firstDow + d - 1) % 7;
    cells.push({
      day: dayStr,
      dateNumber: d,
      isWeekend: weekdayIdx >= 5,
      entry: byDay.get(dayStr),
    });
  }

  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function CuteStarIcon() {
  return (
    <svg className="month-cal-star" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8 1.5l1.95 3.95 4.36.64-3.15 3.07.74 4.34L8 11.45 4.1 13.5l.74-4.34L1.69 6.09l4.36-.64L8 1.5z"
        fill="currentColor"
      />
    </svg>
  );
}

export function MonthCalendar({
  year,
  month,
  days,
  activeDay,
  onSelectDay,
}: {
  year: string;
  month: string;
  days: readonly MonthCalendarDay[];
  activeDay?: string;
  onSelectDay: (event: MouseEvent<HTMLAnchorElement>, day: string) => void;
}) {
  const cells = buildMonthCalendarGrid(year, month, days);
  if (cells.length === 0) return null;

  const hasMilestones = days.some((d) => d.isMilestone);
  const monthNum = Number(month);

  return (
    <nav className="month-calendar" aria-label={`${year} 年 ${monthNum} 月日历`}>
      <div className="month-cal-head">
        <div className="month-cal-title-row">
          <span className="month-cal-kicker" aria-hidden="true">📅</span>
          <span className="month-cal-title">{monthNum} 月手账日历</span>
        </div>
        <div className="month-cal-legend" aria-hidden="true">
          {hasMilestones ? (
            <span className="month-cal-legend-item is-milestone">
              <CuteStarIcon />
              <span>闪光日</span>
            </span>
          ) : null}
          <span className="month-cal-legend-item">
            <span className="month-cal-dot" />
            <span>点日期直达</span>
          </span>
        </div>
      </div>

      <div className="month-cal-weekdays" aria-hidden="true">
        {WEEKDAYS.map((label, idx) => (
          <span key={label} className={idx >= 5 ? "month-cal-weekday is-weekend" : "month-cal-weekday"}>
            {label}
          </span>
        ))}
      </div>

      <div className="month-cal-grid">
        {cells.map((cell, idx) => {
          if (!cell) {
            return <div key={`empty-${idx}`} className="month-cal-cell is-empty" aria-hidden="true" />;
          }

          if (!cell.entry) {
            return (
              <div
                key={cell.day}
                className={cell.isWeekend ? "month-cal-cell is-blank is-weekend" : "month-cal-cell is-blank"}
                aria-hidden="true"
              >
                <span className="month-cal-num">{cell.dateNumber}</span>
              </div>
            );
          }

          const isActive = activeDay === cell.day;
          const classes = [
            "month-cal-cell",
            "is-recorded",
            cell.isWeekend ? "is-weekend" : "",
            cell.entry.thumbnail ? "has-thumb" : "is-text-day",
            cell.entry.isMilestone ? "is-milestone" : "",
            isActive ? "is-active" : "",
          ]
            .filter(Boolean)
            .join(" ");

          const ariaLabel = `${monthNum} 月 ${cell.dateNumber} 日${cell.entry.title ? `：${cell.entry.title}` : ""}`;

          return (
            <a
              key={cell.day}
              href={`#day-${cell.day}`}
              className={classes}
              aria-current={isActive ? "date" : undefined}
              aria-label={ariaLabel}
              title={cell.entry.title ? `${cell.dateNumber} 日 · ${cell.entry.title}` : `${monthNum} 月 ${cell.dateNumber} 日`}
              onClick={(event) => onSelectDay(event, cell.day)}
            >
              {cell.entry.thumbnail ? (
                <>
                  <CardThumbnail
                    thumbnail={cell.entry.thumbnail}
                    className="month-cal-thumb"
                    sizes="(max-width: 639px) 52px, 96px"
                  />
                  <span className="month-cal-scrim" aria-hidden="true" />
                </>
              ) : null}
              <span className="month-cal-cell-top">
                <span className="month-cal-num">{cell.dateNumber}</span>
                {cell.entry.isMilestone ? (
                  <CuteStarIcon />
                ) : (
                  <span className="month-cal-dot" aria-hidden="true" />
                )}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
