"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { MonthCalendar, type MonthCalendarDay } from "@/components/month-calendar";
import { MonthDayEntry } from "@/components/month-day-entry";
import { resolveCardThumbnail } from "@/lib/day-photo-layout";
import type { TimelineDay, TimelineWeek } from "@/lib/month-timeline";

// Every week can be passed on the initial server render (`entries`, so native #week-N and #day-YYYY-MM-DD
// anchors work before hydration), while also preserving GET `/api/memory/<y>/<m>/timeline?week=...`
// lazy-loading whenever only partial/initial weeks are supplied (never POST Server Actions, since public
// Caddy blocks POST to page routes with 405).
export function MonthTimeline({
  year,
  month,
  monthAgeLabel,
  weeks,
  entries,
  initial,
  calendarDays,
}: {
  year: string;
  month?: string;
  monthAgeLabel?: string;
  weeks: TimelineWeek[];
  entries?: TimelineDay[][];
  initial?: TimelineDay[];
  calendarDays?: MonthCalendarDay[];
}) {
  const seedWeeks: (TimelineDay[] | undefined)[] = weeks.map((_, index) => {
    if (entries && entries[index] !== undefined) return entries[index];
    if (index === 0 && initial) return initial;
    return undefined;
  });

  const [weekData, setWeekData] = useState<(TimelineDay[] | undefined)[]>(seedWeeks);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [activeDay, setActiveDay] = useState<string | undefined>(weeks[0]?.days[0]);
  const [highlightedDay, setHighlightedDay] = useState<string | undefined>(undefined);
  const [showMobileFloat, setShowMobileFloat] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const inflightRef = useRef<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const topCalRef = useRef<HTMLElement | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasUnloadedWeeks = Boolean(month && weekData.some((items) => items === undefined));

  const fetchWeekByIndex = useCallback(async (index: number): Promise<boolean> => {
    const week = weeks[index];
    if (!week || !month) return false;
    if (inflightRef.current.has(week.id)) return false;
    inflightRef.current.add(week.id);
    setLoadingWeek(true);
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(year)}/${encodeURIComponent(month)}/timeline?week=${encodeURIComponent(week.id)}`, {
        method: "GET",
      });
      if (!res.ok) return false;
      const payload = (await res.json()) as { entries?: TimelineDay[] };
      if (!Array.isArray(payload.entries)) return false;
      setWeekData((prev) => {
        const next = [...prev];
        next[index] = payload.entries ?? [];
        return next;
      });
      return true;
    } catch {
      return false;
    } finally {
      inflightRef.current.delete(week.id);
      setLoadingWeek(inflightRef.current.size > 0);
    }
  }, [month, weeks, year]);

  const loadNextWeek = useCallback(async () => {
    const nextIndex = weekData.findIndex((items) => items === undefined);
    if (nextIndex >= 0) await fetchWeekByIndex(nextIndex);
  }, [fetchWeekByIndex, weekData]);

  const loadThroughIndex = useCallback(async (targetIndex: number) => {
    for (let i = 0; i <= targetIndex && i < weeks.length; i += 1) {
      if (weekData[i] === undefined) {
        await fetchWeekByIndex(i);
      }
    }
  }, [fetchWeekByIndex, weekData, weeks.length]);

  // Progressive IntersectionObserver lazy-loading when partial weeks are supplied
  useEffect(() => {
    if (!hasUnloadedWeeks || !sentinelRef.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) {
          void loadNextWeek();
        }
      },
      { rootMargin: "420px 0px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasUnloadedWeeks, loadNextWeek]);

  // Ensure direct #day-YYYY-MM-DD or #week-N hash navigation resolves even when lazy-loaded
  useEffect(() => {
    if (!hasUnloadedWeeks || typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    let targetIndex = -1;
    if (hash.startsWith("week-")) {
      targetIndex = weeks.findIndex((w) => w.id === hash);
    } else if (hash.startsWith("day-")) {
      const targetDay = hash.slice(4);
      targetIndex = weeks.findIndex((w) => w.days.includes(targetDay));
    }
    if (targetIndex >= 0 && weekData[targetIndex] === undefined) {
      void loadThroughIndex(targetIndex).then(() => {
        requestAnimationFrame(() => {
          document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    }
  }, [hasUnloadedWeeks, loadThroughIndex, weekData, weeks]);

  const flashDayTarget = useCallback((day: string) => {
    setActiveDay(day);
    setHighlightedDay(day);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedDay((prev) => (prev === day ? undefined : prev));
    }, 1800);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const scrollToDay = useCallback(
    (day: string) => {
      const target = document.getElementById(`day-${day}`);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      flashDayTarget(day);
    },
    [flashDayTarget],
  );

  // Active calendar day tracking on scroll
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const dayIds = weekData.flatMap((items) => (items ?? []).map((entry) => entry.day));
    const elements = dayIds
      .map((day) => document.getElementById(`day-${day}`))
      .filter((el): el is HTMLElement => Boolean(el));
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((r) => r.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const topId = visible[0]?.target.id;
        if (topId?.startsWith("day-")) {
          setActiveDay(topId.slice(4));
        }
      },
      { rootMargin: "-110px 0px -58% 0px", threshold: [0, 0.1] },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [weekData]);

  const resolvedMonth = month ?? weeks[0]?.days[0]?.slice(5, 7);
  const resolvedCalendarDays = useMemo<MonthCalendarDay[]>(() => {
    if (calendarDays && calendarDays.length > 0) return calendarDays;
    const byDay = new Map<string, MonthCalendarDay>();
    for (const items of weekData) {
      if (!items) continue;
      for (const entry of items) {
        byDay.set(entry.day, {
          day: entry.day,
          title: entry.title ?? entry.dateLabel,
          summary: entry.paragraphs[0],
          thumbnail: resolveCardThumbnail(entry.photos, entry.firstScreenMediaIds),
          hasPhotos: entry.photos.length > 0,
          isMilestone: Boolean(entry.milestone || entry.emphasis === "lead"),
          badge: entry.milestone?.badge,
        });
      }
    }
    return [...byDay.values()];
  }, [calendarDays, weekData]);

  const orderedDays = useMemo(() => {
    const fromWeeks = weeks.flatMap((w) => w.days);
    if (fromWeeks.length > 0) return fromWeeks;
    return resolvedCalendarDays.map((d) => d.day);
  }, [resolvedCalendarDays, weeks]);

  const currentDay = activeDay ?? orderedDays[0];
  const currentDayIndex = currentDay ? orderedDays.indexOf(currentDay) : -1;
  const prevDay = currentDayIndex > 0 ? orderedDays[currentDayIndex - 1] : undefined;
  const nextDay =
    currentDayIndex >= 0 && currentDayIndex < orderedDays.length - 1
      ? orderedDays[currentDayIndex + 1]
      : undefined;
  const currentDayLabel = currentDay
    ? `${Number(currentDay.slice(5, 7))}月${Number(currentDay.slice(8, 10))}日`
    : `${Number(resolvedMonth ?? 1)}月`;

  useEffect(() => {
    const el = topCalRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (records) => {
        const record = records[0];
        if (!record) return;
        const scrolledPast = !record.isIntersecting && record.boundingClientRect.bottom < 72;
        setShowMobileFloat(scrolledPast);
        if (!scrolledPast) setDrawerOpen(false);
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [resolvedCalendarDays.length]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const jumpToDay = useCallback(
    (day: string) => {
      const targetIndex = weeks.findIndex((w) => w.days.includes(day));
      if (targetIndex >= 0 && weekData[targetIndex] === undefined) {
        void loadThroughIndex(targetIndex).then(() => {
          requestAnimationFrame(() => scrollToDay(day));
        });
        return;
      }
      scrollToDay(day);
    },
    [loadThroughIndex, scrollToDay, weekData, weeks],
  );

  const handleSelectDay = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, day: string) => {
      event.preventDefault();
      jumpToDay(day);
    },
    [jumpToDay],
  );

  const hasCalendar = Boolean(resolvedMonth && resolvedCalendarDays.length > 0);

  return <>
    <div className={hasCalendar ? "month-timeline-shell has-calendar" : "month-timeline-shell"}>
      {hasCalendar && resolvedMonth ? (
        <aside className="month-calendar-rail" ref={topCalRef} aria-label="月份日历导航">
          <MonthCalendar
            year={year}
            month={resolvedMonth}
            days={resolvedCalendarDays}
            activeDay={activeDay}
            onSelectDay={handleSelectDay}
          />
        </aside>
      ) : null}
      <section className="month-days month-days--edited" aria-label="这个月">
        <ol>
          {weekData.flatMap((dayEntries) =>
            (dayEntries ?? []).map((entry) => (
              <li
                className={highlightedDay === entry.day ? "month-day is-calendar-target" : "month-day"}
                key={entry.day}
              >
                <MonthDayEntry entry={entry} year={year} monthAgeLabel={monthAgeLabel} />
              </li>
            )),
          )}
        </ol>
        {hasUnloadedWeeks ? <div className="month-timeline-sentinel" ref={sentinelRef}>
          <button
            type="button"
            className="month-timeline-more-btn"
            disabled={loadingWeek}
            onClick={() => { void loadNextWeek(); }}
          >
            {loadingWeek ? "正在翻开接下来的日子…" : "继续往下读这个月"}
          </button>
        </div> : null}
      </section>
    </div>

    {hasCalendar && resolvedMonth && showMobileFloat ? (
      <>
        {drawerOpen ? (
          <>
            <div
              className="month-cal-drawer-backdrop"
              aria-hidden="true"
              onClick={() => setDrawerOpen(false)}
            />
            <div
              id="month-cal-drawer"
              className="month-cal-drawer"
              role="dialog"
              aria-label="快速切换日期"
            >
              <MonthCalendar
                year={year}
                month={resolvedMonth}
                days={resolvedCalendarDays}
                activeDay={activeDay}
                onSelectDay={(event, day) => {
                  setDrawerOpen(false);
                  handleSelectDay(event, day);
                }}
              />
            </div>
          </>
        ) : null}
        <div className="month-cal-floatbar" role="region" aria-label="快速切日">
          <button
            type="button"
            className="month-cal-float-step"
            aria-label="上一天"
            disabled={!prevDay}
            onClick={() => {
              if (prevDay) {
                setDrawerOpen(false);
                jumpToDay(prevDay);
              }
            }}
          >
            ‹
          </button>
          <button
            type="button"
            className="month-cal-float-trigger"
            aria-expanded={drawerOpen}
            aria-controls="month-cal-drawer"
            onClick={() => setDrawerOpen((prev) => !prev)}
          >
            <span aria-hidden="true">📅</span>
            <span>{currentDayLabel}</span>
            <span className="month-cal-float-caret" aria-hidden="true">
              {drawerOpen ? "▴" : "▾"}
            </span>
          </button>
          <button
            type="button"
            className="month-cal-float-step"
            aria-label="下一天"
            disabled={!nextDay}
            onClick={() => {
              if (nextDay) {
                setDrawerOpen(false);
                jumpToDay(nextDay);
              }
            }}
          >
            ›
          </button>
        </div>
      </>
    ) : null}
  </>;
}
