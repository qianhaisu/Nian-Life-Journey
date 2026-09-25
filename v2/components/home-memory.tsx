"use client";

import { mediaDeliveryUrl } from "@/lib/media/paths";
import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HomeMemory as HomeMemoryData } from "@/lib/home-memory";
import { MEMORY_TIMING } from "@/lib/home-memory";
import { pickTrack } from "@/lib/home-memory-mood";
import { Button } from "@/components/ui/button";

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
  // 从封面那一张起步（不是第 0 张）。关掉动效时轮播不跑，停在封面上——这正是想要的。
  const index = useSlideshow(
    memory.key, memory.slides.length, !reduced && onScreen,
    MEMORY_TIMING.slideSeconds * 1000, memory.coverIndex,
  );
  const current = memory.slides[index] ?? memory.slides[0];

  return <div className="memory-stage" ref={stage}>
    {/* 运镜时长必须跟着**同一个**常量走。app/home.css 里写的是
        `calc(var(--memory-slide-ms, 5000ms) + 900ms)`，那个 5000ms 兜底今天恰好等于
        SLIDE_SECONDS×1000——**是巧合，不是约束**。不把变量传下去的话，哪天改了 SLIDE_SECONDS，
        推拉时长和换片节奏会悄悄错开，而且看起来一切正常。 */}
    <div className="memory-frames" style={{ "--memory-slide-ms": `${MEMORY_TIMING.slideSeconds * 1000}ms` } as React.CSSProperties}>
      {/* 虚化底（Teddy 2026-09-25：「运镜效果现在不是填充的，有边框不好看」）。照片本身仍然完整显示、不裁脸
          （90230d6 的初衷），画框里照片没盖到的那一点，用同一张照片放大虚化垫满——看起来是满的，没有边框。
          用缩略图就够了：反正要糊掉，省流量。 */}
      {memory.slides.map((slide, i) => (
        isNear(i, index, memory.slides.length)
          // eslint-disable-next-line @next/next/no-img-element
          ? <img key={`bg-${slide.key}`} className={i === index ? "memory-backdrop is-current" : "memory-backdrop"}
            src={slide.media.thumbnailSrc ?? mediaDeliveryUrl(slide.media.id, "thumbnail")} alt="" aria-hidden="true" />
          : null
      ))}
      {memory.slides.map((slide, i) => (
        // 只挂当前与前后各一张，见 isNear——全挂会让 12 张一起抢连接。
        isNear(i, index, memory.slides.length) ? <Image
          key={slide.key}
          className={i === index ? "memory-frame is-current" : "memory-frame"}
          // 第几张决定用哪一种运镜（app/home.css 的 [data-fx]）。写成属性而不是靠 nth-child：
          // 运镜是「第几张」的属性，不是 DOM 位置的属性。
          data-fx={i % 4}
          src={slide.media.src}
          alt={slide.media.alt}
          width={slide.media.width || 4}
          height={slide.media.height || 3}
          sizes="(max-width: 899px) 96vw, 620px"
          // 优先加载的是**封面**那一张，不是第 0 张——否则抢着下载的是一张没人看到的图。
          priority={i === memory.coverIndex}
          unoptimized
          aria-hidden={i !== index}
        /> : null
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

    <div className="memory-actions">
      {/* 标签跟着去处走：一天是「读读这一天」，一季是「翻到 2025 年」；
          主题横跨很多个月，没有对得上的单一去处，就什么都不画。 */}
      {memory.href && memory.linkLabel
        ? <Link className="memory-read" href={memory.href}>{memory.linkLabel} <span aria-hidden="true">↗</span></Link>
        : <span />}
      {/* 只有真的不止一段时才出现——一段时它点了也没有别的可换。 */}
      {total > 1
        ? <Button type="button" variant="outline" className="memory-switch" onClick={onSwitch} aria-label="换一段回忆">
          换一段 <SwitchGlyph />
        </Button>
        : null}
    </div>

    {/* 读屏：换段之后播报换到了哪一段。 */}
    <p className="visually-hidden" role="status">
      {memory.title}，{memory.subtitle}。这一段有 {memory.slides.length} 个瞬间。
      {current?.caption ? `其中记着：${current.caption}。` : ""}
    </p>
  </div>;
}

/**
 * 这一张/这一幕要不要现在就挂到 DOM 上（当前、前一个、后一个，首尾相接）。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 这不是性能优化，是在修一个"点开播放先黑屏 15 秒"的 bug
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 之前把一段回忆的 12 张全部挂上去，每一张都是 `position:absolute; inset:0`——
 * 于是**每一张都在视口里**，`opacity:0` 一点都挡不住下载，浏览器一口气发 12 个请求，
 * 去抢同源那 6 条连接。第一幕因此排在第十幕后面。
 *
 * 2026-09-17 线上实测（.data/home0917-firstpaint.mjs）：
 *   第一幕单张的那一段  ->    89ms 就能看见
 *   第一幕两张的那一段  -> 15278ms 才能看见（点开之后整整十五秒是黑的）
 *
 * 只挂前后各一个之后，同时在飞的请求从 12 降到 2–6，第一幕拿得到连接；
 * 下一幕提前一轮挂上，5 秒的停留足够它加载完，翻页时不会白。
 */
const isNear = (i: number, index: number, total: number) =>
  Math.abs(i - index) <= 1
  || (index === 0 && i === total - 1)
  || (index === total - 1 && i === 0);

/** 一幕 = 一屏里同时出现的照片。多数时候一张，横照会 2–3 张叠在一起。 */
type MemoryScene = { key: string; items: HomeMemoryData["slides"] };

/**
 * 按**画幅**把照片分成幕（Teddy 2026-09-17 第 7 条：「有的时候会有三张图片从上到下布满一屏，
 * 有的是一张……结合图片比例」）。
 *
 * 规则只有一条，而且是画幅逼出来的，不是为了花样：
 *   · 竖照 / 方照 —— 自己占满一屏。把竖照压成三分之一屏，人就被切成一条。
 *   · 横照       —— 连着的 2–3 张上下叠起来占一屏。一张横照独占竖屏时左右必然裁掉一大半，
 *                   叠起来反而每张都能看全。
 *
 * **不为了凑版式打乱照片顺序**：落单的横照就自己占一屏。时间顺序比版式整齐重要——
 * 这是一段回忆，不是一个图库。
 */
function buildScenes(slides: HomeMemoryData["slides"]): MemoryScene[] {
  const scenes: MemoryScene[] = [];
  let run: HomeMemoryData["slides"] = [];

  const flushRun = () => {
    while (run.length > 0) {
      // 3 张一幕最好看；正好剩 4 张时切成 2+2，免得最后一张落单自己占一屏。
      const take = run.length === 4 ? 2 : Math.min(3, run.length);
      const group = run.slice(0, take);
      scenes.push({ key: group.map((item) => item.key).join("+"), items: group });
      run = run.slice(take);
    }
  };

  for (const slide of slides) {
    const width = slide.media.width ?? 0;
    const height = slide.media.height ?? 0;
    // 1.2 而不是 1.0：接近正方的照片叠起来两头都难看，按竖照处理让它独占一屏。
    const landscape = width > 0 && height > 0 && width / height >= 1.2;
    if (landscape) { run.push(slide); continue; }
    flushRun();
    scenes.push({ key: slide.key, items: [slide] });
  }
  flushRun();
  return pairSomePortraits(scenes);
}

/**
 * 每隔几幕把相邻两张竖照并成一幕。
 *
 * 为什么需要这一步：**这份档案约 85% 是竖照**，只按「连着的横照才叠」来分，
 * 2026-09-17 线上实测 85 幕里只有 1 幕是多图——等于没有版式变化，
 * 而 Teddy 要的正是「有的是一张，有的是三张……多加点变化」。
 *
 * 所以竖照默认仍然独占一屏（那是它最好看的样子），但每隔 3 幕凑一对，
 * 让一段回忆里有节奏地出现两三次"一屏两张"。规则是确定的，不随机——
 * 同一段回忆每次打开的版式一样，不会这次一张下次两张。
 *
 * 最后一幕不参与配对：一段回忆用单张收尾，比用一对收尾干净。
 */
function pairSomePortraits(scenes: MemoryScene[]): MemoryScene[] {
  const out: MemoryScene[] = [];
  let sinceMulti = 0;
  for (let i = 0; i < scenes.length; i += 1) {
    const here = scenes[i];
    const next = scenes[i + 1];
    const canPair = here.items.length === 1
      && next !== undefined && next.items.length === 1
      && sinceMulti >= 3
      && i + 1 < scenes.length - 1; // 留最后一幕单独收尾
    if (canPair) {
      out.push({ key: `${here.key}+${next.key}`, items: [...here.items, ...next.items] });
      sinceMulti = 0;
      i += 1; // next 已经并进来了
      continue;
    }
    out.push(here);
    sinceMulti = here.items.length > 1 ? 0 : sinceMulti + 1;
  }
  return out;
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
  // 按画幅分幕：一屏有时一张，有时叠 2–3 张（见 buildScenes）。
  // useMemo 是必须的，不是优化：不缓存的话每次暂停、静音、换曲都会重新分一次版式。
  const scenes = useMemo(() => buildScenes(memory.slides), [memory.slides]);
  const scene = scenes[index];
  const last = scenes.length - 1;
  // 一幕里只要有一张带配文就显示那一句——配文仍然只可能是已发布标题原文。
  const caption = scene?.items.find((item) => item.caption)?.caption;
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

      {/* 运镜时长必须跟着同一个常量走，和预览一样——播放器之前整个漏了运镜
          （Teddy 2026-09-17 第 3 条），补上的时候这个变量也要一起传，
          否则 CSS 里那个 5000ms 兜底会和真实换片节奏悄悄错开。 */}
      <div className="memory-player-stage" style={{ "--memory-slide-ms": `${MEMORY_TIMING.slideSeconds * 1000}ms` } as React.CSSProperties}>
        {scenes.map((item, i) => (
          <div
            key={item.key}
            className={i === index ? "memory-player-scene is-current" : "memory-player-scene"}
            aria-hidden={i !== index}
          >
            {/* 幕的外壳一直在（版式要它），但**照片只在临近时才挂**：
                这就是那个「点开先黑屏 15 秒」的修法，见 isNear。 */}
            {item.items.map((entry, j) => (
              <div key={entry.key} className="memory-player-slot">
                {isNear(i, index, scenes.length) ? <Image
                  className={i === index ? "memory-player-frame is-current" : "memory-player-frame"}
                  data-fx={(i + j) % 4}
                  src={entry.media.src}
                  alt={entry.media.alt}
                  // fill 而不是 width/height：2026-09-17 线上截图看到播放器上下有大块留白——
                  // 这两张照片本身没有问题，问题是 Next.js <Image> 不用 fill 时会按 width/height
                  // 的原始长宽比给 <img> 算一个"内在框"，这个框不一定等于它外层 div 的实际大小
                  // （尤其这里外层大小是 flex 算出来的、不是固定长宽比），于是我写的
                  // position:absolute;inset:0 是相对那个内在框摆的，不是相对外层 div——
                  // 图片因此偏出了外层的左上角，看起来像"图缩小了、周围露出了底色"。
                  // fill 会让 Next.js 自己把 <img> 设成 position:absolute;inset:0;width:100%;height:100%，
                  // 这正是我原本想要的效果，不用再猜内在框怎么算的。
                  fill
                  sizes="100vw"
                  priority={i === 0}
                  unoptimized
                /> : null}
              </div>
            ))}
          </div>
        ))}
        {caption ? <p className="memory-player-caption">{caption}</p> : null}
      </div>
      {/* 底部进度条已去掉（Teddy 2026-09-17 第 3 条：「播放时底部也不要显示进度条」，
          参照的是 iPhone 相册回忆——那里播放时也没有这一排。换到第几张仍然读屏可读，
          见下面 visually-hidden 那句「第 N 幕，共 N 幕」。 */}

      <footer className="memory-player-controls">
        <button type="button" onClick={() => step(-1)} disabled={index === 0} aria-label="上一张"><PrevGlyph /></button>
        <button type="button" className="memory-player-toggle" onClick={togglePause} aria-label={paused || done ? "继续播放" : "暂停"}>
          {paused || done ? <PlayGlyph /> : <PauseGlyph />}
        </button>
        <button type="button" onClick={() => step(1)} disabled={index === last} aria-label="下一张"><NextGlyph /></button>
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

/**
 * 预览轮播。`resetKey` 变了（换了一段）就回到**封面那一张**重新开始。
 *
 * 起点是 `startAt` 而不是 0：幻灯片按时间排，所以第 0 张永远是最早的一张，
 * 而预览不动时家人看到的就是它。2026-09-17 线上「睡着的样子」的封面因此是出生当天
 * 医院小床里的新生儿——副标题跨到 2026 年 9 月，第一眼却还是最小的时候。
 * 封面改取价值分最高的那一张（lib/home-memory.ts 的 coverIndexOf），播放顺序不变。
 */
function useSlideshow(resetKey: string, count: number, running: boolean, intervalMs: number, startAt = 0): number {
  const [index, setIndex] = useState(startAt);
  useEffect(() => { setIndex(startAt); }, [resetKey, startAt]);
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
