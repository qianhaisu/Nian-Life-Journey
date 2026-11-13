import Link from "next/link";
import { HomeMemory } from "@/components/home-memory";
import { Photo } from "@/components/photo";
import type { MediaRef } from "@/lib/memory-chapters";
import { tripTag, whenAge, tripRange, placeNames } from "@/lib/travel/model";
import type { EssayPhoto, TripNeighbor, TripReadingData } from "@/lib/travel/reading";

/** 接在一段正文后面的照片：1 张通栏，2～3 张并排。图注没有就不写，不用标题或日期冒充。 */
function EssayFigures({ group }: { group: readonly EssayPhoto[] }) {
  if (!group.length) return null;
  return (
    <div className={`travel-essay-media travel-essay-media--${group.length}`}>
      {group.map(({ media, caption }) => (
        <figure className="travel-essay-figure" key={media.id}>
          <Photo media={media} variant={group.length === 1 ? "web" : "thumbnail"} fit={group.length === 1 ? "natural" : "crop"} sizes={group.length === 1 ? "(max-width: 760px) 100vw, 680px" : "(max-width: 760px) 46vw, 220px"} loading="lazy" />
          {caption ? <figcaption>{caption}</figcaption> : null}
        </figure>
      ))}
    </div>
  );
}

function NeighborLink({ neighbor, side }: { neighbor?: TripNeighbor; side: "prev" | "next" }) {
  if (!neighbor) return <span className={`travel-neighbor travel-neighbor--${side} is-empty`} aria-hidden="true" />;
  const { trip, cover, ageLabel } = neighbor;
  const label = trip.recordOnly ? placeNames(trip) : trip.title;
  return (
    <Link className={`travel-neighbor travel-neighbor--${side}`} href={`/travel/${trip.id}`} rel={side}>
      {cover ? <span className="travel-neighbor-photo"><Photo media={cover as MediaRef} variant="thumbnail" fit="crop" sizes="72px" loading="lazy" /></span> : null}
      <span className="travel-neighbor-body">
        <span className="travel-neighbor-dir">{side === "prev" ? "← 上一段旅程" : "下一段旅程 →"}</span>
        <strong>{label}</strong>
        <span className="travel-neighbor-when">{tripRange(trip)}{whenAge(ageLabel)}</span>
      </span>
    </Link>
  );
}

/** The travel page's blocks; shared by the actual route and isolated browser verification. */
export function TripReading({ reading }: { reading: TripReadingData }) {
  const { trip, ageLabel, memory, essay, essayMedia, days, neighbors } = reading;
  const tag = tripTag(trip);
  const places = placeNames(trip);
  const dayCards = days.filter(day => day.href);

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
        <div className="travel-essay-body">{essay.paragraphs.map((paragraph, index) => (
          <div className="travel-essay-block" key={index}>
            <p>{paragraph}</p>
            {essayMedia?.[index]?.length ? <EssayFigures group={essayMedia[index]} /> : null}
          </div>
        ))}</div>
      </section>

      {dayCards.length ? <section className="reading-wrap travel-days" aria-labelledby="trip-days-title">
        <h2 id="trip-days-title" className="travel-section-title">这段旅程留下的日子</h2>
        <ul className="travel-day-list">{dayCards.map(day => {
          const thumb = day.photos.find(media => media.type !== "video");
          return <li key={day.day}>
            <Link className={thumb ? "travel-day-card" : "travel-day-card travel-day-card--text"} href={day.href!}>
              {thumb ? <span className="travel-day-thumb"><Photo media={thumb} variant="thumbnail" fit="crop" sizes="(max-width: 760px) 84px, 112px" loading="lazy" /></span> : null}
              <span className="travel-day-body">
                <time dateTime={day.day}>{day.dateLabel}{day.ageLabel ? <span className="travel-day-age">{whenAge(day.ageLabel)}</span> : null}</time>
                {day.title ? <strong>{day.title}</strong> : null}
              </span>
            </Link>
          </li>;
        })}</ul>
      </section> : null}

      {neighbors.prev || neighbors.next ? <nav className="reading-wrap travel-neighbors" aria-label="上一段 / 下一段旅程">
        <NeighborLink neighbor={neighbors.prev} side="prev" />
        <NeighborLink neighbor={neighbors.next} side="next" />
      </nav> : null}
    </article>
  );
}
