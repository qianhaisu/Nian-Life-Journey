"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mediaDeliveryUrl } from "@/lib/media/paths";
import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import type { HomeMemory as HomeMemoryData } from "@/lib/home-memory";
import { MEMORY_TIMING } from "@/lib/home-memory";
import { pickTrack } from "@/lib/home-memory-mood";

// 首页 Bento 主视觉卡（Tile 1）：**几段各有主题的回忆**，一次呈现一段，可切换、可全屏沉浸播放。
//
// 100% 保留原有行为契约：
//   · Ken Burns 运镜轮播（isNear 控制并发请求数，避免多图抢连接黑屏）
//   · 点击卡片或右下播放键进入 createPortal 全屏剧场（支持配乐随机抽签、静音、键盘方向键/空格/Esc、浏览器返回键关闭与焦点归还）
//   · 「换一段」按 天 / 主题 / 季节 轮流切换
//   · 双时钟（原则二）：跨月主题回忆自动补齐首尾日历年月，保证每一帧都同时交代日历时间与当时年龄

function formatYearMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  if (Number.isNaN(y) || Number.isNaN(m)) return ym;
  return `${y} 年 ${m} 月`;
}

function ensureDualClockSubtitle(memory: HomeMemoryData): string {
  if (/\d{4}\s*年/.test(memory.subtitle)) return memory.subtitle;
  const months = memory.slides
    .map((s) => (s.day ?? s.media.takenAt ?? "").slice(0, 7))
    .filter((ym) => /^\d{4}-\d{2}$/.test(ym))
    .sort();
  if (months.length === 0) return memory.subtitle;
  const first = months[0];
  const last = months[months.length - 1];
  const span =
    first === last
      ? formatYearMonth(first)
      : first.slice(0, 4) === last.slice(0, 4)
        ? `${formatYearMonth(first)} — ${Number(last.slice(5, 7))} 月`
        : `${formatYearMonth(first)} — ${formatYearMonth(last)}`;
  return memory.subtitle ? `${span} · ${memory.subtitle}` : span;
}

export function HomeMemory({
  memories,
  ariaLabel = "最近的一段回忆",
  closeLabel = "关闭，回到首页",
}: {
  memories: HomeMemoryData[];
  ariaLabel?: string;
  closeLabel?: string;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playButton = useRef<HTMLButtonElement>(null);
  const memory = memories[Math.min(index, memories.length - 1)];
  if (!memory) return null;

  return (
    <section className="home-memory tile-lead-photo" aria-label={ariaLabel}>
      <MemoryPreview
        memory={memory}
        total={memories.length}
        onOpen={() => setPlaying(true)}
        onSwitch={() => setIndex((i) => (i + 1) % memories.length)}
        playRef={playButton}
      />
      {playing ? (
        <MemoryPlayer
          memory={memory}
          onClose={() => setPlaying(false)}
          returnFocusTo={playButton}
          closeLabel={closeLabel}
        />
      ) : null}
    </section>
  );
}

function MemoryPreview({
  memory,
  total,
  onOpen,
  onSwitch,
  playRef,
}: {
  memory: HomeMemoryData;
  total: number;
  onOpen: () => void;
  onSwitch: () => void;
  playRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const reduced = usePrefersReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(stage);
  const index = useSlideshow(
    memory.key,
    memory.slides.length,
    !reduced && onScreen,
    MEMORY_TIMING.slideSeconds * 1000,
    memory.coverIndex,
  );
  const current = memory.slides[index] ?? memory.slides[0];
  const subtitle = useMemo(() => ensureDualClockSubtitle(memory), [memory]);

  const isTripReel = memory.key.startsWith("trip:");
  const showSlideProvenance = memory.kind !== "day" && !isTripReel && Boolean(current?.day && current?.dateLabel);
  const readHref = showSlideProvenance ? (current?.href ?? memory.href) : (memory.href ?? current?.href);
  const readLabel = showSlideProvenance
    ? (current?.href && current.linkLabel ? current.linkLabel : memory.linkLabel)
    : memory.linkLabel
      ? memory.linkLabel
      : current?.href && current.linkLabel
        ? `${current.dateLabel ? `${current.dateLabel.replace(/^\d{4}\s*年\s*/, "")} · ` : ""}${current.linkLabel}`
        : undefined;

  return (
    <div className="memory-stage" ref={stage}>
      <div
        className="memory-frames"
        style={{ "--memory-slide-ms": `${MEMORY_TIMING.slideSeconds * 1000}ms` } as React.CSSProperties}
        onClick={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest("a, button")) return;
          onOpen();
        }}
      >
        {memory.slides.map((slide, i) =>
          isNear(i, index, memory.slides.length) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`bg-${slide.key}`}
              className={i === index ? "memory-backdrop is-current" : "memory-backdrop"}
              src={slide.media.thumbnailSrc ?? mediaDeliveryUrl(slide.media.id, "thumbnail")}
              alt=""
              aria-hidden="true"
            />
          ) : null,
        )}
        {memory.slides.map((slide, i) =>
          isNear(i, index, memory.slides.length) ? (
            <Image
              key={slide.key}
              className={i === index ? "memory-frame is-current" : "memory-frame"}
              data-fx={i % 4}
              src={slide.media.src || mediaDeliveryUrl(slide.media.id, "web")}
              alt={slide.media.alt}
              width={slide.media.width || 4}
              height={slide.media.height || 3}
              sizes="(max-width: 899px) 96vw, 580px"
              priority={i === memory.coverIndex}
              unoptimized
              aria-hidden={i !== index}
            />
          ) : null,
        )}

        <div className="memory-scrim" aria-hidden="true" />

        <div className="memory-top-bar">
          <p className="memory-caption-line">
            {memory.dateTime ? <time dateTime={memory.dateTime}>{subtitle}</time> : <span>{subtitle}</span>}
          </p>
          {total > 1 ? (
            <button
              type="button"
              className="memory-switch"
              onClick={(e) => {
                e.stopPropagation();
                onSwitch();
              }}
              aria-label="换一段回忆"
            >
              <span>换一段</span>
              <SwitchGlyph />
            </button>
          ) : null}
        </div>

        <div className="memory-colophon">
          <div className="memory-colophon-copy">
            <h2 className="memory-title">{memory.title}</h2>
            {memory.kind !== "day" && current?.caption && current.caption !== memory.title ? (
              <p className="memory-slide-note">{current.caption}</p>
            ) : null}
            {showSlideProvenance && current?.day ? (
              <p className="memory-slide-meta">
                <time dateTime={current.day}>{current.dateLabel}</time>
                {current.ageLabel ? (
                  <span>
                    {" · "}
                    {current.ageLabel === "出生的那天" ? "出生那天" : `当时 ${current.ageLabel}`}
                  </span>
                ) : null}
              </p>
            ) : null}
            {readHref && readLabel ? (
              <div className="memory-actions">
                <Link
                  className="memory-read"
                  href={readHref}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span>{readLabel}</span>
                  <span aria-hidden="true">↗</span>
                </Link>
              </div>
            ) : null}
          </div>
          <button
            ref={playRef}
            type="button"
            className="memory-play"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            aria-label="播放回忆"
          >
            <PlayGlyph />
          </button>
        </div>
      </div>

      <p className="visually-hidden" role="status">
        {memory.title}，{subtitle}。
        {current?.caption ? `画面里记着：${current.caption}。` : ""}
      </p>
    </div>
  );
}

const isNear = (i: number, index: number, total: number) =>
  Math.abs(i - index) <= 1 ||
  (index === 0 && i === total - 1) ||
  (index === total - 1 && i === 0);

type MemoryScene = { key: string; items: HomeMemoryData["slides"] };

function buildScenes(slides: HomeMemoryData["slides"]): MemoryScene[] {
  const scenes: MemoryScene[] = [];
  let run: HomeMemoryData["slides"] = [];

  const flushRun = () => {
    while (run.length > 0) {
      const take = run.length === 4 ? 2 : Math.min(3, run.length);
      const group = run.slice(0, take);
      scenes.push({ key: group.map((item) => item.key).join("+"), items: group });
      run = run.slice(take);
    }
  };

  for (const slide of slides) {
    const width = slide.media.width ?? 0;
    const height = slide.media.height ?? 0;
    const landscape = width > 0 && height > 0 && width / height >= 1.2;
    if (landscape) {
      run.push(slide);
      continue;
    }
    flushRun();
    scenes.push({ key: slide.key, items: [slide] });
  }
  flushRun();
  return pairSomePortraits(scenes);
}

function pairSomePortraits(scenes: MemoryScene[]): MemoryScene[] {
  const out: MemoryScene[] = [];
  let sinceMulti = 0;
  for (let i = 0; i < scenes.length; i += 1) {
    const here = scenes[i];
    const next = scenes[i + 1];
    const canPair =
      here.items.length === 1 &&
      next !== undefined &&
      next.items.length === 1 &&
      sinceMulti >= 3 &&
      i + 1 < scenes.length - 1;
    if (canPair) {
      out.push({ key: `${here.key}+${next.key}`, items: [...here.items, ...next.items] });
      sinceMulti = 0;
      i += 1;
      continue;
    }
    out.push(here);
    sinceMulti = here.items.length > 1 ? 0 : sinceMulti + 1;
  }
  return out;
}

function MemoryPlayer({
  memory,
  onClose,
  returnFocusTo,
  closeLabel,
}: {
  memory: HomeMemoryData;
  onClose: () => void;
  returnFocusTo: React.RefObject<HTMLButtonElement | null>;
  closeLabel: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [done, setDone] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const scenes = useMemo(() => buildScenes(memory.slides), [memory.slides]);
  const subtitle = useMemo(() => ensureDualClockSubtitle(memory), [memory]);
  const scene = scenes[index];
  const last = scenes.length - 1;
  const caption = scene?.items.find((item) => item.caption)?.caption;
  const [picked] = useState(pickTrack);
  const track = picked?.src;

  const closeViaUI = useCallback(() => history.back(), []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    history.pushState({ nianMemoryPlayer: memory.key }, "");
    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);
    const sheet = panel.current;
    const madeInert: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === sheet || child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      madeInert.push(child);
    }
    sheet?.focus({ preventScroll: true });
    const focusBack = returnFocusTo.current;
    return () => {
      for (const child of madeInert) child.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("popstate", onPop);
      focusBack?.focus({ preventScroll: true });
    };
  }, [memory.key, onClose, returnFocusTo]);

  useEffect(() => {
    const element = audio.current;
    if (!element || !track) return;
    element.volume = 0.55;
    void element.play().catch(() => {});
    return () => {
      element.pause();
    };
  }, [track]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        audio.current?.pause();
        setPaused(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (paused || done || reduced) return;
    if (index >= last) {
      const end = setTimeout(() => {
        setDone(true);
        audio.current?.pause();
      }, MEMORY_TIMING.slideSeconds * 1000);
      return () => clearTimeout(end);
    }
    const next = setTimeout(() => setIndex((i) => i + 1), MEMORY_TIMING.slideSeconds * 1000);
    return () => clearTimeout(next);
  }, [index, paused, done, reduced, last]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeViaUI();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      }
      if (event.key === " ") {
        event.preventDefault();
        togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function togglePause() {
    setPaused((was) => {
      const now = !was;
      if (now) audio.current?.pause();
      else {
        setDone(false);
        void audio.current?.play().catch(() => {});
      }
      return now;
    });
  }

  function step(delta: number) {
    setDone(false);
    setIndex((i) => Math.max(0, Math.min(last, i + delta)));
  }

  const titleId = `memory-player-${memory.key.replace(/[^a-zA-Z0-9]+/g, "-")}`;
  return createPortal(
    <div
      className="memory-player"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={panel}
      tabIndex={-1}
    >
      {track ? <audio ref={audio} src={track} loop muted={muted} preload="auto" /> : null}

      <header className="memory-player-head">
        <button type="button" className="memory-player-close" onClick={closeViaUI} aria-label={closeLabel}>
          ✕
        </button>
        <div className="memory-player-heading">
          <h2 id={titleId}>{memory.title}</h2>
          <p>{memory.dateTime ? <time dateTime={memory.dateTime}>{subtitle}</time> : subtitle}</p>
        </div>
        {track ? (
          <button
            type="button"
            className="memory-player-mute"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? `打开声音（${picked?.title ?? "配乐"}）` : `静音（${picked?.title ?? "配乐"}）`}
            aria-pressed={muted}
          >
            {muted ? <MutedGlyph /> : <SoundGlyph />}
          </button>
        ) : (
          <span className="memory-player-spacer" aria-hidden="true" />
        )}
      </header>

      <div
        className="memory-player-stage"
        style={{ "--memory-slide-ms": `${MEMORY_TIMING.slideSeconds * 1000}ms` } as React.CSSProperties}
      >
        {scenes.map((item, i) => (
          <div
            key={item.key}
            className={i === index ? "memory-player-scene is-current" : "memory-player-scene"}
            aria-hidden={i !== index}
          >
            {item.items.map((entry, j) => (
              <div key={entry.key} className="memory-player-slot">
                {isNear(i, index, scenes.length) ? (
                  <Image
                    className={i === index ? "memory-player-frame is-current" : "memory-player-frame"}
                    data-fx={(i + j) % 4}
                    src={entry.media.src || mediaDeliveryUrl(entry.media.id, "web")}
                    alt={entry.media.alt}
                    fill
                    sizes="100vw"
                    priority={i === 0}
                    unoptimized
                  />
                ) : null}
                {i === index && entry.day ? (
                  <p className="memory-scene-reading">
                    {entry.caption ? <span className="memory-scene-title">{entry.caption}</span> : null}
                    <time dateTime={entry.day}>{entry.dateLabel}</time>
                    {entry.ageLabel ? (
                      <span>
                        {" · "}
                        {entry.ageLabel === "出生的那天" ? "出生那天" : `当时 ${entry.ageLabel}`}
                      </span>
                    ) : null}
                    {entry.href ? <a href={entry.href}>{entry.linkLabel} ↗</a> : null}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ))}
        {caption && !scene?.items.some((item) => item.day) ? (
          <p className="memory-player-caption">{caption}</p>
        ) : null}
      </div>

      <footer className="memory-player-controls">
        <button type="button" onClick={() => step(-1)} disabled={index === 0} aria-label="上一张">
          <PrevGlyph />
        </button>
        <button
          type="button"
          className="memory-player-toggle"
          onClick={togglePause}
          aria-label={paused || done ? "继续播放" : "暂停"}
        >
          {paused || done ? <PlayGlyph /> : <PauseGlyph />}
        </button>
        <button type="button" onClick={() => step(1)} disabled={index === last} aria-label="下一张">
          <NextGlyph />
        </button>
      </footer>

      <p className="visually-hidden" role="status">
        第 {index + 1} 幕，共 {scenes.length} 幕
        {scene && scene.items.length > 1 ? `，这一幕有 ${scene.items.length} 张照片` : ""}
        {caption ? `。${caption}` : ""}
        {done ? "。这一段放完了。" : ""}
      </p>
    </div>,
    document.body,
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function useOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), {
      threshold: 0.25,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return onScreen;
}

function useSlideshow(
  resetKey: string,
  count: number,
  running: boolean,
  intervalMs: number,
  startAt = 0,
): number {
  const [index, setIndex] = useState(startAt);
  useEffect(() => {
    setIndex(startAt);
  }, [resetKey, startAt]);
  useEffect(() => {
    if (!running || count <= 1) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), intervalMs);
    return () => clearInterval(timer);
  }, [running, count, intervalMs, resetKey]);
  return Math.min(index, Math.max(0, count - 1));
}

const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
  </svg>
);
const PauseGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 5h3.2v14H7zm6.8 0H17v14h-3.2z" fill="currentColor" />
  </svg>
);
const PrevGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15.5 5.5v13L6 12zM17 5h1.5v14H17z" fill="currentColor" />
  </svg>
);
const NextGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M8.5 5.5v13L18 12zM5.5 5H7v14H5.5z" fill="currentColor" />
  </svg>
);
const SoundGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 9.5h3.2L11 6v12l-3.8-3.5H4z" fill="currentColor" />
    <path d="M14.5 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const MutedGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 9.5h3.2L11 6v12l-3.8-3.5H4z" fill="currentColor" />
    <path d="M14.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const SwitchGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="15" height="15">
    <path
      d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M17.5 3v3.6h-3.6M6.5 21v-3.6h3.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
