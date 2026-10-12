import Link from "next/link";
import { HomeMemory } from "@/components/home-memory";
import { KIND_LABEL, whenAge, tripRange, placeNames } from "@/lib/travel/model";
import type { TripReadingData } from "@/lib/travel/reading";

/** The travel page's two blocks; shared by the actual route and isolated browser verification. */
export function TripReading({ reading }: { reading: TripReadingData }) {
  const { trip, ageLabel, memory, essay, days } = reading;
  const tag = KIND_LABEL[trip.kind];
  const places = placeNames(trip);

  return (
    <article className="travel-page travel-trip">
      <header className="reading-wrap detail-head">
        <Link className="back-link" href="/travel">← 旅行</Link>
        <p className="travel-when">
          {tag ? <span className="travel-tag">{tag}</span> : null}
          <time dateTime={trip.from}>{tripRange(trip)}</time>
          <span className="travel-age">{whenAge(ageLabel)}</span>
        </p>
        <h1 className="serif">{trip.recordOnly ? places : trip.title}</h1>
        {!trip.recordOnly && places !== trip.title ? <p className="travel-places">{places}</p> : null}
      </header>

      {memory ? <div className="reading-wrap travel-reel">
        <HomeMemory memories={[memory]} ariaLabel="这次旅行的照片回忆" closeLabel="关闭，回到旅行" />
      </div> : null}

      <section className="reading-wrap travel-essay" aria-labelledby="trip-essay-title">
        <h2 id="trip-essay-title" className="serif">{essay.title}</h2>
        <div className="travel-essay-body">{essay.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        {days.some(day => day.href) ? <details className="travel-sources">
          <summary>这段旅程留下的日子</summary>
          <ul>{days.filter(day => day.href).map(day => <li key={day.day}>
            <Link href={day.href!}><time dateTime={day.day}>{day.dateLabel}</time><span>{day.title}</span></Link>
          </li>)}</ul>
        </details> : null}
      </section>
    </article>
  );
}
