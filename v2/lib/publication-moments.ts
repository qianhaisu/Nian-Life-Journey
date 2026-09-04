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
//   - Publication privilege is provenance, not guesswork: a large photograph may lead a page only
//     when something real vouches for it (it belongs to a published memory, or it came from the
//     family's own photo archive). An unvouched WeChat image can appear small and can live in the
//     archive layer, but never becomes a hero or a month's face. No content detector is faked.
import type { EditorialMemory, MediaRef, MonthChapter, PhotoDay } from "@/lib/memory-chapters";
import { isArchiveCountNote } from "@/lib/memory-chapters";
import { containsTechnicalPlaceholder } from "@/lib/organizer/quality-review";
import { heroSized, thumbnailSized } from "@/lib/media/hero";

// Who vouches for a picture. `confirmed`: media of a published (quality-approved) memory.
// `trusted`: media that reached the archive from the family's own photo collection (Quark album
// originals — RawSource.sourceType "family_photo") rather than scraped from a chat stream.
// Built once per request in lib/family-archive.ts from rows that already exist.
export type MediaPrivilege = { confirmed: ReadonlySet<string>; trusted: ReadonlySet<string> };

export const NO_PRIVILEGE: MediaPrivilege = { confirmed: new Set(), trusted: new Set() };

export function isPrivileged(ref: Pick<MediaRef, "id">, privilege: MediaPrivilege): boolean {
  return privilege.confirmed.has(ref.id) || privilege.trusted.has(ref.id);
}

// A hero is a page-width image: it must be big enough AND vouched for.
export function heroEligibleRef(ref: MediaRef, privilege: MediaPrivilege): boolean {
  return heroSized(ref) && isPrivileged(ref, privilege);
}

export type MomentKind = "memory_led" | "text_led" | "photo_led";

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
  // Every deliverable, drawable photograph of the month, day by day, ascending — the full record.
  archiveDays: PhotoDay[];
  // Deliverable rows too small to draw at all (20x20 icons, 67x120 sticker thumbs): counted, never
  // rendered, never deleted.
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
  // V4 (T16, 2026-09-04): a standfirst for a month that DOES have a chapter — the two counts a
  // magazine's opening line states before the story starts. Days = how many distinct days actually
  // carry words in `chapter` (memory_led + text_led; a photo-only day was never "记下"). Photos =
  // every deliverable picture the month holds, chapter and archive layer alike.
  daysWithWords: number;
  totalPhotoCount: number;
};

// Bounds. Editorial policy, not facts about current data.
export const CHRONICLE_MOMENTS_MAX = 10;
export const MOMENT_SUPPORTING_MAX = 2;
// Retired 2026-09-04 with the wordless-month exception (see photoLedMoment). Kept so nothing that
// imports it breaks; no code path builds an unvouched strip any more.
export const UNVOUCHED_STRIP_MAX = 3;
export const MOMENT_TEXT_MAX = 6;
export const PREVIEW_PHOTOS_MAX = 3;
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

// Pick hero + supporting photos from a PhotoDay for text/memory moments. Only privileged photos
// are candidates — unvouched chat images cannot anchor a reading moment's photography slot.
// excludeIds: hero IDs already claimed by another moment on the same day (T11 Part C: avoid
// showing the same photo in both memory_led and text_led slots on the same day).
//
// Exported (T18, 2026-09-04): this is now also the backfill/write-time binding used to persist
// media_ids/heroMediaId onto a life_event row (scripts/t18-backfill-media-binding.mjs) — the same
// function, not a re-implementation, is what keeps the month page, the event detail page and the
// home page showing the same picture for the same day.
export function pickDayPhotos(photoDay: PhotoDay | undefined, privilege: MediaPrivilege, excludeIds?: ReadonlySet<string>): { hero?: MediaRef; supporting: MediaRef[]; morePhotoCount: number } {
  if (!photoDay) return { hero: undefined, supporting: [], morePhotoCount: 0 };
  const reps = burstRepresentatives(photoDay.photos);
  const eligible = reps.filter((r) => !excludeIds?.has(r.id));
  const hero = eligible.find((r) => heroEligibleRef(r, privilege));
  const supporting = eligible.filter((r) => r !== hero && isPrivileged(r, privilege) && thumbnailSized(r)).slice(0, MOMENT_SUPPORTING_MAX);
  const shownCount = (hero ? 1 : 0) + supporting.length;
  return { hero, supporting, morePhotoCount: Math.max(0, photoDay.photos.length - shownCount) };
}

export function buildMonthComposition(chapter: MonthChapter, privilege: MediaPrivilege = NO_PRIVILEGE): MonthComposition {
  const photoDaysAsc = [...chapter.photoDays].sort((a, b) => a.day.localeCompare(b.day));
  const traceByDay = new Map(chapter.traceDays.map((day) => [day.day, day]));

  // CHAPTER — what is worth reading, in the order the month happened. Memories first within a day.
  const chapterMoments: PublicationMoment[] = [];
  // Track which photo IDs have been claimed by memory_led moments, so text_led moments on the
  // same day don't repeat the same hero. Keyed by day string.
  const heroClaimedOnDay = new Map<string, string>();
  for (const memory of [...chapter.memories].sort((a, b) => a.signature.day.localeCompare(b.signature.day))) {
    // If the memory has no own lead photo, bind the day's first privileged hero photo (T11 Part C).
    const photoDay = photoDaysAsc.find((day) => day.day === memory.signature.day);
    const dayPhotos = !memory.lead ? pickDayPhotos(photoDay, privilege) : { hero: undefined, supporting: [], morePhotoCount: 0 };
    if (dayPhotos.hero) heroClaimedOnDay.set(memory.signature.day, dayPhotos.hero.id);
    chapterMoments.push({
      kind: "memory_led",
      day: memory.signature.day,
      dateLabel: memory.signature.dateLabel,
      ageLabel: memory.signature.ageLabel,
      memory,
      text: [],
      hero: dayPhotos.hero,
      supporting: dayPhotos.supporting,
      morePhotoCount: dayPhotos.morePhotoCount,
    });
  }
  // Bind privileged same-day photos beside text moments (T11 Part C). Sharing provenance is the
  // binding here: a daycare-group photo appearing beside daycare-group text on the same day is not
  // a guess at what the sentence depicts — both come from the same people at the same time.
  // Unvouched WeChat images (chat stream screenshots, forwards) remain excluded: privilege is the gate.
  for (const traceDay of [...chapter.traceDays].sort((a, b) => a.day.localeCompare(b.day))) {
    const text = readableEntries(traceDay.entries).slice(0, MOMENT_TEXT_MAX);
    if (text.length === 0) continue;
    const photoDay = photoDaysAsc.find((day) => day.day === traceDay.day);
    // Exclude any hero already shown by a memory_led moment on the same day.
    const alreadyClaimed = heroClaimedOnDay.get(traceDay.day);
    const excludeIds = alreadyClaimed ? new Set([alreadyClaimed]) : undefined;
    const dayPhotos = pickDayPhotos(photoDay, privilege, excludeIds);
    chapterMoments.push({
      kind: "text_led",
      day: traceDay.day,
      dateLabel: traceDay.dateLabel,
      ageLabel: photoDay?.ageLabel,
      text,
      hero: dayPhotos.hero,
      supporting: dayPhotos.supporting,
      morePhotoCount: dayPhotos.morePhotoCount,
    });
  }
  const kindRank = (moment: PublicationMoment) => (moment.kind === "memory_led" ? 0 : 1);
  chapterMoments.sort((a, b) => a.day.localeCompare(b.day) || kindRank(a) - kindRank(b));

  // CHRONICLE — the photographed days not already read in the chapter, weighted: the strongest
  // CHRONICLE_MOMENTS_MAX days become moments, the rest fold to quiet lines. Strength is real and
  // boring: a vouched hero first, then how much of the day was photographed; ties go to the
  // earlier day so the outcome is stable across backends.
  // A day with words in the chapter may still earn a photo moment here — the two sections make
  // no claim on each other. Only memory days are excluded: their photographs already read inside
  // the memory itself.
  const memoryDays = new Set(chapter.memories.map((memory) => memory.signature.day));
  const candidates = photoDaysAsc.filter((day) => !memoryDays.has(day.day));
  const scored = candidates
    .map((day) => ({ day, moment: photoLedMoment(day, privilege) }))
    .filter((item): item is { day: PhotoDay; moment: PublicationMoment } => Boolean(item.moment));
  const ranked = [...scored].sort((a, b) =>
    Number(Boolean(b.moment.hero)) - Number(Boolean(a.moment.hero))
    || b.day.photos.length - a.day.photos.length
    || a.day.day.localeCompare(b.day.day));
  const kept = new Set(ranked.slice(0, CHRONICLE_MOMENTS_MAX).map((item) => item.day.day));
  const chronicle = scored.filter((item) => kept.has(item.day.day)).map((item) => item.moment);
  const quietDays: QuietDay[] = candidates
    .filter((day) => !kept.has(day.day))
    .map((day) => ({ day: day.day, dateLabel: day.dateLabel, photoCount: day.photos.length }));

  // ARCHIVE — the month whole, ascending; days read morning to evening already. Only rows too
  // small to draw at all are counted out.
  const archiveDays: PhotoDay[] = [];
  let smallImageCount = 0;
  for (const day of photoDaysAsc) {
    const drawable = day.photos.filter(thumbnailSized);
    smallImageCount += day.photos.length - drawable.length;
    if (drawable.length > 0) archiveDays.push({ ...day, photos: drawable });
  }

  // COVER / PREVIEW — vouched pictures only, newest first so the index face matches the month's
  // latest life; a memory's own lead outranks loose photography.
  const memoryLead = chapter.memories.find((memory) => memory.lead)?.lead;
  const vouched: MediaRef[] = [];
  for (const day of [...photoDaysAsc].reverse()) {
    for (const item of burstRepresentatives(day.photos)) {
      if (heroEligibleRef(item, privilege) || (isPrivileged(item, privilege) && thumbnailSized(item))) vouched.push(item);
    }
  }
  const cover = memoryLead ?? vouched.find((item) => heroEligibleRef(item, privilege));
  const preview: MediaRef[] = [];
  const seen = new Set<string>();
  for (const item of [cover, ...vouched]) {
    if (!item || seen.has(item.id)) continue;
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
  const daysWithWords = new Set(chapterMoments.map((moment) => moment.day)).size;
  return { month: chapter.month, mode, chapter: chapterMoments, chronicle, quietDays, archiveDays, smallImageCount, cover, preview, narration, daysWithWords, totalPhotoCount: archivePhotoCount };
}

// V4 (T16, 2026-09-04): the standfirst under a populated month's masthead — a fact stated, not a
// sentence written. Purely arithmetic: no AI, no judgment about what the days or photos show.
export function monthStandfirst(daysWithWords: number, totalPhotoCount: number): string | undefined {
  if (daysWithWords > 0 && totalPhotoCount > 0) return `这个月记下 ${daysWithWords} 天，收进 ${totalPhotoCount} 张照片。`;
  if (daysWithWords > 0) return `这个月记下 ${daysWithWords} 天。`;
  if (totalPhotoCount > 0) return `这个月收进 ${totalPhotoCount} 张照片。`;
  return undefined;
}
