import React from "react";
import Image from "next/image";
import Link from "next/link";
import type {
  BentoDayCard,
  BentoGrowthHighlight,
  BentoTravelFootprint,
} from "@/lib/home-bento";
import { mediaDeliveryUrl } from "@/lib/media/paths";

// 首页 Bento 纯静态子模块（Server Component，零客户端 JS 负担）。
//
// 严格遵守：
//   · 双时钟（原则二）：每一张卡片的日期都同时附带「当时 X 岁 Y 个月」
//   · 零工程术语与统计炫耀（原则三、原则四）：不写「已归档」「含照片与记录」
//   · 触控热区 ≥44px：整卡链接或独立药丸链接均满足最小触达尺寸

export function LatestDayTile({
  card,
  wide = false,
}: {
  card: BentoDayCard;
  wide?: boolean;
}) {
  const hasPhoto = Boolean(card.photo);
  const classes = [
    "bento-tile",
    "tile-latest-day",
    hasPhoto ? "tile-latest-day--with-photo" : "tile-latest-day--text-only",
    wide ? "tile-latest-day--wide" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link className={classes} href={card.href} aria-label={`${card.fullDateLabel}：${card.title}`}>
      {card.photo ? (
        <span className="day-slice-thumb">
          <Image
            src={card.photo.thumbnailSrc ?? mediaDeliveryUrl(card.photo.id, "thumbnail")}
            alt={card.photo.alt}
            width={card.photo.width || 4}
            height={card.photo.height || 5}
            sizes="(max-width: 899px) 140px, 180px"
            unoptimized
          />
        </span>
      ) : null}
      <span className="day-slice-body">
        <span className="day-slice-badge">
          <time dateTime={card.day}>{card.shortDateLabel}</time>
          {card.ageDisplay ? <span> · {card.ageDisplay}</span> : null}
        </span>
        <span className="day-slice-title">{card.title}</span>
        {card.excerpt ? <span className="day-slice-excerpt">{card.excerpt}</span> : null}
        <span className="day-slice-cta">
          <span>读这一天</span>
          <span aria-hidden="true">→</span>
        </span>
      </span>
    </Link>
  );
}

export function GrowthHighlightTile({ growth }: { growth: BentoGrowthHighlight }) {
  const monthNum = Number(growth.month.slice(5, 7));
  const compactMonthText =
    growth.isCurrentMonth && !Number.isNaN(monthNum) ? `${monthNum} 月` : growth.monthLabel;

  return (
    <Link
      className="bento-tile tile-growth"
      href={growth.href}
      aria-label={`近月成长印象（${growth.monthLabel}）：${growth.headline}`}
    >
      <div className="tile-growth-top">
        <div className="tile-growth-head">
          <span className="tile-label tile-label--lavender">近月成长</span>
          <span className="tile-growth-clock">
            <time dateTime={growth.month}>{compactMonthText}</time>
            {growth.ageDisplay ? <span> · {growth.ageDisplay}</span> : null}
          </span>
        </div>
        <p className="growth-headline">{growth.headline}</p>
      </div>
      {growth.tags.length > 0 ? (
        <ul className="growth-tags" aria-label="当月片段">
          {growth.tags.map((tag) => (
            <li key={tag} className="growth-tag">
              {tag}
            </li>
          ))}
        </ul>
      ) : (
        <span className="tile-growth-more">
          <span>翻阅这一章</span>
          <span aria-hidden="true">→</span>
        </span>
      )}
    </Link>
  );
}

export function TravelFootprintCard({ footprint }: { footprint: BentoTravelFootprint }) {
  if (footprint.cityCount === 0 && !footprint.latestTrip) return null;

  return (
    <section className="widget-panel footprint-panel" aria-labelledby="home-footprint-heading">
      <div className="widget-head">
        <div className="widget-title-wrap">
          <h2 className="widget-title" id="home-footprint-heading">
            旅行足迹
          </h2>
          <span className="widget-badge widget-badge--mint">
            {footprint.countryCount} 国 · {footprint.cityCount} 城
          </span>
        </div>
        <Link className="widget-head-link" href="/travel">
          <span>足迹地图</span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      {footprint.latestTrip ? (
        <Link className="footprint-latest" href={footprint.latestTrip.href}>
          <span className="footprint-latest-kicker">
            <time dateTime={footprint.latestTrip.from}>{footprint.latestTrip.rangeLabel}</time>
            {footprint.latestTrip.ageDisplay ? <span> · {footprint.latestTrip.ageDisplay}</span> : null}
          </span>
          <span className="footprint-latest-title">
            <span>{footprint.latestTrip.title}</span>
            <span className="footprint-latest-arrow" aria-hidden="true">→</span>
          </span>
          {footprint.latestTrip.summary ? (
            <span className="footprint-latest-summary">{footprint.latestTrip.summary}</span>
          ) : null}
        </Link>
      ) : null}

      {footprint.cities.length > 0 ? (
        <div className="footprint-cities" aria-label="去过的城市">
          {footprint.cities.map((city) => (
            <Link
              key={city.key}
              className={city.isLatest ? "footprint-pill is-latest" : "footprint-pill"}
              href={city.href}
            >
              {city.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="footprint-plan-row">
        <Link className="footprint-plan-link" href="/travel?view=plan">
          <span>看看这周末准备去哪</span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
