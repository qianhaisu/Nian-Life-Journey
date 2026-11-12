"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MonthDayEntry } from "@/components/month-day-entry";
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
  highlights = [],
}: {
  year: string;
  month?: string;
  monthAgeLabel?: string;
  weeks: TimelineWeek[];
  entries?: TimelineDay[][];
  initial?: TimelineDay[];
  highlights?: { day: string; title: string }[];
}) {
  const seedWeeks: (TimelineDay[] | undefined)[] = weeks.map((_, index) => {
    if (entries && entries[index] !== undefined) return entries[index];
    if (index === 0 && initial) return initial;
    return undefined;
  });

  const [weekData, setWeekData] = useState<(TimelineDay[] | undefined)[]>(seedWeeks);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [activeWeekId, setActiveWeekId] = useState<string | undefined>(weeks[0]?.id);
  const inflightRef = useRef<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement | null>(null);

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

  // Active segmented week pill tracking on scroll
  useEffect(() => {
    if (weeks.length <= 1 || typeof IntersectionObserver === "undefined") return;
    const elements = weeks
      .map((w) => document.getElementById(w.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((r) => r.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) {
          setActiveWeekId(visible[0].target.id);
        }
      },
      { rootMargin: "-140px 0px -55% 0px", threshold: [0, 0.1] },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [weeks, weekData]);

  return <>
    {highlights.length > 0 ? <nav className="month-highlights" aria-label="这个月值得再读的日子">
      <p className="section-mark">值得再读</p>
      <div className="month-highlights-chips">
        {highlights.map((item) => <a
          key={item.day}
          href={`#day-${item.day}`}
          onClick={(event) => {
            const idx = weeks.findIndex((w) => w.days.includes(item.day));
            if (idx >= 0 && weekData[idx] === undefined) {
              event.preventDefault();
              void loadThroughIndex(idx).then(() => {
                requestAnimationFrame(() => {
                  document.getElementById(`day-${item.day}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              });
            }
          }}
        >{Number(item.day.slice(8))} 日 · {item.title}</a>)}
      </div>
    </nav> : null}
    {weeks.length > 1 ? <nav className="month-jump" aria-label="跳到这个月的某一周">
      {weeks.map((week, index) => {
        const isActive = activeWeekId === week.id;
        return <a
          key={week.id}
          href={`#${week.id}`}
          className={isActive ? "is-active" : undefined}
          aria-current={isActive ? "location" : undefined}
          onClick={(event) => {
            setActiveWeekId(week.id);
            if (weekData[index] === undefined) {
              event.preventDefault();
              void loadThroughIndex(index).then(() => {
                requestAnimationFrame(() => {
                  document.getElementById(week.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              });
            }
          }}
        >{week.label}</a>;
      })}
    </nav> : null}
    <section className="month-days month-days--edited" aria-label="这个月">
      {weeks.map((week, index) => {
        const dayEntries = weekData[index];
        if (!dayEntries) return null;
        return <div className="month-week" id={week.id} key={week.id}>
          {weeks.length > 1 ? <p className="week-mark">{week.label}</p> : null}
          <ol>
            {dayEntries.map((entry) => <li className="month-day" key={entry.day}>
              <MonthDayEntry entry={entry} year={year} monthAgeLabel={monthAgeLabel} />
            </li>)}
          </ol>
        </div>;
      })}
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
  </>;
}
