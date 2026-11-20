"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import type { PhotoDay } from "@/lib/memory-chapters";
import { fetchDayAlbum } from "@/lib/month-album-request";

const DayAlbumSheet = dynamic(
  () => import("./day-album-sheet").then((mod) => mod.DayAlbumSheet),
  { ssr: false },
);

// The way from a day's words into that day's photographs in the month's album
// (lib/publication-moments.ts dayAlbumFrom says what it may show and why).
//
// Reading position is the design constraint. A reader on a phone is somewhere in the middle of a
// 10,000px month; sending them down to 「这个月的照片」 — and making them expand it — cost a median
// 13,484px, and nothing brought them back. So the album opens OVER the page, at the date, and closing
// it (✕, 「回到日记」, Escape or the phone's back button) leaves the page exactly where it was, with
// focus returned to the button they pressed.
//
// Nothing is fetched until asked: the page ships only the button, and the album for that one day
// comes from the server when the reader opens it — the month page does not grow by the size of its
// album.
export function DayAlbumLink({ year, month, day, dateLabel, ageLabel, afterDayPhotos = false, quiet = false }: {
  year: string;
  month: string;
  day: string;
  dateLabel: string;
  ageLabel?: string;
  // The day already shows its reviewed photographs right above; the album holds the rest of the day.
  afterDayPhotos?: boolean;
  // 2026-09-16：月末相册里每一天都可能带一个入口（连拍折叠后 26/29 天都有）。描边胶囊重复
  // 二十几次就成了这一页最吵的东西，所以那个位置用安静的文字链，胶囊留给「一段故事之后」
  // 那种一页只出现几次的场合。行为、可达性、命中区域完全一样，只是不喊。
  quiet?: boolean;
}) {
  const [state, setState] = useState<"closed" | "loading" | "open" | "failed">("closed");
  const [album, setAlbum] = useState<PhotoDay | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const open = async () => {
    if (state === "loading") return;
    setState("loading");
    try {
      const found = album ?? await fetchDayAlbum(year, month, day);
      if (!found || found.photos.length === 0) { setState("failed"); return; }
      setAlbum(found);
      setState("open");
    } catch {
      setState("failed");
    }
  };
  // Focus goes back to the entry from the sheet's own cleanup, not from here: while the sheet is still
  // mounted the page behind it is inert, and focusing an inert button is silently ignored (measured on
  // cbfdb60: focus came back as null after Escape).
  const close = useCallback(() => setState("closed"), []);

  const label = afterDayPhotos ? "这一天相册里的其他照片" : "翻开这一天的相册";
  return <>
    <p className="day-album-entry">
      <button ref={trigger} type="button" className={quiet ? "day-album-open day-album-open--quiet" : "day-album-open"} onClick={open} aria-haspopup="dialog" aria-busy={state === "loading"} data-day={day}>
        {state === "loading" ? "正在打开相册…" : label}
      </button>
      {state === "failed" ? <span className="day-album-failed" role="status">相册暂时没有打开，稍后再试。</span> : null}
    </p>
    {state === "open" && album ? <DayAlbumSheet album={album} dateLabel={dateLabel} ageLabel={ageLabel} onClose={close} returnFocusTo={trigger} /> : null}
  </>;
}
