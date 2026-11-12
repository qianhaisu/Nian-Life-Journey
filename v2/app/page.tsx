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
import { HomeHealthReminders } from "@/components/home-health-reminders";
import { HomeReminders, type HomeReminder as HomeReminderView, type HomeReminderSource } from "@/components/home-reminders";
import { MODALITY_LABEL, SOURCE_KIND_LABEL, roleText, type SourceKind } from "@/components/upcoming-tasks";
import { readHomeFeed, HOME_REMINDER_LABEL, type HomeFeed, type HomeReminder, type HomeReminderState } from "@/lib/home-feed";
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { buildHomeBentoModel } from "@/lib/home-bento";
import { selectHomeMemories } from "@/lib/home-memory";
import { topicLookupFrom } from "@/lib/home-memory-topics";
import { loadTopicCache } from "@/lib/home-memory-topics-load";
import { groupReminders } from "@/lib/reminder-groups";
import { HOME_QUIET_STATES } from "@/lib/home-reminder-display";
import { windowStart, windowEnd } from "@/lib/home-reminder-window";
import { CANONICAL_PROFILE_ID } from "@/lib/db/config";
import { renderOnDemand } from "@/lib/render-on-demand";
import { formatDay, formatMonth } from "@/lib/time-signature";
import { selectHomeAnswer, type HomeAnswer } from "@/lib/home-answer";
import { listEditedMonthContents, loadMonthContent } from "@/lib/month-content";
import { stripWechatEmoticons } from "@/lib/organizer/evidence-text";
import "./home.css";

// 首页（Modular Canvas · 模块化生活画布）：
//
//   1. 顶部双时钟问候与近况回答（最近怎么样，张年 + selectHomeAnswer）
//   2. 12 列 Bento 首屏马赛克（回忆主卡 + 最新日切片 + 近月成长 + 家人的话 + 家庭短片）
//   3. 近期日常 · 按天阅读（3 列结构化日卡）
//   4. 过去的张年 · 时间胶囊（4 列竖版胶卷回看，原则六）
//   5. 底部家庭实用双栏（每周提醒 + 旅行足迹）
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
  const answerCore = answer?.parts.find((part) => part.core)?.text;
  const activeLeadDay =
    memories.length > 0
      ? memories[0].kind === "day"
        ? memories[0].dateTime
        : undefined
      : feed.lead?.story.day;

  const bento = buildHomeBentoModel({
    archive,
    monthContents,
    topics,
    today: feed.clock.today,
    activeLeadDay,
    answerLine: answerCore,
  });

  const hasLatestDay = bento.latestDay !== null;
  const hasGrowth = bento.growth !== null;
  const hasTopRight = hasLatestDay || hasGrowth;
  const hasVoices = bento.voices.length > 0;

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

        <div className="bottom-widgets">
          <Reminders feed={feed} />
          <TravelFootprintCard footprint={bento.travel} />
        </div>
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
  return (
    <p className="home-answer">
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
      <Link className="home-answer-source" href={answer.href}>
        <span>{answer.sourceLabel}</span>
        <span aria-hidden="true">↗</span>
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

const LIVE_REMINDER_STATES = new Set<HomeReminderState>(["active", "needs_confirmation", "tentative", "done"]);

function Reminders({ feed }: { feed: HomeFeed }) {
  const { reminders } = feed;
  if (reminders.status === "unavailable") return <HomeHealthReminders standalone />;
  const shown = reminders.status === "ready" ? reminders.shown : [];
  const more =
    reminders.status === "ready"
      ? reminders.more.filter((reminder) => LIVE_REMINDER_STATES.has(reminder.state))
      : [];
  const rangeStart = windowStart(feed.clock.today);
  return (
    <HomeReminders
      reminders={groupReminders([...shown, ...more].map(toReminderView))}
      habitIds={reminders.status === "ready" ? reminders.habitShownIds : []}
      storageScope={CANONICAL_PROFILE_ID}
      rangeStart={rangeStart}
      rangeEnd={windowEnd(feed.clock.today)}
    />
  );
}

function toReminderView(reminder: HomeReminder): HomeReminderView {
  const when = reminder.item.when;
  return {
    id: reminder.id,
    whenKey: JSON.stringify(
      when.kind === "unconfirmed"
        ? { ...when, raisedDay: reminder.item.evidence?.day ?? reminder.id }
        : when,
    ),
    pendingConfirmation:
      reminder.state === "tentative" ||
      reminder.state === "needs_confirmation" ||
      when.kind === "unconfirmed",
    title: stripWechatEmoticons(reminder.title) || reminder.title,
    whenText: reminder.deadlineLabel,
    whenDay: when.kind === "day" ? when.day : undefined,
    actionable: reminder.state !== "done",
    statusLabel: HOME_QUIET_STATES.has(reminder.state) ? undefined : HOME_REMINDER_LABEL[reminder.state],
    note: reminder.detail ? stripWechatEmoticons(reminder.detail) || undefined : undefined,
    sources: provenanceRows(reminder),
  };
}

function provenanceRows(reminder: HomeReminder): HomeReminderSource[] {
  const provenance = reminder.provenance;
  if (provenance?.reviewState !== "approved") return [];
  const notes: { kind: SourceKind; note: NonNullable<typeof provenance.raised> | undefined }[] = [
    { kind: "raised", note: provenance.raised },
    { kind: "completed", note: provenance.completed },
    { kind: "rescheduled", note: provenance.rescheduled },
    { kind: "cancelled", note: provenance.cancelled },
  ];
  const link = evidenceLink(reminder);
  return notes.flatMap(({ kind, note }) =>
    note
      ? [
          {
            kindLabel: SOURCE_KIND_LABEL[kind],
            roleText: roleText(note.role),
            roleUnconfirmed: note.role.kind === "unconfirmed",
            toneLabel: MODALITY_LABEL[note.modality],
            recordedOn: note.onDay,
            recordedOnLabel: formatDay(note.onDay),
            summary: stripWechatEmoticons(note.summary) || note.summary,
            link,
          },
        ]
      : [],
  );
}

function evidenceLink(reminder: HomeReminder): { href: string; label: string } | undefined {
  if (!reminder.evidenceHref) return undefined;
  if (reminder.evidenceKind === "event") return { href: reminder.evidenceHref, label: "看那一天" };
  if (reminder.evidenceKind === "month") {
    const [, , year, month] = reminder.evidenceHref.split("/");
    return {
      href: reminder.evidenceHref,
      label: year && month ? `翻到 ${formatMonth(`${year}-${month}`)}` : "翻到那个月",
    };
  }
  return undefined;
}
