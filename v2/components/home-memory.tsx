"use client";

import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HomeMemory as HomeMemoryData } from "@/lib/home-memory";
import { MEMORY_TIMING } from "@/lib/home-memory";
import { MOOD_LABEL, type MemoryMood } from "@/lib/home-memory-mood";

// 首页第一部分：一段回忆。静音预览在首页，点圆形播放键进入沉浸播放并开始音乐。
//
// ─────────────────────────────────────────────────────────────────────────────
// 音乐只能由用户手势启动，这不是选择，是浏览器规则也是产品规则
// ─────────────────────────────────────────────────────────────────────────────
//
// 首页那一层**永远静音**，`<audio>` 根本不挂载。只有点了播放键（一次真实的用户手势）
// 才创建音频并 play()。关闭播放器、切到后台、离开这一段，音乐立刻停。
// 自动播放的声音在一个家庭档案里是冒犯，浏览器也会拦——两个理由指向同一个实现。
//
// ─────────────────────────────────────────────────────────────────────────────
// 播放入口只有图标（用户 2026-09-16 第 2 条）
// ─────────────────────────────────────────────────────────────────────────────
//
// 设计稿里那个「配乐播放」四个字删掉了，只留一个圆形播放三角，像 iPhone 相册回忆。
// 但**可访问性一个字都不能少**：按钮有 `aria-label="播放回忆"`，命中区域 56px（>44），
// 键盘可达、焦点环走站点全局那一支。图标本身 `aria-hidden`，读屏读到的是那句 label。
export function HomeMemory({ memory, mood }: { memory: HomeMemoryData; mood: MemoryMood }) {
  const [playing, setPlaying] = useState(false);
  const playButton = useRef<HTMLButtonElement>(null);

  return <section className="home-memory" aria-label="最近的一段回忆">
    <MemoryPreview memory={memory} onOpen={() => setPlaying(true)} playRef={playButton} />
    {playing
      ? <MemoryPlayer
        memory={memory}
        mood={mood}
        onClose={() => setPlaying(false)}
        returnFocusTo={playButton}
      />
      : null}
  </section>;
}

/** 首页上的静音预览：照片自己慢慢换，一个播放键压在上面。 */
function MemoryPreview({ memory, onOpen, playRef }: {
  memory: HomeMemoryData;
  onOpen: () => void;
  playRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const reduced = usePrefersReducedMotion();
  const visible = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(visible);
  // 减少动态时不自动轮播：留在第一张，家人自己点播放键才动
  // （任务书：「尊重 prefers-reduced-motion」「系统要求减少动态时使用静态或手动切换」）。
  const index = useSlideshow(memory.slides.length, !reduced && onScreen, MEMORY_TIMING.slideSeconds * 1000);
  const current = memory.slides[index] ?? memory.slides[0];

  return <div className="memory-stage" ref={visible}>
    <div className="memory-frames">
      {memory.slides.map((slide, i) => (
        <Image
          key={slide.key}
          className={i === index ? "memory-frame is-current" : "memory-frame"}
          src={slide.media.src}
          alt={slide.media.alt}
          width={slide.media.width || 4}
          height={slide.media.height || 3}
          sizes="(max-width: 899px) 96vw, 820px"
          priority={i === 0}
          unoptimized
          // 只有当前这张参与无障碍树，其余是纯装饰的下层图；否则读屏会读出十几张同样的 alt。
          aria-hidden={i !== index}
        />
      ))}
      <div className="memory-scrim" aria-hidden="true" />
      <button
        ref={playRef}
        type="button"
        className="memory-play"
        onClick={onOpen}
        aria-label="播放回忆"
      >
        <PlayGlyph />
      </button>
      <p className="memory-caption-line">
        <time dateTime={memory.day}>{memory.dateLabel}</time>
        {memory.ageLabel ? <span> · 当时 {memory.ageLabel}</span> : null}
      </p>
      <h2 className="memory-title">{memory.title}</h2>
    </div>
    {/* 进度点：说明这一段有几张，也让家人知道预览在动。不写数字（原则三）。 */}
    <div className="memory-dots" aria-hidden="true">
      {memory.slides.map((slide, i) => (
        <span key={slide.key} className={i === index ? "memory-dot is-on" : "memory-dot"} />
      ))}
    </div>
    <p className="memory-read">
      <Link href={memory.href}>读读这一天 <span aria-hidden="true">↗</span></Link>
    </p>
    {/* 预览是纯视觉的，读屏用户直接给一句话 + 一个真链接，不用听十二张照片。 */}
    <p className="visually-hidden">
      这一段回忆来自 {memory.dateLabel}{memory.ageLabel ? `，当时 ${memory.ageLabel}` : ""}，共 {memory.slides.length} 个瞬间。
      {current?.caption ? `其中记着：${current.caption}。` : ""}
    </p>
  </div>;
}

/**
 * 沉浸播放。
 *
 * 行为上的几条硬要求（任务书四）：可暂停、可静音、可前后查看、可退出；退出后回到首页原滚动位置
 * 并把焦点还给播放键；播放完自然停住，**不自动切到另一段**；离屏/后台停掉。
 */
function MemoryPlayer({ memory, mood, onClose, returnFocusTo }: {
  memory: HomeMemoryData;
  mood: MemoryMood;
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

  // 退出：走 history.back()，这样手机返回键和界面上的 ✕ 是同一条路（和 day-album 一致）。
  const closeViaUI = useCallback(() => history.back(), []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    history.pushState({ nianMemoryPlayer: memory.day }, "");
    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);
    // 播放时页面其余部分 inert：键盘和读屏留在播放器里，退出后恢复。
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
      // 焦点回到播放键；首页的滚动位置从来没动过（我们只锁了 overflow，没有改 scrollTop）。
      focusBack?.focus({ preventScroll: true });
    };
  }, [memory.day, onClose, returnFocusTo]);

  // 音乐：挂载时启动一次。这一步一定发生在用户点击之后（组件就是点击才创建的），
  // 所以不会被浏览器的自动播放策略拦下。
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.volume = 0.55;
    // play() 返回 Promise，被拒绝是正常情况（比如系统静音），不该把播放器打掉。
    void element.play().catch(() => { /* 没有声音也要能看照片 */ });
    return () => { element.pause(); };
  }, []);

  // 后台标签页不放音、不走时间轴（任务书：「页面进入后台、播放器离屏时停止不必要的播放」）。
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

  // 时间轴。走到最后一张就停住，`done` 为真——不循环，也不换下一段。
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
      if (event.key === "Escape") { event.preventDefault(); closeViaUI(); return; }
      if (event.key === "ArrowRight") { event.preventDefault(); setIndex((i) => Math.min(last, i + 1)); }
      if (event.key === "ArrowLeft") { event.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
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

  const titleId = `memory-player-${memory.day}`;
  return createPortal(
    <div
      className="memory-player"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={panel}
      tabIndex={-1}
    >
      {/* 曲子由 lib/home-memory-mood.ts 按这一天的照片节奏与已发布标题选出；自制原创，见 scripts/build-memory-music.mjs。 */}
      <audio ref={audio} src={`/audio/memory-${mood}.mp3`} loop muted={muted} preload="auto" />

      <header className="memory-player-head">
        <button type="button" className="memory-player-close" onClick={closeViaUI} aria-label="关闭，回到首页">✕</button>
        <div className="memory-player-heading">
          <h2 id={titleId}>{memory.title}</h2>
          <p><time dateTime={memory.day}>{memory.dateLabel}</time>{memory.ageLabel ? <span> · 当时 {memory.ageLabel}</span> : null}</p>
        </div>
        <button
          type="button"
          className="memory-player-mute"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? `打开声音（${MOOD_LABEL[mood]}）` : `静音（${MOOD_LABEL[mood]}）`}
          aria-pressed={muted}
        >
          {muted ? <MutedGlyph /> : <SoundGlyph />}
        </button>
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
        {/* 配文：只在少数几张上出现，原文来自这一天已发布记忆的标题（lib/home-memory.ts）。 */}
        {slide?.caption ? <p className="memory-player-caption">{slide.caption}</p> : null}
      </div>

      <div className="memory-player-progress" aria-hidden="true">
        {memory.slides.map((item, i) => (
          <span key={item.key} className={i <= index ? "memory-bar is-on" : "memory-bar"} />
        ))}
      </div>

      <footer className="memory-player-controls">
        <button type="button" onClick={() => step(-1)} disabled={index === 0} aria-label="上一张">
          <PrevGlyph />
        </button>
        <button type="button" className="memory-player-toggle" onClick={togglePause} aria-label={paused || done ? "继续播放" : "暂停"}>
          {paused || done ? <PlayGlyph /> : <PauseGlyph />}
        </button>
        <button type="button" onClick={() => step(1)} disabled={index === last} aria-label="下一张">
          <NextGlyph />
        </button>
      </footer>

      {/* 读屏的状态播报：第几张、这一张有没有配文。视觉上不出现。 */}
      <p className="visually-hidden" role="status">
        第 {index + 1} 张，共 {memory.slides.length} 张{slide?.caption ? `。${slide.caption}` : ""}
        {done ? "。这一段放完了。" : ""}
      </p>
    </div>,
    document.body,
  );
}

// ── 小工具 ────────────────────────────────────────────────────────────────────

/** 系统「减少动态」。用 matchMedia 实时跟随，不是只在挂载时读一次。 */
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

/** 这一块在不在视口里。离屏就别让预览空转（任务书：「离屏或后台暂停」）。 */
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

/** 预览的轮播。`running` 为假时停在原地，不推进。 */
function useSlideshow(count: number, running: boolean, intervalMs: number): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!running || count <= 1) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), intervalMs);
    return () => clearInterval(timer);
  }, [running, count, intervalMs]);
  return Math.min(index, Math.max(0, count - 1));
}

// ── 图标 ──────────────────────────────────────────────────────────────────────
// 全部 currentColor 的内联 SVG，`aria-hidden`：名字由按钮的 aria-label 给，
// 图标本身不该被读出来（ui-ux-pro-max 的 icons 那条）。

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
