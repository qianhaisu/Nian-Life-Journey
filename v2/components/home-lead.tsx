"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useState } from "react";
import { ViewerModal, type GalleryPhoto } from "@/components/photo-viewer";

// 首页的主体：一张照片 + 它所属的那一段真实生活。2026-09-13 的新版首页只有这一组。
//
// 三件事是产品规则，不是排版口味：
//
//   照片和故事是一个东西。「换张照片」换的是 slide，不是图片地址：候选照片可能属于另一段
//   生活，那时标题、摘录、日期、当时年龄和「读读这一天」的去处必须一起换（共同规格 5.6）。
//   所以这个组件收的是一串 slide，每个 slide 自带它的故事，而不是「一段故事 + 一串图」。
//
//   一张都不裁。尺寸裁决（e66c4dd）：宽度优先、按原图比例自然高度——照片铺满右栏宽度，高度由
//   它自己决定，竖照就让页面往下长。点开走的仍是站点已有的查看器（components/photo-viewer.tsx
//   的 ViewerModal），reel + 双击放大 + 返回键关闭，和月页、详情页点开照片是同一件事。
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
  // 这一篇标题里要强调的 0–2 段真实文字；不给就是默认文字色。见 withEmphasis。
  emphasis?: HomeEmphasis[];
};

export type HomeLeadPhoto = {
  media: GalleryPhoto;
  // 照片自己的日期与当时年龄（原则二：每段过去内容带自己的两个时钟）。
  day: string;
  dayLabel: string;
  ageLabel?: string;
  // 同一事件里可一起翻看的照片，查看器按这串原比例展示；缺省只有它自己。
  siblings?: GalleryPhoto[];
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
// 设计稿里 cold / hot 之所以是两个颜色，是因为那天妈妈报的就是这两个词；换一段生活它可能
// 一个引语都没有，那就一个色块都不该出现（任务卡：强调语词由真实内容驱动）。
//
// 长度上限是实测出来的，不是拍脑袋：9 月 7 日那段的摘录里有一句 27 个字的转述引语，整句上色以后
// 半段摘录都是红的，重点等于没有重点，读起来也更费劲。颜色标的是「被原样说出来的那个词」，
// 不是一整段话；超过上限的引语保留原本的「」，颜色不动——括号本来就已经把它标出来了。
const QUOTE_ACCENT_MAX = 10;

// 主视觉不再按方向裁切：尺寸裁决（版式卡 e66c4dd）是**宽度优先、按原图比例自然高度**，
// 所以这里没有形状分支了——`<img>` 铺满右栏宽度，高度由它自己的比例决定，竖照就让页面往下长。
// 之前那个 shapeOf/frameRatio 已经删掉：留着一个不再被 CSS 使用的 data-shape，只会让下一个人
// 以为首页还在按方向裁图。

// 标题里的强调片段（2026-09-13，替掉更早那版按 cold/hot/冷/热 关键词自动匹配的做法）。
//
// 为什么换掉：关键词表是一张会自己长大的表。今天是冷热，明天就会有人往里加「第一次」「走路」，
// 于是每个标题都开始自动变色——那就是把每段生活套成同一个彩色模板，正是要避免的事。
//
// 现在的规矩：**一篇故事自己说要标哪里**。每个标题最多两段强调，片段必须是标题里**真有的**那几个字
// （对不上就什么都不做，不猜、不硬上色），颜色从站点已有的三支里挑：蓝、桃红、鼠尾草绿。
// 没有配置就是默认文字色——绝大多数标题都不配，页面上一个色块都不会多出来。
export type HomeEmphasisAccent = "blue" | "rose" | "sage";
export type HomeEmphasis = { text: string; accent: HomeEmphasisAccent };

// 最多两段。两段以上就不再是「强调」，而是把一句话涂成三种颜色。
const EMPHASIS_MAX = 2;

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function withEmphasis(text: string, spans: HomeEmphasis[] | undefined, keyPrefix: string) {
  // 只留下标题里真的能找到的片段；配错字、改了标题、片段为空，都退回纯文字。
  const usable = (spans ?? []).filter((span) => span.text.length > 0 && text.includes(span.text)).slice(0, EMPHASIS_MAX);
  if (usable.length === 0) return text;
  const accentOf = new Map(usable.map((span) => [span.text, span.accent]));
  const pattern = new RegExp(`(${usable.map((span) => escapeForRegExp(span.text)).join("|")})`, "g");
  return text.split(pattern).filter((part) => part.length > 0).map((part, index) => {
    const accent = accentOf.get(part);
    if (!accent) return <span key={`${keyPrefix}-${index}`}>{part}</span>;
    return <span className={`home-emphasis home-emphasis--${accent}`} key={`${keyPrefix}-${index}`}>{part}</span>;
  });
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
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const closeViewer = useCallback(() => setViewerAt(null), []);
  if (slides.length === 0) return null;
  const slide = slides[Math.min(index, slides.length - 1)];
  const photo = slide.photo;
  // 查看器里的这一串：同一事件的合格照片，当前这张排在它本来的位置上。
  const reel = photo ? (photo.siblings?.length ? photo.siblings : [photo.media]) : [];
  const reelIndex = photo ? Math.max(0, reel.findIndex((item) => item.id === photo.media.id)) : 0;

  // 2026-09-13 改版：照片是第一眼的东西，占右侧约三分之二；左边只留题签。
  // DOM 顺序就是手机上的阅读顺序（照片 → 日期 → 题签/入口 → 便签）；桌面靠 grid 把照片放到右栏。
  return <>
    {photo ? <figure className="home-figure">
      <button
        className="home-photo"
        type="button"
        aria-label="打开这一天的完整照片"
        onClick={() => setViewerAt(reelIndex)}
      >
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
      </button>
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
        <h1 className="home-title">{withEmphasis(slide.story.title, slide.story.emphasis, `title-${slide.key}`)}</h1>
        <Link className="home-read" href={slide.story.href}>读读这一天 <span aria-hidden="true">↗</span></Link>
      </div>
      {notes}
    </div>

    {viewerAt !== null && reel.length > 0 ? <ViewerModal
      photos={reel}
      startIndex={viewerAt}
      dateLabel={photo?.dayLabel ?? ""}
      ageLabel={photo?.ageLabel ? `当时 ${photo.ageLabel}` : undefined}
      onClose={closeViewer}
    /> : null}
  </>;
}
