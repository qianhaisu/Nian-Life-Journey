"use client";

import { useState } from "react";
import { PhotoGallery } from "@/components/photo-viewer";
import { getFullArchiveDays } from "@/app/memory/[year]/[month]/actions";
import type { PhotoDay } from "@/lib/memory-chapters";

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

// Replaces the static "还有 N 天、M 张照片" text at the bottom of the archive section with an
// expandable list. On first expand it calls the server action; subsequent expands use cached data.
export function ArchiveExpander({
  year,
  month,
  foldedDayCount,
  foldedPhotoCount,
  visibleDayKeys,
  monthAgeLabel,
}: {
  year: string;
  month: string;
  foldedDayCount: number;
  foldedPhotoCount: number;
  visibleDayKeys: string[];
  monthAgeLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "open">("idle");
  const [hiddenDays, setHiddenDays] = useState<PhotoDay[]>([]);

  if (foldedDayCount === 0) return null;

  const handleExpand = async () => {
    if (state === "open") return;
    if (hiddenDays.length > 0) { setState("open"); return; }
    setState("loading");
    try {
      const allDays = await getFullArchiveDays(year, month);
      const visible = new Set(visibleDayKeys);
      setHiddenDays(allDays.filter((d) => !visible.has(d.day)));
      setState("open");
    } catch {
      setState("idle");
    }
  };

  return (
    <>
      {state !== "open" ? (
        <p className="chapter-meta archive-expand">
          <button className="text-link" onClick={handleExpand} disabled={state === "loading"} aria-busy={state === "loading"}>
            {state === "loading" ? "加载中…" : `还有 ${foldedDayCount} 天、${foldedPhotoCount} 张照片——点此展开全部`}
          </button>
        </p>
      ) : null}
      {state === "open" && hiddenDays.length > 0 ? (
        <ol className="archive-expanded">
          {hiddenDays.map((day) => (
            <li className="month-day" key={day.day}>
              <DayHead day={day.day} dateLabel={day.dateLabel} ageLabel={day.ageLabel} monthAgeLabel={monthAgeLabel} year={year} />
              <PhotoGallery photos={day.photos} dateLabel={day.dateLabel} ageLabel={day.ageLabel} stripSizes="(max-width: 700px) 30vw, 200px" />
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}
