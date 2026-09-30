"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MonthDayEntry } from "@/components/month-day-entry";
import type { TimelineDay, TimelineWeek } from "@/lib/month-timeline";

// The month's one timeline, a week at a time (2026-09-23, Teddy: 「首屏只加载一周，点"更多"再继续加载」).
//
// The server renders the first week (the newest for the current month, 1–7 for any older one) and
// hands over the month's outline: which weeks exist, in reading order. 「更多」 fetches the next week
// from the timeline route, and so on to the month's end. Weeks load in order and are shown in order —
// the timeline never has a hole in it. The week tabs at the top load every week up to the one tapped
// before jumping, for the same reason.
//
// Why a GET route and not a server action: nianlife.cn forwards only GET/HEAD (Caddyfile.ecs), so a
// server action's POST is refused before it reaches the app — the album expander hit exactly this
// (lib/month-album-request.ts).
export function MonthTimeline({ year, month, monthAgeLabel, weeks, initial, highlights = [] }: {
  year: string;
  month: string;
  monthAgeLabel?: string;
  weeks: TimelineWeek[];
  highlights?: { day: string; title: string }[];
  /** The first week's days, rendered on the server. */
  initial: TimelineDay[];
}) {
  const [loaded, setLoaded] = useState<TimelineDay[][]>(() => [initial]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const inFlight = useRef(false);

  // Load weeks until `targetIndex` is on the page. Returns when it is (or when a read failed).
  const loadThrough = useCallback(async (targetIndex: number) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    const got: TimelineDay[][] = [];
    try {
      for (let index = loaded.length; index <= targetIndex && index < weeks.length; index += 1) {
        const response = await fetch(`/api/memory/${year}/${month}/timeline?week=${encodeURIComponent(weeks[index].id)}`, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`timeline read failed: ${response.status}`);
        got.push(((await response.json()) as { entries: TimelineDay[] }).entries ?? []);
      }
    } catch {
      setFailed(true);
    } finally {
      if (got.length) setLoaded((current) => [...current, ...got]);
      inFlight.current = false;
      setBusy(false);
    }
  }, [loaded.length, month, weeks, year]);

  // A tab jump waits for the week to be on the page, then scrolls to it — instantly: a smooth scroll
  // across three freshly loaded weeks takes long enough to be interrupted by the reader's next touch.
  useEffect(() => {
    if (!scrollTo) return;
    const index = weeks.findIndex((week) => week.id === scrollTo || week.days.some((day) => `day-${day}` === scrollTo));
    if (index < loaded.length) {
      document.getElementById(scrollTo)?.scrollIntoView({ block: "start" });
      setScrollTo(null);
    }
  }, [loaded.length, scrollTo, weeks]);

  // Arriving with #week-3 in the address works the same as tapping its tab.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    const index = weeks.findIndex((week) => week.id === id || week.days.some((day) => `day-${day}` === id));
    if (index >= 0) { setScrollTo(id); void loadThrough(index); }
    // Only on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const next = weeks[loaded.length];

  return <>
    {highlights.length > 0 ? <nav className="month-highlights" aria-label="这个月值得再读的日子">
      <p className="section-mark">值得再读</p>
      {highlights.map((item) => <a key={item.day} href={`#day-${item.day}`} onClick={(event) => {
        event.preventDefault();
        const id = `day-${item.day}`;
        history.replaceState(null, "", `#${id}`);
        setScrollTo(id);
        const index = weeks.findIndex((week) => week.days.includes(item.day));
        if (index >= loaded.length) void loadThrough(index);
      }}>{Number(item.day.slice(8))} 日 · {item.title}</a>)}
    </nav> : null}
    {/* Only when the month really is more than one week: no control for a month of a few days. */}
    {weeks.length > 1 ? <nav className="month-jump" aria-label="跳到这个月的某一周">
      {weeks.map((week, index) => <a
        key={week.id}
        href={`#${week.id}`}
        onClick={(event) => {
          event.preventDefault();
          history.replaceState(null, "", `#${week.id}`);
          setScrollTo(week.id);
          if (index >= loaded.length) void loadThrough(index);
        }}
      >{week.label}</a>)}
    </nav> : null}

    <section className="month-days month-days--edited" aria-label="这个月">
      {loaded.map((entries, index) => {
        const week = weeks[index];
        return <div className="month-week" id={week.id} key={week.id}>
          {weeks.length > 1 ? <p className="week-mark">{week.label}</p> : null}
          <ol>
            {entries.map((entry) => <li className="month-day" key={entry.day}>
              <MonthDayEntry entry={entry} year={year} monthAgeLabel={monthAgeLabel} />
            </li>)}
          </ol>
        </div>;
      })}
      {next ? <p className="chapter-meta month-more">
        <button className="text-link" onClick={() => void loadThrough(loaded.length)} disabled={busy} aria-busy={busy}>
          {busy ? "加载中…" : failed ? `没加载出来，再试一次 · ${next.label}` : `更多 · ${next.label}`}
        </button>
      </p> : null}
    </section>
  </>;
}
