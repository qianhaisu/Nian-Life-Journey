import { EditorialMemory } from "@/components/editorial-memory";
import { PhotoStrip } from "@/components/media-sequence";
import { Photo } from "@/components/photo";
import type { PublicationMoment } from "@/lib/publication-moments";

// How a month chapter is laid out. Composition — which days appear at all and in what order — is
// lib/publication-moments.ts and is not touched here; this file only decides how the material it
// hands over is set on the page.
//
// The rule that governs everything below: the words are evidence, not copy. A trace entry reaches
// the page exactly as the archive stored it — never rewritten, never merged with its neighbour into
// one sentence, never dropped to tidy a column. What typography is allowed to change is the volume:
// set at title size these short, plain observations wrapped every ten characters and each one
// arrived shouting, which turned a month into a list of headlines. Set as consecutive indented
// paragraphs at reading size, the same untouched sentences read as a day.

// A day inside a month chapter names itself "7 月 1 日": the masthead above already carries the
// year, so repeating it on every day turns the page into a register. `dateTime` keeps the full ISO
// day, so nothing machine-readable is lost.
export function dayLabel(dateLabel: string, year: string): string {
  return dateLabel.replace(`${year} 年 `, "");
}

// The running head of a day: the two clocks, calendar and life, and nothing else (原则二). In the
// reading column it hangs in the left margin; on a narrow screen it sits above the words.
export function DayHead({ day, dateLabel, ageLabel, year }: { day: string; dateLabel: string; ageLabel?: string; year: string }) {
  return <p className="month-day-date"><time dateTime={day}>{dayLabel(dateLabel, year)}</time>{ageLabel ? <span>{ageLabel}</span> : null}</p>;
}

// One moment of the month, read start to finish: its date, its words if the archive wrote any,
// then its photographs. Text and pictures share the day; the text never captions a picture.
// Every kind gets the same shape — running head, then body — so a month reads as one column of
// days rather than as alternating card designs. A published memory keeps its own title and lead
// inside the body; its date is already stated by the head, so it does not repeat it.
// `continued` is the second moment of a day the reader is already inside (a memory and that same
// day's words): the head is stated once and the block reads on under it.
export function MonthMoment({ moment, year, priority = false, continued = false }: { moment: PublicationMoment; year: string; priority?: boolean; continued?: boolean }) {
  return <article className={`month-moment moment-${moment.kind}${moment.hero ? " moment-with-hero" : ""}${continued ? " moment-continued" : ""}`}>
    {continued ? null : <DayHead day={moment.day} dateLabel={moment.dateLabel} ageLabel={moment.ageLabel} year={year} />}
    <div className="moment-body">
      {moment.kind === "memory_led" && moment.memory ? <EditorialMemory memory={moment.memory} priority={priority} /> : null}
      {/* One entry, one paragraph: each is a separate record of the archive and keeps its own line.
          The day still reads through in one go because they are set as consecutive paragraphs of
          prose, not because any two of them were joined. */}
      {moment.text.length > 0 ? <div className="moment-text serif">{moment.text.map((entry, index) => <p key={index}>{entry}</p>)}</div> : null}
      {moment.hero ? <Photo media={moment.hero} priority={priority} sizes="(max-width: 700px) 100vw, 760px" className="moment-hero" /> : null}
      {moment.supporting.length > 0 ? <PhotoStrip photos={moment.supporting} /> : null}
      {moment.morePhotoCount > 0 ? <p className="chapter-meta">这一天还有 {moment.morePhotoCount} 张照片在月末的档案里</p> : null}
    </div>
  </article>;
}
