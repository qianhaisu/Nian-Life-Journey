"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  pickRotatedCapsules,
  pickRotatedJournalDays,
  pickRotatedVoices,
} from "@/lib/home-bento-rotate";
import type {
  BentoDayCard,
  BentoFamilyVoice,
  BentoTimeCapsule,
} from "@/lib/home-bento";
import { mediaDeliveryUrl } from "@/lib/media/paths";

// 首页可轮换的 Bento 交互章节（仅保留带客户端轮换状态的三组模块；
// 注意不要在运行期导入 @/lib/home-bento，避免将 travel/geo 数据打进首页客户端包）。

export function FamilyVoicesTile({
  voices,
  pool,
  initialSlot = 0,
}: {
  voices: BentoFamilyVoice[];
  pool?: BentoFamilyVoice[];
  initialSlot?: number;
}) {
  const [step, setStep] = useState(0);
  if (voices.length === 0) return null;
  const effectivePool = pool && pool.length > 0 ? pool : voices;
  const shown =
    step === 0 ? voices.slice(0, 3) : pickRotatedVoices(effectivePool, 3, initialSlot + step);
  const canRotate = effectivePool.length > 3;

  return (
    <section className="bento-tile tile-voices" aria-labelledby="home-voices-heading">
      <div className="tile-voices-head">
        <h2 className="tile-label tile-label--peach" id="home-voices-heading">
          家人的话
        </h2>
        {canRotate ? (
          <button
            type="button"
            className="tile-rotate-btn"
            onClick={() => setStep((prev) => prev + 1)}
            aria-label="换一批家人的话"
          >
            换一批
          </button>
        ) : null}
      </div>
      <div className="chat-bubbles">
        {shown.map((voice) => (
          <Link
            key={voice.id}
            className="chat-msg"
            href={voice.href}
            aria-label={`${voice.speaker}（${voice.shortDateLabel}${voice.ageDisplay ? `，${voice.ageDisplay}` : ""}）：${voice.quote}`}
          >
            <span className={`chat-avatar chat-avatar--${voice.tone}`} aria-hidden="true">
              {voice.avatarInitial}
            </span>
            <span className="chat-bubble-wrap">
              <span className="chat-text">「{voice.quote}」</span>
              <span className="chat-meta">
                <strong>{voice.speaker}</strong>
                <span> · </span>
                <time dateTime={voice.day}>{voice.shortDateLabel}</time>
                {voice.ageDisplay ? <span> · {voice.ageDisplay}</span> : null}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function RecentJournalSection({
  days,
  pool,
  initialSlot = 0,
  latestMonthHref,
  latestMonthLabel,
}: {
  days: BentoDayCard[];
  pool?: BentoDayCard[];
  initialSlot?: number;
  latestMonthHref?: string;
  latestMonthLabel?: string;
}) {
  const [step, setStep] = useState(0);
  if (days.length === 0) return null;
  const effectivePool = pool && pool.length > 0 ? pool : days;
  const visibleDays =
    step === 0 ? days : pickRotatedJournalDays(effectivePool, 3, initialSlot + step);
  const canRotate = effectivePool.length > 3;

  return (
    <section className="mod-section mod-section--journal" aria-labelledby="home-journal-heading">
      <div className="mod-sec-head">
        <h2 className="mod-sec-title" id="home-journal-heading">
          近期日常
        </h2>
        <div className="mod-sec-actions">
          {canRotate ? (
            <button
              type="button"
              className="mod-sec-pill mod-sec-rotate"
              onClick={() => setStep((prev) => prev + 1)}
              aria-label="换一批近期日常"
            >
              换一批
            </button>
          ) : null}
          {latestMonthHref && latestMonthLabel ? (
            <Link className="mod-sec-pill" href={latestMonthHref}>
              <span>{latestMonthLabel}</span>
              <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </div>
      </div>
      <div className={`journal-grid journal-grid--count-${Math.min(visibleDays.length, 3)}`}>
        {visibleDays.map((item) => (
          <Link
            key={item.day}
            className={item.photo ? "j-card" : "j-card j-card--text-only"}
            href={item.href}
            aria-label={`${item.fullDateLabel}：${item.title}`}
          >
            {item.photo ? (
              <div className="j-card-photo">
                <Image
                  src={item.photo.src}
                  alt={item.photo.alt}
                  width={item.photo.width || 4}
                  height={item.photo.height || 3}
                  sizes="(max-width: 680px) 92vw, (max-width: 1080px) 46vw, 410px"
                  unoptimized
                />
              </div>
            ) : null}
            <p className="j-card-meta">
              <time className="j-card-date" dateTime={item.day}>
                {item.weekdayDateLabel}
              </time>
              {item.ageDisplay ? (
                <>
                  <span className="j-card-meta-sep" aria-hidden="true">·</span>
                  <span className="j-card-age">{item.ageDisplay}</span>
                </>
              ) : null}
            </p>
            <h3 className="j-card-title">{item.title}</h3>
            {item.excerpt ? <p className="j-card-excerpt">{item.excerpt}</p> : null}
            <div className="j-card-foot">
              <span>读这一天</span>
              <span aria-hidden="true">→</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function TimeCapsuleSection({
  capsules,
  pool,
  initialSlot = 0,
}: {
  capsules: BentoTimeCapsule[];
  pool?: BentoTimeCapsule[];
  initialSlot?: number;
}) {
  const [step, setStep] = useState(0);
  // 原则六：不足 2 张合格过往瞬间时整节收起
  if (capsules.length < 2) return null;
  const effectivePool = pool && pool.length > 0 ? pool : capsules;
  const visibleCapsules =
    step === 0 ? capsules : pickRotatedCapsules(effectivePool, 4, initialSlot + step);
  const canRotate = effectivePool.length > 4;

  return (
    <section className="mod-section mod-section--capsules" aria-labelledby="home-capsules-heading">
      <div className="mod-sec-head">
        <div className="mod-sec-heading-group">
          <h2 className="mod-sec-title" id="home-capsules-heading">
            过去的张年
          </h2>
        </div>
        <div className="mod-sec-actions">
          {canRotate ? (
            <button
              type="button"
              className="mod-sec-pill mod-sec-rotate"
              onClick={() => setStep((prev) => prev + 1)}
              aria-label="换一批过去的张年"
            >
              换一批
            </button>
          ) : null}
          <Link className="mod-sec-pill" href="/memory">
            <span>全部记忆</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
      <div className={`capsule-strip capsule-strip--count-${Math.min(visibleCapsules.length, 4)}`}>
        {visibleCapsules.map((capsule) => (
          <Link
            key={capsule.day}
            className="capsule-card"
            href={capsule.href}
            aria-label={`${capsule.monthLabel}（${capsule.ageDisplay}）：${capsule.title}`}
          >
            <Image
              src={capsule.photo.thumbnailSrc ?? mediaDeliveryUrl(capsule.photo.id, "thumbnail")}
              alt={capsule.photo.alt}
              width={capsule.photo.width || 3}
              height={capsule.photo.height || 4}
              sizes="(max-width: 680px) 46vw, (max-width: 1080px) 46vw, 310px"
              unoptimized
            />
            <span className="capsule-scrim" aria-hidden="true" />
            <span className="capsule-badge">{capsule.badgeLabel}</span>
            <span className="capsule-info">
              <time className="capsule-date" dateTime={capsule.day}>
                {capsule.fullDateLabel}
              </time>
              <span className="capsule-title">{capsule.title}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
