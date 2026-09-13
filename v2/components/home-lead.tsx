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
//   框里是裁切，点开是原比例。封面是固定比例的圆角框，照片 object-fit: cover 填满它；点开走
//   的是站点已有的查看器（components/photo-viewer.tsx 的 ViewerModal），reel + 双击放大 +
//   返回键关闭，和月页、详情页里点开照片是同一件事，不是首页自己造的第二个查看器。
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

// 封面框的比例跟着照片自己的方向走。
//
// 定稿里那张是竖幅，框是 1 : 1.08；照同一个框去裁横幅，会从两边各切掉四分之一——2026-08-19
// 那张「小年也扎了个小辫子」实测就是这样，人整个被推到框的左边。框跟着方向变，圆角、阴影、
// object-fit: cover 都不变，动作和主体留在框里（任务卡：照片主体与动作保留）。
// 尺寸缺失时按定稿的竖幅走，因为手机照片绝大多数是竖的。
function frameRatio(media: { width?: number; height?: number }): string {
  const { width, height } = media;
  if (!width || !height) return "1 / 1.08";
  if (width > height * 1.05) return "4 / 3";
  if (height > width * 1.05) return "1 / 1.08";
  return "1 / 1";
}

// 冷和热是两个颜色，不是同一个红。定稿里标题上的 cold 是蓝色、hot 是桃红——那天妈妈报的就是
// 这两个词，颜色跟着词义走（Teddy 2026-09-13 指出两个词不能都用同一个红）。
//
// 只认真实内容里出现的这几个字。一段没有冷热的生活，标题上一个色块都不会多出来——这不是把每段
// 故事都套成 cold/hot 的彩色模板，而且颜色之外词本身还在，不靠颜色表达意思。
const ACCENT_PATTERN = /(cold|冷|凉|hot|热|烫)/gi;
const COLD_WORD = /^(cold|冷|凉)$/i;
const HOT_WORD = /^(hot|热|烫)$/i;

export function withAccents(text: string, keyPrefix: string) {
  return text.split(ACCENT_PATTERN).filter((part) => part.length > 0).map((part, index) => {
    const accent = COLD_WORD.test(part) ? "home-accent-cold" : HOT_WORD.test(part) ? "home-accent-hot" : undefined;
    if (!accent) return <span key={`${keyPrefix}-${index}`}>{part}</span>;
    return <span className={accent} key={`${keyPrefix}-${index}`}>{part}</span>;
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

export function HomeLead({ slides, recent }: { slides: HomeLeadSlide[]; recent?: HomeRecentFact }) {
  const [index, setIndex] = useState(0);
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const closeViewer = useCallback(() => setViewerAt(null), []);
  if (slides.length === 0) return null;
  const slide = slides[Math.min(index, slides.length - 1)];
  const photo = slide.photo;
  // 查看器里的这一串：同一事件的合格照片，当前这张排在它本来的位置上。
  const reel = photo ? (photo.siblings?.length ? photo.siblings : [photo.media]) : [];
  const reelIndex = photo ? Math.max(0, reel.findIndex((item) => item.id === photo.media.id)) : 0;

  return <section className="home-hero" aria-label="最近的一段生活">
    {photo ? <figure className="home-figure">
      <button
        className="home-photo"
        type="button"
        aria-label="打开这一天的完整照片"
        style={{ aspectRatio: frameRatio(photo.media) }}
        onClick={() => setViewerAt(reelIndex)}
      >
        {/* unoptimized：这些派生图在入库时已经是定宽 webp，Next 的优化器只会重编码一遍，
            并且把缓存键和 /api/media 分开（components/photo.tsx 里同样的理由）。 */}
        <Image
          src={photo.media.src}
          alt={photo.media.alt}
          width={photo.media.width || 4}
          height={photo.media.height || 3}
          sizes="(max-width: 710px) 92vw, 444px"
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

    <div className="home-story">
      <p className="home-label"><span className="home-dot" aria-hidden="true" />最近的一段生活</p>
      <h2 className="home-story-title">{withAccents(slide.story.title, `title-${slide.key}`)}</h2>
      {slide.story.excerpt ? <p className="home-story-summary">{withQuotes(slide.story.excerpt, `excerpt-${slide.key}`)}</p> : null}
      <Link className="home-read" href={slide.story.href}>读读这一天 <span aria-hidden="true">↗</span></Link>
      {recent ? <div className="home-latest">
        <p className="home-latest-date">
          <time dateTime={recent.day}>{recent.dayLabel}</time>
          {recent.ageLabel ? <span> · 当时 {recent.ageLabel}</span> : null}
        </p>
        <Link href={recent.href}>{recent.title} <span aria-hidden="true">↗</span></Link>
      </div> : null}
    </div>

    {viewerAt !== null && reel.length > 0 ? <ViewerModal
      photos={reel}
      startIndex={viewerAt}
      dateLabel={photo?.dayLabel ?? ""}
      ageLabel={photo?.ageLabel ? `当时 ${photo.ageLabel}` : undefined}
      onClose={closeViewer}
    /> : null}
  </section>;
}
