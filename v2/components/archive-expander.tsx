"use client";

import { useState } from "react";
import { PhotoGallery } from "@/components/photo-viewer";
import { DayAlbumLink } from "@/components/day-album";
import { burstLeads } from "@/lib/publication-moments";
import type { PhotoDay } from "@/lib/memory-chapters";
import { fetchFullArchiveDays } from "@/lib/month-album-request";

// Mirrors DayHead from month-moment.tsx without importing the server-component file.
function DayHead({ day, dateLabel, ageLabel, monthAgeLabel, year }: { day: string; dateLabel: string; ageLabel?: string; monthAgeLabel?: string; year: string }) {
  const label = dateLabel.replace(`${year} 年 `, "");
  const showAge = ageLabel && ageLabel !== monthAgeLabel;
  return (
    <p className="month-day-date">
      <time dateTime={day}>{label}</time>
      {showAge ? <span>{ageLabel}</span> : null}
    </p>
  );
}

/**
 * The month's photographed days, in the order the month happened.
 *
 * The section has to choose what to put on the first screen, and it chooses by recency and by which
 * days already carry words (lib/publication-moments.ts) — so the visible set is a SELECTION, not a
 * prefix. Rendering the rest after it meant the album ran 12 日, 15 日, 18 日, 21 日 and then
 * doubled back to 2 日: measured on a fixture of eight photographed days, and the same shape as
 * 2026-09 on the running site. A month read out of order is not an album, it is a query result.
 *
 * So expanding merges rather than appends. The same day arriving from both sides keeps the copy the
 * page already rendered.
 */
export function orderedArchiveDays(visible: readonly PhotoDay[], hidden: readonly PhotoDay[]): PhotoDay[] {
  const byDay = new Map<string, PhotoDay>();
  for (const day of [...hidden, ...visible]) byDay.set(day.day, day);
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// The archive section's list of photographed days, plus the control that fetches the days the first
// render left out. On first expand it reads the month album (GET); subsequent expands use cached data.
export function ArchiveExpander({
  year,
  month,
  foldedDayCount,
  visibleDays,
  monthAgeLabel,
}: {
  year: string;
  month: string;
  foldedDayCount: number;
  // Still passed by the page; no longer printed (原则三, 2026-09-13: the button said 「还有 28 天、521 张
  // 照片」 — the archive describing its own size to the family).
  foldedPhotoCount?: number;
  visibleDays: PhotoDay[];
  monthAgeLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "open">("idle");
  const [hiddenDays, setHiddenDays] = useState<PhotoDay[]>([]);

  const handleExpand = async () => {
    if (state === "open") return;
    if (hiddenDays.length > 0) { setState("open"); return; }
    setState("loading");
    try {
      const allDays = await fetchFullArchiveDays(year, month);
      const visible = new Set(visibleDays.map((day) => day.day));
      setHiddenDays(allDays.filter((d) => !visible.has(d.day)));
      setState("open");
    } catch {
      setState("idle");
    }
  };

  const days = state === "open" ? orderedArchiveDays(visibleDays, hiddenDays) : visibleDays;

  return (
    <>
      <ol className={state === "open" ? "archive-expanded" : undefined}>
        {days.map((day) => {
          // 2026-09-16（原则五）：一天里连着按的快门只铺一张，其余收进这一天自己的相册。
          // 实测 2026-07 的相册 75% 是连拍冗余，2026-08 是 68%——铺开来读的是同一个瞬间的第
          // 二、第三次快门，不是这个月的日子。折叠不丢东西：archiveDays 未变，接口仍然给整天，
          // 下面那个「翻开这一天的相册」就是这一天的完整入口，点开即是全部。
          const lead = burstLeads(day.photos);
          const folded = day.photos.length - lead.length;
          return (
            <li className="month-day" key={day.day}>
              <DayHead day={day.day} dateLabel={day.dateLabel} ageLabel={day.ageLabel} monthAgeLabel={monthAgeLabel} year={year} />
              <PhotoGallery photos={lead} dateLabel={day.dateLabel} ageLabel={day.ageLabel} stripSizes="(max-width: 700px) 30vw, 200px" />
              {folded > 0 ? <DayAlbumLink year={year} month={month} day={day.day} dateLabel={day.dateLabel} ageLabel={day.ageLabel} afterDayPhotos quiet /> : null}
            </li>
          );
        })}
      </ol>
      {foldedDayCount > 0 && state !== "open" ? (
        <p className="chapter-meta archive-expand">
          <button className="text-link" onClick={handleExpand} disabled={state === "loading"} aria-busy={state === "loading"}>
            {state === "loading" ? "加载中…" : "展开这个月其余的照片"}
          </button>
        </p>
      ) : null}
    </>
  );
}
