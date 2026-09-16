"use client";

import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HomeMemory as HomeMemoryData } from "@/lib/home-memory";
import { MEMORY_TIMING } from "@/lib/home-memory";
import { pickTrack } from "@/lib/home-memory-mood";

// 首页第一部分：**几段各有主题的回忆**，一次呈现一段，可以换。
//
// 主题有三种（lib/home-memory.ts）：某一天、一个主题（玩水 / 睡觉 / 笑……）、一个季节。
// 标题与副标题的粒度跟着主题走，所以这个组件不自己拼日期——它只画 `title` / `subtitle` /
// `linkLabel`，措辞全部由数据层给定。这一点是故意的：跨天的主题没有「当时几岁」可言，
// 硬拼一句就会在一整季上印一个具体日期。
//
// ─────────────────────────────────────────────────────────────────────────────
// 为什么是「一次一段 + 换一段」，而不是一排卡片
// ─────────────────────────────────────────────────────────────────────────────
//
// Apple 把回忆铺成一排可横滑的卡片，那是一个装着几千段回忆的相册应用的做法。这里是一个人的档案，
// 首页只回答「最近怎么样，张年」——一次摆三段封面，等于让家人先做选择题，照片也立刻从主角
// 变成缩略图（原则一、原则五）。所以一次一段，照片该多大还多大；想看别的，按「换一段」。
// 列表本身按主题轮流排（day / topic / season），所以按下去多半换到**另一种主题**，
// 而不是同一种主题的另一个日期。
//
// ─────────────────────────────────────────────────────────────────────────────
// 没有音轨的时候，什么都不要说
// ─────────────────────────────────────────────────────────────────────────────
//
// 配乐：Teddy 2026-09-16 深夜给了两首真实音轨，放在 public/audio/。点一次播放**随机挑一首**
// （pickTrack()，抽签发生在浏览器里，见 MemoryPlayer）。一首都没有时这个组件仍然
// **不挂 <audio>、不画静音键**——不是指向一个 404 让它静静失败，也不是留一个点了没反应的按钮。
export function HomeMemory({ memories }: { memories: HomeMemoryData[] }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playButton = useRef<HTMLButtonElement>(null);
  const memory = memories[Math.min(index, memories.length - 1)];
  if (!memory) return null;

  return <section className="home-memory" aria-label="最近的一段回忆">
    <MemoryPreview
      memory={memory}
      total={memories.length}
      onOpen={() => setPlaying(true)}
      onSwitch={() => setIndex((i) => (i + 1) % memories.length)}
      playRef={playButton}
    />
    {playing
      ? <MemoryPlayer memory={memory} onClose={() => setPlaying(false)} returnFocusTo={playButton} />
      : null}
  </section>;
}

function MemoryPreview({ memory, total, onOpen, onSwitch, playRef }: {
  memory: HomeMemoryData;
  total: number;
  onOpen: () => void;
  onSwitch: () => void;
  playRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const reduced = usePrefersReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(stage);
  const index = useSlideshow(memory.key, memory.slides.length, !reduced && onScreen, MEMORY_TIMING.slideSeconds * 1000);
  const current = memory.slides[index] ?? memory.slides[0];

  return <div className="memory-stage" ref={stage}>
    {/* 运镜时长必须跟着**同一个**常量走。app/home.css 里写的是
        `calc(var(--memory-slide-ms, 5000ms) + 900ms)`，那个 5000ms 兜底今天恰好等于
        SLIDE_SECONDS×1000——**是巧合，不是约束**。不把变量传下去的话，哪天改了 SLIDE_SECONDS，
        推拉时长和换片节奏会悄悄错开，而且看起来一切正常。 */}
    <div className="memory-frames" style={{ "--memory-slide-ms": `${MEMORY_TIMING.slideSeconds * 1000}ms` } as React.CSSProperties}>
      {memory.slides.map((slide, i) => (
        <Image
          key={slide.key}
          className={i === index ? "memory-frame is-current" : "memory-frame"}
          src={slide.media.src}
          alt={slide.media.alt}
          width={slide.media.width || 4}
          height={slide.media.height || 3}
          sizes="(max-width: 899px) 96vw, 620px"
          priority={i === 0}
          unoptimized
          aria-hidden={i !== index}
        />
      ))}
      <div className="memory-scrim" aria-hidden="true" />
      <button ref={playRef} type="button" className="memory-play" onClick={onOpen} aria-label="播放回忆">
        <PlayGlyph />
      </button>
      <p className="memory-caption-line">
        {memory.dateTime
          ? <time dateTime={memory.dateTime}>{memory.subtitle}</time>
          : <span>{memory.subtitle}</span>}
      </p>
      <h2 className="memory-title">{memory.title}</h2>
    </div>

    <div className="memory-dots" aria-hidden="true">
      {memory.slides.map((slide, i) => (
        <span key={slide.key} className={i === index ? "memory-dot is-on" : "memory-dot"} />
      ))}
    </div>

    <div className="memory-actions">
      {/* 标签跟着去处走：一天是「读读这一天」，一季是「翻到 2025 年」；
          主题横跨很多个月，没有对得上的单一去处，就什么都不画。 */}
      {memory.href && memory.linkLabel
        ? <Link className="memory-read" href={memory.href}>{memory.linkLabel} <span aria-hidden="true">↗</span></Link>
        : <span />}
      {/* 只有真的不止一段时才出现——一段时它点了也没有别的可换。 */}
      {total > 1
        ? <button type="button" className="memory-switch" onClick={onSwitch} aria-label="换一段回忆">
          换一段 <SwitchGlyph />
        </button>
        : null}
    </div>

    {/* 读屏：换段之后播报换到了哪一段。 */}
    <p className="visually-hidden" role="status">
      {memory.title}，{memory.subtitle}。这一段有 {memory.slides.length} 个瞬间。
      {current?.caption ? `其中记着：${current.caption}。` : ""}
    </p>
  </div>;
}

function MemoryPlayer({ memory, onClose, returnFocusTo }: {
  memory: HomeMemoryData;
  onClose: () => void;
  returnFocusTo: React.RefObject<HTMLButtonElement | null>;
}) {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [done, setDone] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const slide = memory.slides[index];
  const last = memory.slides.length - 1;
  // 随机挑一首。放在 useState 的初始化里有两个作用：**这个组件只在点了播放之后才创建**，
  // 所以抽签发生在浏览器里，不会有 hydration 不一致；而且一次播放全程同一首，
  // 不会因为任何一次重渲染半路换曲。
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

  // 音乐只在**有音轨**时启动，且一定发生在用户点击之后（这个组件就是点击才创建的）。
  useEffect(() => {
    const element = audio.current;
    if (!element || !track) return;
    element.volume = 0.55;
    void element.play().catch(() => { /* 系统静音等情况：没有声音也要能看照片 */ });
    return () => { element.pause(); };
  }, [track]);

  useEffect(() => {
    const onVisibility = () => { if (document.hidden) { audio.current?.pause(); setPaused(true); } };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (paused || done || reduced) return;
    if (index >= last) {
      const end = setTimeout(() => { setDone(true); audio.current?.pause(); }, MEMORY_TIMING.slideSeconds * 1000);
      return () => clearTimeout(end);
    }
    const next = setTimeout(() => setIndex((i) => i + 1), MEMORY_TIMING.slideSeconds * 1000);
    return () => clearTimeout(next);
  }, [index, paused, done, reduced, last]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeViaUI(); return; }
      if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
      if (event.key === " ") { event.preventDefault(); togglePause(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function togglePause() {
    setPaused((was) => {
      const now = !was;
      if (now) audio.current?.pause();
      else { setDone(false); void audio.current?.play().catch(() => {}); }
      return now;
    });
  }

  function step(delta: number) {
    setDone(false);
    setIndex((i) => Math.max(0, Math.min(last, i + delta)));
  }

  const titleId = `memory-player-${memory.key.replace(/[^a-zA-Z0-9]+/g, "-")}`;
  return createPortal(
    <div className="memory-player" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel} tabIndex={-1}>
      {track ? <audio ref={audio} src={track} loop muted={muted} preload="auto" /> : null}

      <header className="memory-player-head">
        <button type="button" className="memory-player-close" onClick={closeViaUI} aria-label="关闭，回到首页">✕</button>
        <div className="memory-player-heading">
          <h2 id={titleId}>{memory.title}</h2>
          <p>{memory.dateTime ? <time dateTime={memory.dateTime}>{memory.subtitle}</time> : memory.subtitle}</p>
        </div>
        {track
          ? <button
            type="button"
            className="memory-player-mute"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? `打开声音（${picked?.title ?? "配乐"}）` : `静音（${picked?.title ?? "配乐"}）`}
            aria-pressed={muted}
          >{muted ? <MutedGlyph /> : <SoundGlyph />}</button>
          // 没有音轨时留一个等宽空位，标题才不会从居中偏出去。
          : <span className="memory-player-spacer" aria-hidden="true" />}
      </header>

      <div className="memory-player-stage">
        {memory.slides.map((item, i) => (
          <Image
            key={item.key}
            className={i === index ? "memory-player-frame is-current" : "memory-player-frame"}
            src={item.media.src}
            alt={item.media.alt}
            width={item.media.width || 4}
            height={item.media.height || 3}
            sizes="100vw"
            priority={i === 0}
            unoptimized
            aria-hidden={i !== index}
          />
        ))}
        {slide?.caption ? <p className="memory-player-caption">{slide.caption}</p> : null}
      </div>

      <div className="memory-player-progress" aria-hidden="true">
        {memory.slides.map((item, i) => (
          <span key={item.key} className={i <= index ? "memory-bar is-on" : "memory-bar"} />
        ))}
      </div>

      <footer className="memory-player-controls">
        <button type="button" onClick={() => step(-1)} disabled={index === 0} aria-label="上一张"><PrevGlyph /></button>
        <button type="button" className="memory-player-toggle" onClick={togglePause} aria-label={paused || done ? "继续播放" : "暂停"}>
          {paused || done ? <PlayGlyph /> : <PauseGlyph />}
        </button>
        <button type="button" onClick={() => step(1)} disabled={index === last} aria-label="下一张"><NextGlyph /></button>
      </footer>

      <p className="visually-hidden" role="status">
        第 {index + 1} 张，共 {memory.slides.length} 张{slide?.caption ? `。${slide.caption}` : ""}
        {done ? "。这一段放完了。" : ""}
      </p>
    </div>,
    document.body,
  );
}

// ── 小工具 ────────────────────────────────────────────────────────────────────

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
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return onScreen;
}

/** 预览轮播。`resetKey` 变了（换了一段）就从第一张重新开始。 */
function useSlideshow(resetKey: string, count: number, running: boolean, intervalMs: number): number {
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [resetKey]);
  useEffect(() => {
    if (!running || count <= 1) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), intervalMs);
    return () => clearInterval(timer);
  }, [running, count, intervalMs, resetKey]);
  return Math.min(index, Math.max(0, count - 1));
}

// ── 图标 ──────────────────────────────────────────────────────────────────────

const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
);
const PauseGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h3.2v14H7zm6.8 0H17v14h-3.2z" fill="currentColor" /></svg>
);
const PrevGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15.5 5.5v13L6 12zM17 5h1.5v14H17z" fill="currentColor" /></svg>
);
const NextGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.5 5.5v13L18 12zM5.5 5H7v14H5.5z" fill="currentColor" /></svg>
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
/** 「换一段」的循环箭头。 */
const SwitchGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="15" height="15">
    <path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M17.5 3v3.6h-3.6M6.5 21v-3.6h3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
