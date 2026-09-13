// Editorial Composition Layer: how already-true, already-publishable material is selected, ordered
// and weighted for reading. Everything here is a pure, deterministic function over the chapter view
// model — it creates no facts, writes nothing, and re-judges no organizer decision. Archive truth
// (what exists) and publication truth (what passed the gates) are inputs; this layer only decides
// what a page leads with and what stays in the archive layer of the page.
//
// The reading unit is the PublicationMoment. The archive's real material comes in four honest
// shapes, and a moment never pretends to be a stronger shape than its evidence:
//
//   memory_led   a published LifeEvent — a story someone approved
//   text_led     a day whose published DailyTrace carries real words about the child
//   photo_led    a day that was only photographed
//   (quiet)      a photographed day that cannot carry a moment — folded to one line
//
// Two rules from the archive's ethics apply throughout:
//   - Same-day text and photographs share a date heading, never a caption: a moment's text block
//     and its photos are siblings under the day, and no photo is ever described by trace text.
//   - Publication privilege is provenance, not guesswork: a photograph may be shown at all only
//     when something real vouches for it (it is part of a published memory's own material, or it
//     came from the family's own photo archive or a conversation confirmed to be about this child).
//     An unvouched chat image reaches no reading surface and, since 2026-09-10, not the month's
//     photo section either — it stays in the archive itself, untouched and reachable, but a page
//     that calls something 「这个月的照片」 may not fill it with the chat stream. No content
//     detector is faked: this is who a picture came from, never what is in it.
import type { EditorialMemory, MediaRef, MonthChapter, PhotoDay } from "@/lib/memory-chapters";
import { isArchiveCountNote, isGarbageLifeEvent, memoryTitle } from "@/lib/memory-chapters";
import { containsTechnicalPlaceholder } from "@/lib/organizer/quality-review";
import { heroSized, thumbnailSized } from "@/lib/media/hero";
import { photographsFirst } from "@/lib/media/presentation";
import { calendarDayOf, calendarMonthOf } from "@/lib/timeline-dates";
import { formatDay, timeSignatureFor } from "@/lib/time-signature";
import type { LifeEvent } from "@/lib/types";

// Who vouches for a picture. `confirmed`: media of a published (quality-approved) memory.
// `trusted`: media that reached the archive from the family's own photo collection (Quark album
// originals — RawSource.sourceType "family_photo") rather than scraped from a chat stream.
// Built once per request in lib/family-archive.ts from rows that already exist.
// `checked` is the third and narrowest: a reviewer opened the file and recorded that it is a
// photograph of this child, with no story attached (lib/media/story-binding.ts
// checkedPhotoIdsFrom). It is optional — an archive with no such rows behaves exactly as before.
export type MediaPrivilege = { confirmed: ReadonlySet<string>; trusted: ReadonlySet<string>; checked?: ReadonlySet<string> };

export const NO_PRIVILEGE: MediaPrivilege = { confirmed: new Set(), trusted: new Set() };

export function isPrivileged(ref: Pick<MediaRef, "id">, privilege: MediaPrivilege): boolean {
  return privilege.confirmed.has(ref.id) || privilege.trusted.has(ref.id);
}

/**
 * Did a person open THIS picture and record what is in it (`media_subject_check`, approved, latest
 * decision winning — lib/media/story-binding.ts checkedPhotoIdsFrom).
 *
 * 2026-09-13. Why this became a gate rather than a tiebreak. `isPrivileged` answers "may this
 * picture be part of the month's photography", and its `trusted` half is a statement about the
 * SOURCE: `isTrustedPhotoSource()` looks at which album or which confirmed group a file arrived
 * from and, in its own words, "never what is in it". That was a sound rule while it only decided
 * what sat inside 「这个月的照片」, an album the family opens on purpose.
 *
 * It stopped being sound when publishing a story started moving photographs OUT of that album and
 * into the day's own group, which is default reading. Approving a paragraph of text then promoted
 * pictures nobody had looked at: measured across R1–R4, 85 photographs entered the initial HTML
 * and 211 became reachable, of which exactly 2 in the whole 601-photograph set carry a subject
 * check (exposure-evidence.json). Publishing words is not a review of pictures, and no amount of
 * source trust makes it one.
 *
 * So the surfaces that publication can move a picture INTO now ask for this, and only this. A
 * picture without it is not hidden, not rejected and not deleted — it stays in the album it was
 * already in, which is where it was before the story was published.
 */
export function isSubjectChecked(ref: Pick<MediaRef, "id">, privilege: MediaPrivilege): boolean {
  return Boolean(privilege.checked?.has(ref.id));
}

// A hero is a page-width image: it must be big enough AND vouched for.
export function heroEligibleRef(ref: MediaRef, privilege: MediaPrivilege): boolean {
  return heroSized(ref) && isPrivileged(ref, privilege);
}

// `trace` (P2, T22, 2026-09-06): a day whose only surviving material is a store_only LifeEvent —
// the Organizer read it, wrote a real one-line description of it, and judged it not significant
// enough to publish as a memory. Judged low ≠ not about the child (Cowork read 12 of 2025-06's 13
// store_only rows and 11 were ordinary真实 daily life: "妈妈夸小年白得逆光都不怕", "张小年今晚跟
// 小雪睡"). Before this tier such a day simply vanished into quietDays' "还有 N 天...零散的照片"
// sentence — the month's actual words were thrown away along with the ones that were noise. A trace
// moment is deliberately the thinnest possible claim: one line, the event's own short title, no
// photo (an unvouched picture still may not anchor anything — see photoLedMoment), no promotion to
// a bigger typeface. It is the low end of 原则五's weight ladder, not a second copy of 段落.
export type MomentKind = "memory_led" | "text_led" | "photo_led" | "trace";

export type PublicationMoment = {
  kind: MomentKind;
  day: string;
  dateLabel: string;
  ageLabel?: string;
  // memory_led only: the published memory (its own lead photo travels inside it).
  memory?: EditorialMemory;
  // text_led only: published trace entries, display-cleaned. Never rendered as captions.
  text: string[];
  // At most one page-width photograph, hero-eligible under `heroEligibleRef`.
  hero?: MediaRef;
  // Small photographs beside the moment, thumbnail-sized, one per burst.
  supporting: MediaRef[];
  // Photographs of the day beyond hero+supporting; they remain in the archive layer.
  morePhotoCount: number;
};

export type QuietDay = { day: string; dateLabel: string; photoCount: number };

export type MonthComposition = {
  month: string;
  // The month's strongest honest voice: it has readable material (memory), it has vouched
  // photography (photography), or its only readable face is typography (dates, counts, quiet).
  mode: "memory" | "photography" | "typography";
  // Worth actually reading: memory and text moments, first day of the month first. May be empty —
  // it is never padded to fill a layout.
  chapter: PublicationMoment[];
  // The feel of the month's time: photographed days as weighted moments, ascending.
  chronicle: PublicationMoment[];
  // Photographed days folded to one line each: they exist, the archive layer has them whole.
  quietDays: QuietDay[];
  // A day that carries a chapter moment keeps its photographs on that day, shown after the day's
  // stories as 「这一天的照片」 rather than at the far end of the month. Ascending; a day appears
  // here or in `archiveDays`, never both, so no picture is shown twice or lost between them.
  //
  // These are the same rows `archiveDays` would have carried — the identical vouched, deliverable,
  // drawable set from `albumPhotosByDay`. Moving a day here changes where the month's photography
  // is read, never which pictures are eligible to be read: per-photo visibility, deliverability and
  // source vouching are all decided upstream and are not re-opened by this grouping.
  //
  // It is deliberately not a story binding. The group renders outside the story's card under a
  // neutral date heading, and a story that says it has no photograph still has none inside it —
  // 「这一天的照片」 claims the day, never the story.
  dayPhotoGroups: PhotoDay[];
  // The month's photographs — vouched, deliverable and drawable — day by day, ascending, for the
  // days that did not get a group of their own above. This is what 「这个月的照片」 shows, and what
  // `archiveFoldedPhotoCount` is measured against. It is a display set, not the archive: unvouched
  // rows are absent here and unchanged in the database.
  archiveDays: PhotoDay[];
  // T20-A3: the subset of archiveDays actually rendered by default — a screenful (photo-days that
  // already carry a published moment first, then newest), ascending for reading order. The rest is
  // real and reachable (archiveFoldedPhotoCount says how much), just not shipped unasked.
  archiveDaysVisible: PhotoDay[];
  archiveFoldedPhotoCount: number;
  archiveFoldedDayCount: number;
  // Vouched, deliverable rows too small to draw at all (20x20 icons, 67x120 sticker thumbs):
  // counted, never rendered, never deleted. Unvouched rows are not counted here — they are not
  // being withheld for their size.
  smallImageCount: number;
  // The month's face for index surfaces. Only a vouched photograph or a memory's own lead may be
  // it; a month with neither shows type, not a guessed picture.
  cover?: MediaRef;
  // cover + up to two more vouched pictures from other days/bursts, for index strips.
  preview: MediaRef[];
  // A restrained publication sentence for a month whose chapter is empty, built ONLY from facts
  // the archive holds (that days were photographed, that no organized words exist yet). Never a
  // guess at what the photos show, never emotion, never a milestone. A month with readable
  // moments needs no narration — its own words open it.
  narration?: string;
  // V4 (T16, 2026-09-04), widened B-17 (2026-09-06): a standfirst for a month that DOES have a
  // chapter — the count a magazine's opening line states before the story starts. Days = how many
  // distinct days carry a moment across `chapter` AND `chronicle` (memory_led, text_led, photo_led,
  // trace) — the same set the page renders below the masthead, so the sentence never claims fewer
  // days than a reader can actually count.
  daysWithWords: number;
  totalPhotoCount: number;
};

// Bounds. Editorial policy, not facts about current data.
// Retired 2026-09-06 (B-17 acceptance): capping the chronicle to this many moments folded vouched,
// deliverable photo days to bare quiet-day lines once a month had more than a handful of them —
// recreating the empty-date-list problem this whole layer exists to fix. Kept so nothing that
// imports it breaks; no code path caps the chronicle any more.
export const CHRONICLE_MOMENTS_MAX = 10;
export const MOMENT_SUPPORTING_MAX = 2;
// Retired 2026-09-04 with the wordless-month exception (see photoLedMoment). Kept so nothing that
// imports it breaks; no code path builds an unvouched strip any more.
export const UNVOUCHED_STRIP_MAX = 3;
export const MOMENT_TEXT_MAX = 6;
export const PREVIEW_PHOTOS_MAX = 3;
// T20-A3: the month-end archive's default first-screen budget, in photos.
export const ARCHIVE_FIRST_SCREEN_MAX = 24;
export const BURST_GAP_SECONDS = 90;

// Temporal burst grouping over one day's photos (takenAt ascending, as PhotoDay guarantees).
// Nearness in time is treated as redundancy — several shutter presses at one scene — so a burst
// lends the reading layer one representative; every member stays in the archive layer. This is
// explicitly NOT duplicate detection: no visual similarity is claimed and nothing is discarded.
export function burstGroups(photos: MediaRef[]): MediaRef[][] {
  const groups: MediaRef[][] = [];
  let current: MediaRef[] = [];
  let lastTime: number | undefined;
  for (const photo of photos) {
    const time = photo.takenAt ? Date.parse(photo.takenAt) : undefined;
    const sameBurst = time !== undefined && lastTime !== undefined && time - lastTime <= BURST_GAP_SECONDS * 1000;
    if (current.length > 0 && !sameBurst) { groups.push(current); current = []; }
    current.push(photo);
    lastTime = time ?? lastTime;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// One drawable representative per burst: the first hero-sized member, else the first
// thumbnail-sized member. A burst of only tiny images represents nothing.
export function burstRepresentatives(photos: MediaRef[]): MediaRef[] {
  return burstGroups(photos)
    .map((group) => group.find(heroSized) ?? group.find(thumbnailSized))
    .filter((item): item is MediaRef => Boolean(item));
}

// Trace entries a reader should see: the belt-and-braces placeholder gate plus the archive-count
// sentence ("这一天留下了 N 张照片"), which describes the archive, not the child.
export function readableEntries(entries: string[]): string[] {
  return entries.filter((entry) => typeof entry === "string" && entry.trim().length > 0 && !containsTechnicalPlaceholder(entry) && !isArchiveCountNote(entry));
}

// A photographed day earns a reading moment only when a vouched hero can anchor it. A day of
// pictures nothing vouches for — chat-stream images that could as easily be a screenshot as a
// scene — folds to a quiet line and stays whole in the archive layer, rather than becoming the
// month's main matter by default.
function photoLedMoment(day: PhotoDay, privilege: MediaPrivilege): PublicationMoment | undefined {
  const representatives = burstRepresentatives(day.photos);
  const hero = representatives.find((item) => heroEligibleRef(item, privilege));
  // Vouching is the whole gate. A wordless month used to be allowed to read its days as strips of
  // unvouched pictures, on the reasoning that photographs were the only record it kept — but
  // 2025-01 published three Facebook Marketplace listings and a feeding-volume infographic under
  // that exception, and not one picture of the child. A chat stream's images are as likely to be a
  // screenshot, a forward, or a product listing as a photograph, and size cannot tell them apart:
  // a phone screenshot is large and near-portrait, exactly like a photo. An empty month is honest;
  // a month of advertisements is not. Teddy, 2026-09-04: 宁可没有照片，不要错的东西.
  if (!hero) return undefined;
  const supporting = representatives.filter((item) => item !== hero && isPrivileged(item, privilege) && thumbnailSized(item)).slice(0, MOMENT_SUPPORTING_MAX);
  return {
    kind: "photo_led",
    day: day.day,
    dateLabel: day.dateLabel,
    ageLabel: day.ageLabel,
    text: [],
    hero,
    supporting,
    morePhotoCount: Math.max(0, day.photos.length - (hero ? 1 : 0) - supporting.length),
  };
}

// WHICH PICTURE MAY OPEN 「这个月的日子」 (Teddy's decision, 2026-09-11).
//
// Every day in that section carries a page-width photograph, but the first one is read differently
// from the rest: it sits directly under the section's own heading, so a reader meets it as "this is
// what this month looked like" before meeting any single day. On 2025-11 the picture in that slot
// was a white cat on a bench — a real photograph from the family's own album, vouched for exactly
// as the rule asked, and not a picture of him. Source trust is the only thing `trusted` can say
// (see MediaPrivilege): the album is the family's, so the cat passes.
//
// The opening slot therefore asks for a claim source trust cannot make, and there are exactly two:
//   - `confirmed` — the picture is part of the material a published story was written from, was
//     bound to that story's own sentence, or a reviewer opened it and recorded that it belongs to
//     that story (lib/media/story-binding.ts, Bases A/B/C);
//   - `checked` — a reviewer opened the file and recorded that it is a photograph of this child,
//     with no story attached (checkedPhotoIdsFrom). Most of this archive's photography belongs to
//     no words at all, and without this second route a month that was only photographed could never
//     open with a picture anybody vouched for by looking at it.
// Both are records of somebody having looked. Neither can be produced by where a file came from.
//
// Nothing here looks at what is in a frame. There is no person detector, no face match, no "is this
// him" — the cat is refused the opening slot for the same reason a perfectly good photograph of him
// with no recorded reason is: the archive cannot say why it belongs there. And nothing is deleted or
// hidden: a demoted day keeps every one of its photographs under its own date in 「这个月的照片」
// (`archiveDays` below already holds them — a chronicle day's pictures were always there), and it is
// named in the quiet-day line above that section, so the cat is still one click from where it was.
// 2026-09-13: `confirmed` no longer opens this section either. It used to, on the reading that
// Bases A/B/C are all "somebody vouched" — but A is arrival position and B is the Organizer's own
// adoption, neither of which is a person looking at a frame, and even C says only that a picture
// belongs to some words. The page-width opening slot is a claim about what the picture IS, and
// `media_subject_check` is the one record that makes it (总指挥: 故事绑定不能替代主体/内容审核).
function chronicleLeadEligible(moment: PublicationMoment, privilege: MediaPrivilege): boolean {
  if (!moment.hero) return false;
  return isSubjectChecked(moment.hero, privilege);
}

// Walk the section's head until something may open it: a day whose picture carries the stronger
// claim, or a day with words (无合适图就文字开头 — a day that says something opens with what it
// says, and its own photographs read below, in the month's photo section, rather than page-width
// under the heading). A wordless day with no such picture cannot open the section and steps back
// into the month's photography; the next day is asked the same question.
//
// Only the head. Once the section has an opening, every day below it is unchanged — those pictures
// are the month's own photography, presented as the days they were taken on, and they keep the
// vouching rule they have always had.
//
// The one case this leaves alone entirely: a month where no day has words and no picture is
// confirmed. Emptying that section would take away the only face the month has and leave a page of
// folded photographs behind a summary line, which is a worse answer than the one this fixes. The
// month keeps its days; the shortfall is real and is reported rather than papered over.
export function openChronicle(chronicle: PublicationMoment[], privilege: MediaPrivilege): PublicationMoment[] {
  if (!chronicle.some((moment) => chronicleLeadEligible(moment, privilege) || moment.text.length > 0)) return chronicle;
  const opened = [...chronicle];
  while (opened.length > 0) {
    const head = opened[0];
    if (chronicleLeadEligible(head, privilege)) break;
    if (head.text.length > 0) {
      opened[0] = { ...head, hero: undefined, supporting: [], morePhotoCount: head.morePhotoCount + (head.hero ? 1 : 0) + head.supporting.length };
      break;
    }
    opened.shift();
  }
  return opened;
}

// `pickDayPhotos` lived here until 2026-09-10. It answered "which of this day's photographs should
// be set beside this day's words", and every story image the site ever showed came from it —
// including the ones scripts/t18-backfill-media-binding.mjs then wrote into life_events.media_ids
// and hero_media_id, which is why that column cannot be read as evidence today. Removed rather
// than left available: its inputs were the day, the size, the source's trustworthiness and the
// sort order, and no combination of those is a reason to tell a reader that a picture belongs to a
// story. What replaced it is lib/media/story-binding.ts, which asks whether the photograph is part
// of the material the story was written from. Day-level photography still reaches the page through
// photoLedMoment (a day that was only photographed, standing as itself) and through the month's
// own photo section.

export type TraceNote = { day: string; dateLabel: string; ageLabel?: string; text: string };

// The trace tier's data source, isolated in one function per the P2 dispatch note ("数据源抽成一个
// 函数，方便一行切换"): today `events` is the store_only 全集 (family-archive.ts filters the ledger
// to decision === "store_only" and hands the whole set here) because A-6's subject-confirmed subset
// has not landed yet. When it does, family-archive.ts narrows `events` to that subset before calling
// this — nothing here or in buildMonthComposition needs to change.
export function buildTraceNotes(events: LifeEvent[], birthDay?: string): TraceNote[] {
  const notes: TraceNote[] = [];
  for (const event of events) {
    const day = calendarDayOf(event.occurredAt);
    if (!day) continue;
    if (isGarbageLifeEvent(event)) continue;
    const text = memoryTitle(event).trim();
    if (!text || containsTechnicalPlaceholder(text)) continue;
    notes.push({ day, dateLabel: formatDay(day), ageLabel: timeSignatureFor(event.occurredAt, birthDay)?.ageLabel, text });
  }
  return notes;
}

export function buildMonthComposition(chapter: MonthChapter, privilege: MediaPrivilege = NO_PRIVILEGE, traceEvents: LifeEvent[] = [], birthDay?: string): MonthComposition {
  const photoDaysAsc = [...chapter.photoDays].sort((a, b) => a.day.localeCompare(b.day));
  const traceByDay = new Map(chapter.traceDays.map((day) => [day.day, day]));

  // THE MONTH'S PHOTO SET — what 「这个月的照片」 may show, computed once so the first screen, the
  // expand-all payload (app/memory/[year]/[month]/actions.ts returns archiveDays straight from
  // here) and every count and date the page prints all describe the same set.
  //
  // 2026-09-10: this section used to show every deliverable, drawable picture the month held. Once
  // stories stopped borrowing photographs it became the month's main photographic surface and was
  // opened by default — and what that surfaced, alongside the child's days, was the chat stream's
  // screenshots: in 2026-08, 115 of 664 images came from conversations no one has vouched for,
  // including financial records. Calling those 「这个月的照片」 was wrong on its own terms.
  //
  // The gate is the same `isPrivileged` the day-level moments and the month cover already use —
  // the family's own photo archive, or a conversation Teddy confirmed is about this child. It is
  // deliberately NOT the hero size floor: an ordinary small snapshot is still one of the month's
  // photographs, so only the thumbnail floor (can it be drawn at all) applies below.
  //
  // What this is not: a content check. Source trust says who the picture came from, never what is
  // in it, so a sensitive image inside a trusted conversation would still pass here. It also
  // deletes nothing and hides nothing from the archive itself — every row stays exactly as it is,
  // reachable to scripts, audits and the evidence disclosure; this narrows one display surface.
  const albumPhotosByDay = new Map<string, MediaRef[]>();
  let smallImageCount = 0;
  for (const day of photoDaysAsc) {
    const vouched = day.photos.filter((item) => isPrivileged(item, privilege));
    const drawable = vouched.filter(thumbnailSized);
    // Counted among the vouched only: the sentence this feeds says these are too small to draw,
    // and an unvouched picture is not being withheld for its size.
    smallImageCount += vouched.length - drawable.length;
    // Reading order, not eligibility. Every drawable row stays in the day; the ones shaped like a
    // phone screen rather than like a photograph simply read after the photographs, because the
    // default preview is the first six and a reader opening 2025-11 met a full-page article capture
    // before any picture of him. See photographsFirst() for why this may only reorder.
    albumPhotosByDay.set(day.day, photographsFirst(drawable));
  }

  // CHAPTER — what is worth reading, in the order the month happened. Memories first within a day.
  //
  // 2026-09-10: a chapter moment no longer carries photographs of its own. It used to — T11 Part C
  // bound the day's first vouched photo to a memory that had none, and to a day's trace text, on
  // the reasoning that shared provenance on a shared day was close enough to shared subject. It is
  // not, and the page said otherwise to the reader: a page-wide picture directly under a story
  // reads as that story's picture, whatever the composition layer meant by it. 08-19 illustrated a
  // music story with a meal board that way, and 523 of the archive's 524 bound stories rest on the
  // same kind of selection. A memory's own lead still travels inside EditorialMemory, where it now
  // has to be part of the material the story was written from (lib/media/story-binding.ts). Every
  // other picture of the day keeps its place in the month's photo section, presented as the
  // month's photography rather than as anyone's illustration — nothing is deleted or unbound.
  const chapterMoments: PublicationMoment[] = [];
  for (const memory of [...chapter.memories].sort((a, b) => a.signature.day.localeCompare(b.signature.day))) {
    chapterMoments.push({
      kind: "memory_led",
      day: memory.signature.day,
      dateLabel: memory.signature.dateLabel,
      ageLabel: memory.signature.ageLabel,
      memory,
      text: [],
      hero: undefined,
      supporting: [],
      morePhotoCount: 0,
    });
  }
  // A day's trace text reads on its own, for the same reason a memory does. The old argument here
  // was that a daycare-group photo beside daycare-group text on one day shares provenance, so it is
  // not a guess — but shared provenance says the picture and the sentence came from the same place,
  // never that the picture shows what the sentence says. Set directly under the words it still
  // reads as their illustration. The day's photographs are in the month's photo section.
  for (const traceDay of [...chapter.traceDays].sort((a, b) => a.day.localeCompare(b.day))) {
    const text = readableEntries(traceDay.entries).slice(0, MOMENT_TEXT_MAX);
    if (text.length === 0) continue;
    const photoDay = photoDaysAsc.find((day) => day.day === traceDay.day);
    chapterMoments.push({
      kind: "text_led",
      day: traceDay.day,
      dateLabel: traceDay.dateLabel,
      ageLabel: photoDay?.ageLabel,
      text,
      hero: undefined,
      supporting: [],
      morePhotoCount: 0,
    });
  }
  const kindRank = (moment: PublicationMoment) => (moment.kind === "memory_led" ? 0 : 1);
  chapterMoments.sort((a, b) => a.day.localeCompare(b.day) || kindRank(a) - kindRank(b));

  // TRACE — A-6's subject-confirmed store_only days (see buildTraceNotes), grouped by day. A day
  // whose real words already reached the chapter (a memory, or an approved DailyTrace) does not
  // also get a trace line: that would be a second, weaker copy of something already told. Same-day
  // notes are never deduplicated to one: B-17 acceptance (2026-09-06) caught "妈妈夸小年白得逆光都
  // 不怕" — the sentence the trace tier exists to keep — silently dropped because another store_only
  // event landed on the same day and won a last-write-wins Map.set(). A day can carry more than one
  // trace line; nothing about a good sentence justifies losing it to a scheduling accident.
  const memoryDays = new Set(chapter.memories.map((memory) => memory.signature.day));
  const chapterDays = new Set(chapterMoments.map((moment) => moment.day));
  const monthTraceEvents = traceEvents.filter((event) => calendarMonthOf(event.occurredAt) === chapter.month);
  const traceNotesByDay = new Map<string, TraceNote[]>();
  for (const note of buildTraceNotes(monthTraceEvents, birthDay)) {
    if (memoryDays.has(note.day) || chapterDays.has(note.day)) continue;
    const existing = traceNotesByDay.get(note.day);
    if (existing) existing.push(note);
    else traceNotesByDay.set(note.day, [note]);
  }

  // CHRONICLE — the photographed days not already read in the chapter: every day with a vouched
  // hero becomes a moment, ascending. There used to be a CHRONICLE_MOMENTS_MAX cap here, folding
  // the overflow to quiet lines — but a vouched, deliverable photo is exactly a day's content, and
  // capping it recreated the empty-date-list problem B-17 exists to fix (2026-09-06 acceptance:
  // 6/8, 6/13, 6/14... had real vouched photos and were still rendering as bare dates because the
  // cap filled up before reaching them). Quiet days are now only what the archive's own ethics
  // already required folding: a photographed day nothing vouches for (photoLedMoment's hero gate).
  // A day with words in the chapter may still earn a photo moment here — the two sections make
  // no claim on each other. Only memory days are excluded: their photographs already read inside
  // the memory itself.
  // A day whose words are already in the chapter is not also a chronicle moment or a quiet line:
  // its photographs are shown right under those words as 「这一天的照片」 (dayPhotoGroups below).
  // Before that group existed only memory days were excluded here, so a text_led day was read
  // twice — once for its sentences in the chapter, once as a photo moment down in the chronicle.
  const candidates = photoDaysAsc.filter((day) => !chapterDays.has(day.day));
  const scored = candidates
    .map((day) => ({ day, moment: photoLedMoment(day, privilege) }))
    .filter((item): item is { day: PhotoDay; moment: PublicationMoment } => Boolean(item.moment));
  // A photographed day that also has trace notes absorbs all of them as text.
  for (const item of scored) {
    const notes = traceNotesByDay.get(item.day.day);
    if (!notes) continue;
    item.moment.text = notes.map((note) => note.text);
    traceNotesByDay.delete(item.day.day);
  }
  scored.sort((a, b) => a.day.day.localeCompare(b.day.day));
  const chronicleFromPhotos = scored.map((item) => item.moment);
  // Trace-only days: no photographed day at all, or none with a vouched hero — the notes are the
  // day's whole content. Never capped: a sentence costs nothing to show, and capping it would
  // recreate the exact disappearance this tier exists to fix (原则七: "去掉所有数字后仍能读出这个月
  // 的张年" fails if the month's actual sentences are the ones left out).
  const traceOnly: PublicationMoment[] = [...traceNotesByDay.entries()]
    .map(([day, notes]) => ({ kind: "trace" as const, day, dateLabel: notes[0].dateLabel, ageLabel: notes[0].ageLabel, text: notes.map((note) => note.text), supporting: [], morePhotoCount: 0 }));
  const chronicle = openChronicle([...chronicleFromPhotos, ...traceOnly].sort((a, b) => a.day.localeCompare(b.day)), privilege);
  const chronicleDays = new Set(chronicle.map((moment) => moment.day));
  // A quiet day's line says its photographs are down in 「这个月的照片」, so it may only be printed
  // for a day that actually has some there.
  const quietDays: QuietDay[] = candidates
    .filter((day) => !chronicleDays.has(day.day))
    .map((day) => ({ day: day.day, dateLabel: day.dateLabel, photoCount: (albumPhotosByDay.get(day.day) ?? []).length }))
    .filter((day) => day.photoCount > 0);

  // DAY GROUPS — a chapter day's own photographs, kept on the day instead of at the end of the
  // month. A reader who has just read what 8/19 left behind can see 8/19's pictures without
  // crossing the rest of August to reach them; measured on 2026-08 before this, the eleven days
  // that carry stories held 284 of the month's 549 photographs and every one of them sat below the
  // whole chronicle, inside a section that ships folded.
  //
  // Same rows, same gates: `albumPhotosByDay` is the one vouched/deliverable/drawable set the
  // archive is built from, so grouping cannot surface a picture the month's photo section would
  // have withheld.
  // A picture the card actually draws is not drawn again directly underneath it. What a month-page
  // story renders is exactly `memory.lead` — one photograph (components/editorial-memory.tsx; a
  // chapter moment's own hero/supporting have been empty since 2026-09-10) — so that, and only
  // that, is held back. Deliberately NOT "everything bound" or "everything Basis A associated": a
  // second associated picture the card had no room for, and anything the old same-day backfill
  // bound, are still the day's and must stay findable under 「这一天的照片」 rather than nowhere.
  // A story reviewed as noPhoto draws nothing, so it holds nothing back either.
  //
  // Scope of the guarantee: the group never repeats what a card drew, and the group and the photo
  // section never overlap. It is not a page-wide uniqueness claim — one photograph written from by
  // two stories is drawn by both cards, which is correct, since it really is each story's picture.
  // 照片展示隔离 (总指挥, 2026-09-13). The group is now built from the day's SUBJECT-CHECKED
  // photographs only, and it is the whole reason this function changed.
  //
  // What was wrong: membership of this group was decided by `chapterDays` — by whether the day had
  // acquired published words. Everything else about the picture was `isPrivileged`, i.e. source
  // trust. So approving a paragraph promoted that day's photographs from the album into default
  // reading, without anybody having looked at a single one of them.
  //
  // The fix is not a list and not a date rule: a photograph enters the day group when a person has
  // opened it and recorded what is in it, and at no other time. Publishing text can no longer move
  // any picture anywhere.
  //
  // Where the rest go: back into `archiveDays` — 「这个月的照片」, the album they were already in
  // before the story was published, at the same day, under the same source authorisation, reachable
  // by the same expander. Nothing is hidden, nothing is rejected, nothing is deleted, no visibility
  // changes. A day may now appear in BOTH places — its checked pictures beside its words, the rest
  // in the album — so the split below is per photograph rather than per day.
  const chapterLeadIds = new Set(chapter.memories.map((memory) => memory.lead?.id).filter(Boolean) as string[]);
  const dayPhotoGroups: PhotoDay[] = [];
  const groupedPhotoIds = new Set<string>();
  for (const day of photoDaysAsc) {
    if (!chapterDays.has(day.day)) continue;
    const photos = (albumPhotosByDay.get(day.day) ?? [])
      .filter((item) => !chapterLeadIds.has(item.id))
      .filter((item) => isSubjectChecked(item, privilege));
    if (photos.length > 0) {
      dayPhotoGroups.push({ ...day, photos });
      for (const item of photos) groupedPhotoIds.add(item.id);
    }
  }

  // ARCHIVE — the month's remaining photographs, ascending; days read morning to evening already.
  // Built from the one album set above minus the photographs already read elsewhere on the page, so
  // nothing here can disagree with the first screen or the expander, and no picture is reachable
  // from two places at once. Subtracting PHOTOGRAPHS rather than whole days is what lets an
  // unchecked picture stay in the album on a day whose checked pictures were lifted out of it.
  //
  // `chapterLeadIds` has to be subtracted explicitly now, and that is a real trap this replaced.
  // While a chapter day was excluded from the album WHOLESALE, a story's own lead was kept out of
  // here as a side effect of its day being kept out. Subtracting per photograph removed that side
  // effect, and the picture the story card draws came straight back into 「这个月的照片」 — the same
  // photograph twice on one screen, which is exactly what the day group was built to stop.
  const readInChapter = new Set([...groupedPhotoIds, ...chapterLeadIds]);
  const archiveDays: PhotoDay[] = [];
  for (const day of photoDaysAsc) {
    const photos = (albumPhotosByDay.get(day.day) ?? []).filter((item) => !readInChapter.has(item.id));
    if (photos.length > 0) archiveDays.push({ ...day, photos });
  }

  // T20-A3 (原则五, "大部分内容默认不出现"): 507 photos flat in one page was the whole point being
  // violated — everything shipped in the initial HTML whether the reader asked for it or not. The
  // full archive is still real (archiveDays, unchanged) and still countable; archiveDaysVisible is
  // what actually ships in the first render, capped to a screenful. Priority: a day that already
  // carries a published moment (chapter/chronicle) first — its photos are the ones a reader who
  // just read that day's words would want to see next — then newest first for the rest.
  const referencedDays = new Set([...chapterMoments, ...chronicle].map((moment) => moment.day));
  const archiveDaysRanked = [...archiveDays].sort((a, b) =>
    Number(referencedDays.has(b.day)) - Number(referencedDays.has(a.day)) || b.day.localeCompare(a.day));
  //
  // Whole days only, and this matters for more than tidiness. The first screen used to be filled to
  // exactly ARCHIVE_FIRST_SCREEN_MAX by slicing whichever day ran over — and ArchiveExpander asks
  // for "the days you have not shown me" by day key, so the rest of that sliced day was never
  // requested and never reachable. Measured on 2026-08 before this fix: the section offered "还有
  // 28 天、525 张照片", and expanding delivered 498 — the remaining 27 pictures of a partially shown
  // day existed, were counted, and could not be opened by any means the page provided. A day is the
  // unit the reader browses by, so it is the unit the budget spends. The first ranked day is always
  // taken whole, even if it alone is over budget: a month must show something, and every image here
  // is lazy, so a long day costs DOM nodes rather than bandwidth.
  const archiveDaysVisible: PhotoDay[] = [];
  let visiblePhotoCount = 0;
  for (const day of archiveDaysRanked) {
    if (archiveDaysVisible.length > 0 && visiblePhotoCount + day.photos.length > ARCHIVE_FIRST_SCREEN_MAX) break;
    archiveDaysVisible.push(day);
    visiblePhotoCount += day.photos.length;
  }
  archiveDaysVisible.sort((a, b) => a.day.localeCompare(b.day));
  const visibleCountByDay = new Map(archiveDaysVisible.map((day) => [day.day, day.photos.length]));
  const archiveFoldedPhotoCount = archiveDays.reduce((sum, day) => sum + day.photos.length, 0) - visiblePhotoCount;
  const archiveFoldedDayCount = archiveDays.filter((day) => (visibleCountByDay.get(day.day) ?? 0) < day.photos.length).length;

  // COVER / PREVIEW — vouched pictures only, newest first so the index face matches the month's
  // latest life; a memory's own lead outranks loose photography.
  // 2026-09-13: the index face asks for a subject check, and a story binding does NOT substitute
  // for one. `memoryLead` reaches here having passed the story gate — a person decided that
  // picture belongs beside those words — and that is a different claim from "this is a photograph
  // of this child, fit to be the month's face on the front page and the year index". R8's
  // `event-r10-20260907-coldhot` is exactly the case: its two photographs carry an approved
  // `media_binding` and no `media_subject_check`, so they may illustrate that story and may not
  // become 2026-09's cover. A month with nothing checked shows its type instead, which
  // `mode: "typography"` already does — it does not fall back to a guessed picture.
  const memoryLead = chapter.memories.find((memory) => memory.lead)?.lead;
  const vouched: MediaRef[] = [];
  for (const day of [...photoDaysAsc].reverse()) {
    for (const item of burstRepresentatives(day.photos)) {
      if (heroEligibleRef(item, privilege) || (isPrivileged(item, privilege) && thumbnailSized(item))) vouched.push(item);
    }
  }
  const coverCandidate = memoryLead && isSubjectChecked(memoryLead, privilege) ? memoryLead : undefined;
  const cover = coverCandidate ?? vouched.find((item) => heroEligibleRef(item, privilege) && isSubjectChecked(item, privilege));
  // The preview strip is the cover's own shortlist — the same index surfaces, the same claim — so
  // it asks the same question of every picture in it, not only of the first.
  const preview: MediaRef[] = [];
  const seen = new Set<string>();
  for (const item of [cover, ...vouched]) {
    if (!item || seen.has(item.id)) continue;
    if (!isSubjectChecked(item, privilege)) continue;
    seen.add(item.id);
    preview.push(item);
    if (preview.length >= PREVIEW_PHOTOS_MAX) break;
  }

  const mode: MonthComposition["mode"] = chapter.memories.length > 0 ? "memory" : cover ? "photography" : "typography";
  // Says only what is true and where it is. The old sentence — the days 留在了照片里 — read as a
  // promise that the page was about to show them; nothing vouched, nothing shows, and the reader
  // was left looking for pictures that were folded away.
  const archivePhotoCount = archiveDays.reduce((sum, day) => sum + day.photos.length, 0);
  const narration = chapterMoments.length === 0 && chronicle.length === 0 && archivePhotoCount > 0
    ? `这个月还没有整理出来的文字。${photoDaysAsc.length} 天留下了 ${archivePhotoCount} 张照片，都收在月末的档案里，还没有人确认过它们拍的是什么。`
    : undefined;
  // B-17 acceptance (2026-09-06): this used to count only chapterMoments (memory_led/text_led) —
  // once the chronicle stopped folding vouched photo days and trace days to quiet lines, that made
  // the masthead say "记下 1 天" over a page that visibly listed ten. The opening line has to count
  // the same days the page actually shows: every day with a moment, chapter or chronicle alike.
  const daysWithWords = new Set([...chapterMoments, ...chronicle].map((moment) => moment.day)).size;
  // The month's photographs, counted where they actually are: the one album set, independent of
  // which surface reads each picture (a day group, the photo section, or a story's own lead).
  // Counting `archiveDays` alone would have quietly dropped every picture that moved onto a story
  // day — 284 of 2026-08's 549.
  let albumPhotoCount = 0;
  for (const photos of albumPhotosByDay.values()) albumPhotoCount += photos.length;
  return { month: chapter.month, mode, chapter: chapterMoments, chronicle, quietDays, dayPhotoGroups, archiveDays, archiveDaysVisible, archiveFoldedPhotoCount, archiveFoldedDayCount, smallImageCount, cover, preview, narration, daysWithWords, totalPhotoCount: albumPhotoCount };
}

// V4 (T16, 2026-09-04), corrected by T21 (Cowork, 2026-09-04): the original draft also stated the
// month's photo count — "收进 M 张照片" — reasoning that a bare number carried no judgment, so it
// was zero-risk. That reasoning was wrong: 原则三 names "用 X 张照片 / Y 条消息代替内容本身" as the
// violation, verbatim, and 原则七 says a month's opening line is answering "what changed", never a
// photo/message/event count. The photo count is the archive describing itself, not a fact about
// the child — dropped. `totalPhotoCount` stays a MonthComposition field (T20-B's "这个月的张年"
// paragraph replaces this whole line; until then, silence is safer than a number in "违反 by
// design" territory).
export function monthStandfirst(daysWithWords: number): string | undefined {
  if (daysWithWords > 0) return `这个月记下 ${daysWithWords} 天。`;
  return undefined;
}
