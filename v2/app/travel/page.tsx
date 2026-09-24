import type { Metadata } from "next";
import Link from "next/link";
import { Photo } from "@/components/photo";
import { renderOnDemand } from "@/lib/render-on-demand";
import { productToday } from "@/lib/time-truth";
import { KIND_LABEL, whenAge, TRIPS, formatRange, leadLine, placeNames } from "@/lib/travel/model";
import { readTravelIndex, type TripCard } from "@/lib/travel/reading";
import "./travel.css";

export const metadata: Metadata = { title: "旅行" };

// 旅行（docs/travel-module-plan.md §4.1）：记忆的地理章节。第一句读得出张年去过哪；下面按年倒序，
// 过夜的旅程是大卡，一日短途是窄条（原则五：四川跨年和去德清看羊一眼分得出）。
// 迷雾地图是第 2 期，这一期不放占位；「接下来」是第 3 期，没有数据就整块不出现（原则六：不写「暂无」）。
export default async function TravelPage() {
  // 与 /memory 同理：不在构建时用 mock 数据预渲染（lib/render-on-demand.ts）。
  await renderOnDemand();
  const { cards, birthDay } = await readTravelIndex();
  const today = productToday();
  const years = new Map<string, TripCard[]>();
  for (const card of cards) {
    const year = card.trip.from.slice(0, 4);
    years.set(year, [...(years.get(year) ?? []), card]);
  }

  return (
    <div className="travel-page">
      <header className="reading-wrap travel-head">
        <h1 className="serif">旅行</h1>
        <p className="travel-lead">{leadLine(TRIPS, birthDay, today)}</p>
      </header>

      {[...years].map(([year, list]) => {
        const big = list.filter((c) => c.trip.kind !== "daytrip");
        const small = list.filter((c) => c.trip.kind === "daytrip");
        return (
          <section key={year} className="reading-wrap travel-year" aria-labelledby={`travel-${year}`}>
            <h2 id={`travel-${year}`} className="travel-year-head">
              <span>{year} 年</span>
            </h2>
            {big.length ? <div className="travel-cards">{big.map((card) => <TripCardView key={card.trip.id} card={card} />)}</div> : null}
            {small.length ? (
              <ul className="travel-shorts" aria-label={`${year} 年的一日短途`}>
                {small.map(({ trip, cover, ageLabel }) => (
                  <li key={trip.id}>
                    <Link href={`/travel/${trip.id}`} className="travel-short">
                      <span className="travel-short-thumb">{cover ? <Photo media={cover} variant="thumbnail" fit="crop" sizes="72px" /> : null}</span>
                      <span className="travel-short-body">
                        <strong>{trip.title}</strong>
                        <span className="travel-when">{formatRange(trip.from, trip.to)}<span className="travel-age">{whenAge(ageLabel)}</span></span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function TripCardView({ card }: { card: TripCard }) {
  const { trip, cover, ageLabel } = card;
  const tag = KIND_LABEL[trip.kind];
  return (
    <Link href={`/travel/${trip.id}`} className="travel-card scroll-reveal">
      {cover ? <div className="travel-card-photo"><Photo media={cover} variant="web" fit="crop" sizes="(max-width: 760px) 100vw, 728px" /></div> : null}
      <div className="travel-card-body">
        <p className="travel-when">
          {tag ? <span className="travel-tag">{tag}</span> : null}
          {formatRange(trip.from, trip.to)}<span className="travel-age">{whenAge(ageLabel)}</span>
        </p>
        <h3 className="travel-card-title">{trip.title}</h3>
        {placeNames(trip) !== trip.title ? <p className="travel-places">{placeNames(trip)}</p> : null}
        <p className="travel-card-summary">{trip.summary}</p>
      </div>
    </Link>
  );
}
