"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { GalleryPhoto } from "@/components/photo-viewer";
import { titleEmphasis } from "@/lib/title-emphasis";

// 首页的主体：一张照片 + 它所属的那一段真实生活。2026-09-13 的新版首页只有这一组。
//
// 三件事是产品规则，不是排版口味：
//
//   照片和故事是一个东西。「换张照片」换的是 slide，不是图片地址：候选照片可能属于另一段
//   生活，那时标题、摘录、日期、当时年龄和「读读这一天」的去处必须一起换（共同规格 5.6）。
//   所以这个组件收的是一串 slide，每个 slide 自带它的故事，而不是「一段故事 + 一串图」。
//
//   一张都不裁。尺寸裁决（e66c4dd）：宽度优先、按原图比例自然高度——照片铺满右栏宽度，高度由
//   它自己决定，竖照就让页面往下长。
//
//   点照片 = 读这张照片所属的那一天（2026-09-14 用户：点开只是放大，读不到那一天）。去处就是
//   这个 slide 自己的 story.href：候选是逐 (eventId, mediaId) 获批的那一对，故事由那条绑定决定，
//   不按日期去找——同一天有几篇也不会点错。放大看全图仍然在故事页和月页的查看器里。
//
//   没有合格照片就只留文字。没有 photo 的 slide 渲染成纯文字的一段，不画空照片框、不借别的
//   故事的照片（共同规格 5.7）。
export type HomeLeadSlide = {
  // 同一 slide 的稳定标识（数据轨给的 mediaId 或 eventId），只用于 React key 与切换。
  key: string;
  story: HomeLeadStory;
  photo?: HomeLeadPhoto;
};

export type HomeLeadStory = {
  eventId: string;
  href: string;
  title: string;
  // 已审核的摘录原文；页面不生成、不改写，只负责把其中的引语标出来。
  excerpt?: string;
};

export type HomeLeadPhoto = {
  media: GalleryPhoto;
  // 照片自己的日期与当时年龄（原则二：每段过去内容带自己的两个时钟）。
  day: string;
  dayLabel: string;
  ageLabel?: string;
};

export type HomeRecentFact = {
  eventId: string;
  href: string;
  title: string;
  day: string;
  dayLabel: string;
  ageLabel?: string;
};

// 引语着色：只给内容里真的带「」的片段上色，不按关键词猜哪个词重要。
// 长度上限是实测出来的，不是拍脑袋：9 月 7 日那段的摘录里有一句 27 个字的转述引语，整句上色以后
// 半段摘录都是红的，重点等于没有重点，读起来也更费劲。颜色标的是「被原样说出来的那个词」，
// 不是一整段话；超过上限的引语保留原本的「」，颜色不动——括号本来就已经把它标出来了。
const QUOTE_ACCENT_MAX = 10;

// 主视觉不再按方向裁切：尺寸裁决（版式卡 e66c4dd）是**宽度优先、按原图比例自然高度**，
// 所以这里没有形状分支了——`<img>` 铺满右栏宽度，高度由它自己的比例决定，竖照就让页面往下长。

// 标题里的强调片段：哪几个字、哪一支颜色由 lib/title-emphasis.ts 的小词组规则给出（位置精确，
// 不会把 photo 里的 hot 也涂上）；这里只按位置切开标题。没有命中就是原样一段文字。
export function withEmphasis(text: string, keyPrefix: string) {
  const spans = titleEmphasis(text);
  if (spans.length === 0) return text;
  const parts: React.ReactNode[] = [];
  let at = 0;
  spans.forEach((span, index) => {
    if (span.start > at) parts.push(<span key={`${keyPrefix}-t${index}`}>{text.slice(at, span.start)}</span>);
    parts.push(<span className={`home-emphasis home-emphasis--${span.accent}`} key={`${keyPrefix}-e${index}`}>{span.text}</span>);
    at = span.end;
  });
  if (at < text.length) parts.push(<span key={`${keyPrefix}-tail`}>{text.slice(at)}</span>);
  return parts;
}

export function withQuotes(text: string, keyPrefix: string) {
  const parts = text.split(/(「[^」]*」|“[^”]*”)/g);
  return parts.filter((part) => part.length > 0).map((part, index) => {
    const quoted = (part.startsWith("「") && part.endsWith("」")) || (part.startsWith("“") && part.endsWith("”"));
    if (!quoted || part.length - 2 > QUOTE_ACCENT_MAX) return <span key={`${keyPrefix}-${index}`}>{part}</span>;
    // q 自带引号（CSS quotes），所以这里把原文的括号去掉，读起来还是同一句。
    return <q className="home-quote" key={`${keyPrefix}-${index}`}>{part.slice(1, -1)}</q>;
  });
}

export function HomeLead({ slides, clockLine, today, notes }: { slides: HomeLeadSlide[]; clockLine?: string; today: string; notes?: React.ReactNode }) {
  const [index, setIndex] = useState(0);
  if (slides.length === 0) return null;
  const slide = slides[Math.min(index, slides.length - 1)];
  const photo = slide.photo;

  // 2026-09-13 改版：照片是第一眼的东西，占右侧约三分之二；左边只留题签。
  // DOM 顺序就是手机上的阅读顺序（照片 → 日期 → 题签/入口 → 便签）；桌面靠 grid 把照片放到右栏。
  return <>
    {photo ? <figure className="home-figure">
      {/* 一个真正的链接：Enter 可达、中键/长按可在新标签打开、返回键回到首页。可读名称说清去处，
          不只是「照片」两个字——屏幕阅读器读到的是「读这张照片的那一天：<标题>」。 */}
      <Link className="home-photo" href={slide.story.href} aria-label={`读这张照片的那一天：${slide.story.title}`}>
        {/* unoptimized：这些派生图在入库时已经是定宽 webp，Next 的优化器只会重编码一遍，
            并且把缓存键和 /api/media 分开（components/photo.tsx 里同样的理由）。 */}
        <Image
          src={photo.media.src}
          alt={photo.media.alt}
          width={photo.media.width || 4}
          height={photo.media.height || 3}
          sizes="(max-width: 760px) 96vw, 816px"
          priority
          unoptimized
        />
      </Link>
      <figcaption className="home-caption">
        <span>
          <time dateTime={photo.day}>{photo.dayLabel}</time>
          {photo.ageLabel ? <span className="home-caption-age"> · 当时 {photo.ageLabel}</span> : null}
        </span>
        {slides.length > 1 ? <button
          className="home-swap"
          type="button"
          aria-label="换看另一张照片"
          onClick={() => setIndex((current) => (current + 1) % slides.length)}
        >换张照片 <span aria-hidden="true">↻</span></button> : null}
      </figcaption>
    </figure> : null}

    {/* 左栏是**一个** grid 单元。分成两个单元试过：右边那张 1088px 高的竖照跨两行时，会把
        题签那一行也撑开，便签被推到 y=682，「便签首屏可见」只剩半截（实测 1440×900）。
        便签由服务端组件渲染，作为 notes 传进来——它不需要变成客户端组件。 */}
    <div className="home-aside">
      <div className="home-headline">
        {/* 今天和今天几岁收成一行小字：这一页只留一个主标题，就是下面那句题签。 */}
        {clockLine ? <p className="home-today"><time dateTime={today}>{clockLine}</time></p> : null}
        {/* 题签 = 那段真实生活自己的标题，最多两行；这一版首页不再渲染正文摘录。 */}
        <h1 className="home-title">{withEmphasis(slide.story.title, `title-${slide.key}`)}</h1>
        <Link className="home-read" href={slide.story.href}>读读这一天 <span aria-hidden="true">↗</span></Link>
      </div>
      {notes}
    </div>
  </>;
}
