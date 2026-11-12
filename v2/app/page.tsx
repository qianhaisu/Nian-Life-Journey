import React from "react";
import { attachMemoryReading } from "@/lib/home-memory-reading";
import Link from "next/link";
import Image from "next/image";
import { HomeMemory } from "@/components/home-memory";
import { HomeFilmEntry } from "@/components/home-film-entry";
import {
  FamilyVoicesTile,
  GrowthHighlightTile,
  LatestDayTile,
  RecentJournalSection,
  TimeCapsuleSection,
  TravelFootprintCard,
} from "@/components/home-bento-sections";
import { readHomeFeed, type HomeFeed } from "@/lib/home-feed";
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { buildHomeBentoModel } from "@/lib/home-bento";
import { selectHomeMemories } from "@/lib/home-memory";
import { topicLookupFrom } from "@/lib/home-memory-topics";
import { loadTopicCache } from "@/lib/home-memory-topics-load";
import { renderOnDemand } from "@/lib/render-on-demand";
import { selectHomeAnswer, type HomeAnswer } from "@/lib/home-answer";
import { listEditedMonthContents, loadMonthContent } from "@/lib/month-content";
import "./home.css";

// 首页（Modular Canvas · 模块化生活画布）：
//
//   1. 顶部双时钟问候与近况回答（最近怎么样，张年 + selectHomeAnswer）
//   2. 12 列 Bento 首屏马赛克（回忆主卡 + 最新日切片 + 近月成长 + 家人的话 + 家庭短片）
//   3. 近期日常 · 按天阅读（3 列结构化日卡）
//   4. 过去的张年 · 时间胶囊（4 列竖版胶卷回看，原则六）
//   5. 底部旅行足迹面板
//
// **零新增数据库查询**（CLAUDE.md 渲染路径规矩）：
// 全部数据均来自既有的 loadFamilyArchiveOnDemand()、readHomeFeed({ archive })、
// 随仓库发布的主题标注缓存（loadTopicCache）、本地月稿内存缓存（listEditedMonthContents）
// 与静态旅行地名册（lib/travel/）。

export default async function HomePage() {
  await renderOnDemand();
  const archive = await loadFamilyArchiveOnDemand();
  const feed = await readHomeFeed({ archive });
  const topics = topicLookupFrom(await loadTopicCache());
  const selected = selectHomeMemories(archive, topics);
  const memories = await attachMemoryReading(selected.memories, archive);
  const absence = selected.absence;

  // 复用月稿进程内缓存（loadFamilyArchive 已预热过，零数据库查询）。
  const monthContents = await listEditedMonthContents();
  const todayMonth = feed.clock.today.slice(0, 7);
  const editedLines = (
    await Promise.all(
      [todayMonth, prevMonth(todayMonth)].map(async (month) => ({
        month,
        line: (await loadMonthContent(month))?.cardLine ?? "",
      })),
    )
  ).filter((item) => item.line);

  const answer = selectHomeAnswer(archive.snapshots, feed.clock.today, archive.birthDay, editedLines);
  const activeLeadDay =
    memories.length > 0
      ? memories[0].kind === "day"
        ? memories[0].dateTime
        : undefined
      : feed.lead?.story.day;

  const excludePhotoIds =
    memories.length > 0
      ? memories
          .map((memory) => (memory.slides[memory.coverIndex] ?? memory.slides[0])?.media.id)
          .filter((id): id is string => Boolean(id))
      : feed.lead?.photo?.media.id
        ? [feed.lead.photo.media.id]
        : [];
  const memorySlidePhotoIds = memories.flatMap((memory) =>
    memory.slides.map((slide) => slide.media.id),
  );

  const bento = buildHomeBentoModel({
    archive,
    monthContents,
    topics,
    today: feed.clock.today,
    activeLeadDay,
    answerLine: answer?.line,
    excludePhotoIds,
    memorySlidePhotoIds,
  });

  const hasLatestDay = bento.latestDay !== null;
  const hasGrowth = bento.growth !== null;
  const hasTopRight = hasLatestDay || hasGrowth;
  const hasVoices = bento.voices.length > 0;
  const hasTravel = bento.travel.cityCount > 0 || Boolean(bento.travel.latestTrip);

  const bentoClasses = [
    "bento-hero",
    !hasTopRight ? "bento-hero--single-right-row" : "",
    hasLatestDay && !hasGrowth ? "bento-hero--no-growth" : "",
    !hasLatestDay && hasGrowth ? "bento-hero--no-latest" : "",
    !hasVoices ? "bento-hero--no-voices" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="home-v2">
      <div className="home-canvas">
        <header className="canvas-greeting">
          <p className="greeting-kicker">
            <span className="greeting-kicker-dot" aria-hidden="true" />
            <time dateTime={bento.clock.today}>{bento.clock.todayLabel}</time>
            {bento.clock.currentAgeLabel ? <span> · {bento.clock.currentAgeLabel}</span> : null}
          </p>
          <h1 className="home-greeting">
            <span className="greeting-ask">最近怎么样，</span>
            <span className="keep-whole">张年</span>
          </h1>
          <RecentAnswer answer={answer} />
        </header>

        <div className={bentoClasses}>
          {memories.length > 0 ? (
            <HomeMemory memories={memories} />
          ) : (
            <MemoryFallback feed={feed} reason={absence?.reason} />
          )}

          {bento.latestDay ? <LatestDayTile card={bento.latestDay} wide={!hasGrowth} /> : null}
          {bento.growth ? <GrowthHighlightTile growth={bento.growth} /> : null}
          {hasVoices ? <FamilyVoicesTile voices={bento.voices} /> : null}
          <HomeFilmEntry className={!hasVoices ? "tile-film--wide" : undefined} />
        </div>

        <RecentJournalSection
          days={bento.journal.days}
          latestMonthHref={bento.journal.latestMonthHref}
          latestMonthLabel={bento.journal.latestMonthLabel}
        />

        <TimeCapsuleSection capsules={bento.capsules} />

        {hasTravel ? (
          <div className="bottom-widgets">
            <TravelFootprintCard footprint={bento.travel} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function RecentAnswer({ answer }: { answer: HomeAnswer | undefined }) {
  if (!answer) return null;
  const answerClassName = answer.isCurrentMonth
    ? "home-answer home-answer--current"
    : "home-answer home-answer--provenance";
  const sourceClassName = answer.isCurrentMonth
    ? "home-answer-source home-answer-source--inline"
    : "home-answer-source home-answer-source--pill";
  return (
    <p className={answerClassName}>
      <span className="home-answer-text">
        {answer.parts.map((part, i) =>
          part.core ? (
            <span key={i} className="home-answer-core">
              {part.text}
            </span>
          ) : (
            part.text
          ),
        )}
      </span>
      <Link
        className={sourceClassName}
        href={answer.href}
        aria-label={answer.isCurrentMonth ? `${answer.compactSourceLabel}（${answer.sourceLabel}）` : undefined}
      >
        <span>{answer.compactSourceLabel}</span>
        <span className="home-answer-arrow" aria-hidden="true">↗</span>
      </Link>
    </p>
  );
}

function MemoryFallback({ feed, reason }: { feed: HomeFeed; reason?: string }) {
  const lead = feed.lead;
  if (!lead) {
    return (
      <section className="bento-tile tile-lead-photo tile-lead-empty" aria-label="最近的一段生活" data-fallback-reason={reason}>
        <p className="home-nothing">
          {feed.leadAbsence?.kind === "empty_material"
            ? "还没有一段整理好的记忆可以放在这里。"
            : "档案还是空的。等时间再走一会儿。"}
        </p>
      </section>
    );
  }
  const photo = lead.photo;
  return (
    <section
      className={
        photo
          ? "home-memory home-memory--single tile-lead-photo"
          : "home-memory home-memory--single home-memory--text-only tile-lead-photo"
      }
      aria-label="最近的一段生活"
      data-fallback-reason={reason}
    >
      <div className="memory-stage">
        {photo ? (
          <div className="memory-frames">
            <Link
              className="memory-single-photo"
              href={lead.story.href}
              aria-label={`读这张照片的那一天：${lead.story.title}`}
            >
              <Image
                src={photo.media.src}
                alt={photo.media.alt}
                width={photo.media.width || 4}
                height={photo.media.height || 5}
                sizes="(max-width: 899px) 96vw, 580px"
                priority
                unoptimized
              />
            </Link>
            <div className="memory-scrim" aria-hidden="true" />
            <div className="memory-top-bar">
              <p className="memory-caption-line">
                <time dateTime={lead.story.day}>{lead.story.dateLabel}</time>
                {lead.story.ageLabel ? (
                  <span>
                    {" · "}
                    {lead.story.ageLabel === "出生的那天" ? "出生那天" : `当时 ${lead.story.ageLabel}`}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="memory-colophon">
              <div className="memory-colophon-copy">
                <h2 className="memory-title">{lead.story.title}</h2>
                <div className="memory-actions">
                  <Link className="memory-read" href={lead.story.href}>
                    <span>读读这一天</span>
                    <span aria-hidden="true">↗</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="memory-fallback-text">
            <p className="memory-caption-line memory-caption-line--ink">
              <time dateTime={lead.story.day}>{lead.story.dateLabel}</time>
              {lead.story.ageLabel ? (
                <span>
                  {" · "}
                  {lead.story.ageLabel === "出生的那天" ? "出生那天" : `当时 ${lead.story.ageLabel}`}
                </span>
              ) : null}
            </p>
            <h2 className="memory-title memory-title--ink">{lead.story.title}</h2>
            <div className="memory-actions">
              <Link className="memory-read memory-read--ink" href={lead.story.href}>
                <span>读读这一天</span>
                <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
