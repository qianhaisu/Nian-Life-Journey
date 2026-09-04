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
//
// V1 (T16, 2026-09-04): the chapter masthead already states the month's age once ("当时 1 岁 6 个
// 月"). Printing the same label on every day turned a month into twenty repeats of one fact — a
// magazine does not restate its issue date under every article. `monthAgeLabel` is that one
// statement; a day only prints its own age when it actually differs (the days that cross a
// "岁/个月" boundary within the month).
export function DayHead({ day, dateLabel, ageLabel, monthAgeLabel, year }: { day: string; dateLabel: string; ageLabel?: string; monthAgeLabel?: string; year: string }) {
  const showAge = ageLabel && ageLabel !== monthAgeLabel;
  return <p className="month-day-date"><time dateTime={day}>{dayLabel(dateLabel, year)}</time>{showAge ? <span>{ageLabel}</span> : null}</p>;
}

// One moment of the month, read start to finish: its date, its words if the archive wrote any,
// then its photographs. Text and pictures share the day; the text never captions a picture.
// Every kind gets the same shape — running head, then body — so a month reads as one column of
// days rather than as alternating card designs. A published memory keeps its own title and lead
// inside the body; its date is already stated by the head, so it does not repeat it.
// `continued` is the second moment of a day the reader is already inside (a memory and that same
// day's words): the head is stated once and the block reads on under it.
export function MonthMoment({ moment, year, monthAgeLabel, priority = false, continued = false }: { moment: PublicationMoment; year: string; monthAgeLabel?: string; priority?: boolean; continued?: boolean }) {
  return <article className={`month-moment moment-${moment.kind}${moment.hero ? " moment-with-hero" : ""}${continued ? " moment-continued" : ""}`}>
    {continued ? null : <DayHead day={moment.day} dateLabel={moment.dateLabel} ageLabel={moment.ageLabel} monthAgeLabel={monthAgeLabel} year={year} />}
    <div className="moment-body">
      {/* T20-A1: DayHead just stated this day's date and age — a memory here does not restate them. */}
      {moment.kind === "memory_led" && moment.memory ? <EditorialMemory memory={moment.memory} priority={priority} showSignature={false} /> : null}
      {/* One entry, one paragraph: each is a separate record of the archive and keeps its own line.
          The day still reads through in one go because they are set as consecutive paragraphs of
          prose, not because any two of them were joined. */}
      {moment.text.length > 0 ? <div className="moment-text serif">{moment.text.map((entry, index) => <p key={index}>{entry}</p>)}</div> : null}
      {moment.hero ? <Photo media={moment.hero} priority={priority} sizes="(max-width: 700px) 100vw, 760px" className="moment-hero" /> : null}
      {moment.supporting.length > 0 ? <PhotoStrip photos={moment.supporting} /> : null}
      {/* T20-A2: T16 V2's "还有 N 张照片在月末的档案里" printed on nearly every day once T11 Part C
          started binding a hero to most days — a count-of-photos sentence on every day is exactly
          the "计数式描述" 原则三 rules out. The month-end archive section already says this once. */}
    </div>
  </article>;
}
