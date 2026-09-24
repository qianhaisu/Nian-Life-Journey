import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DayPhotos } from "@/components/day-photos";
import { Photo } from "@/components/photo";
import { renderOnDemand } from "@/lib/render-on-demand";
import { KIND_LABEL, whenAge, formatRange, placeNames, tripById } from "@/lib/travel/model";
import { readTrip } from "@/lib/travel/reading";
import "../travel.css";

export async function generateMetadata({ params }: { params: Promise<{ tripId: string }> }): Promise<Metadata> {
  const { tripId } = await params;
  const trip = tripById(tripId);
  return { title: trip ? `${trip.title} · 旅行` : "旅行" };
}

// 一次旅程（docs/travel-module-plan.md §4.2）。它只是索引：综述是这里唯一新写的文字，每一天都是
// 已发布日页的标题、首段和首屏照片，点进去读全文。日页不存在的日子不出现。
export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  await renderOnDemand();
  const { tripId } = await params;
  const reading = await readTrip(tripId);
  if (!reading) notFound();
  const { trip, ageLabel, cover, days } = reading;
  const tag = KIND_LABEL[trip.kind];
  const places = placeNames(trip);

  return (
    <article className="travel-page travel-trip">
      <header className="reading-wrap detail-head">
        <Link className="back-link" href="/travel">← 旅行</Link>
        <p className="travel-when">
          {tag ? <span className="travel-tag">{tag}</span> : null}
          <time dateTime={trip.from}>{formatRange(trip.from, trip.to)}</time>
          <span className="travel-age">{whenAge(ageLabel)}</span>
        </p>
        <h1 className="serif">{trip.title}</h1>
        {places !== trip.title ? <p className="travel-places">{places}</p> : null}
      </header>

      {cover ? <div className="reading-wrap travel-trip-cover"><Photo media={cover} sizes="(max-width: 760px) 100vw, 728px" priority /></div> : null}

      <section className="story-layer reading-wrap">
        <div className="story-column"><p className="story-lead">{trip.summary}</p></div>
      </section>

      {days.length > 1 || trip.kind !== "daytrip" ? (
        <ol className="reading-wrap travel-days">
          {days.map((d) => (
            <li key={d.day} className="travel-day">
              <p className="travel-when"><time dateTime={d.day}>{d.dateLabel}</time><span className="travel-age">{whenAge(d.ageLabel)}</span></p>
              <h2 className="travel-day-title"><Link href={d.href}>{d.title}</Link></h2>
              {d.lead ? <p className="travel-day-lead">{d.lead}</p> : null}
              <DayPhotos photos={d.photos} dateLabel={d.dateLabel} ageLabel={d.ageLabel} quietLabel />
              <Link className="travel-day-more" href={d.href}>读这一天</Link>
            </li>
          ))}
        </ol>
      ) : days[0] ? (
        <div className="reading-wrap travel-days">
          <DayPhotos photos={days[0].photos} dateLabel={days[0].dateLabel} ageLabel={days[0].ageLabel} quietLabel />
          <Link className="travel-day-more" href={days[0].href}>读这一天：{days[0].title}</Link>
        </div>
      ) : null}
    </article>
  );
}
