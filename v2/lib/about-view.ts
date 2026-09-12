// 张年's own page, decided in one place so it can be tested against fixtures and read as a whole.
//
// 2026-09-12. What this replaces: the page had grown four modules that were all the same module —
// 最近的生活节奏 (the newest month's snapshot), 最近记下来的 (the last 60 days of stories),
// 家人这阵子说 (quotes lifted out of those same stories with a regex), 档案最近记下的 (trace notes).
// Every one of them was "the archive's recent memories", already the whole of the front page and
// the whole of /memory, restated on a page that is supposed to answer a different question:
// 这孩子长成什么样了. Teddy: 「移除这三个重复记忆的模块」.
//
// So the page is now a growth record, in four parts, and each part has ONE source:
//   一 基本信息   profile birth date + the archive's own portrait + measured height/weight, each
//                 measurement carrying the day it was taken and its own history curve;
//   二 家人关注的健康问题   care_records, grouped by the episode they belong to;
//   三 学会了什么   growth_records of the observed kinds (语言/动作/相处/喜欢/脾气/吃饭/睡觉);
//   四 解锁的体验   published stories whose OWN approved title says it was a first.
//
// THE TWO RULES THAT SHAPE THE CODE, both Teddy's, both about not overstating:
//
//   「没有明确后续，不判定康复，不把旧状态写成当前状态」. The health part never prints a current
//   status — not even a summary of one. Every line is one dated record with the status that record
//   itself carried on that day, and the group above it is a title, not a verdict. `care_episodes`
//   rows carry a status and an `endedAt`, and neither is read here: an episode row is private by
//   type, and "this issue is over" is exactly the claim that may not be inferred from data that
//   merely stopped arriving.
//
//   「没有首次证据不能称第一次」. 解锁的体验 adds no words of its own. An entry exists only where an
//   approved story's own title says 第一天 / 第一次 / 第一步 / 首次 — the evidence is the sentence the
//   reader can see, and it links to the story it came from (原则八). There is no eventType
//   'milestone' in this archive (measured 2026-09-12: 212 approved events, all `moment`) and no
//   content-type classification either (all 212 carry the single type `family`), so nothing here
//   promotes an ordinary day by guessing at its meaning.
//
// A part with no rows behind it is NOT RENDERED — no card, no 「暂无」. As of 2026-09-12 that is
// three of the four: growth_records, care_records and care_episodes are empty in both databases
// (verified on Neon and corroborated by the live private site rendering neither), so this page
// delivers 基本信息 and 解锁的体验 and stays silent about the rest until the rows exist.
import type { FamilyArchive } from "@/lib/family-archive";
import { measurements, type Measurement } from "@/lib/growth-notes";
import { latestPortrait, type MediaRef, type YearChapter } from "@/lib/memory-chapters";
import { isRecent } from "@/lib/time-truth";
import { ageOn, formatDay } from "@/lib/time-signature";
import type { CareRecord, GrowthKind, GrowthRecord } from "@/lib/types";

export type AboutPortrait = { photo: MediaRef; day: string; dateLabel: string; recent: boolean };

export type AboutBasics = {
  age?: string;
  birthDay?: string;
  birthLabel?: string;
  portrait?: AboutPortrait;
};

export type MeasureTrack = {
  kind: "height" | "weight";
  title: string;
  latest: Measurement;
  // Every measurement, oldest first — the curve, kept rather than collapsed to the newest number.
  history: Measurement[];
};

export type HealthLine = {
  id: string;
  day: string;
  dateLabel: string;
  ageLabel?: string;
  // The status this record carried on its own day. Never presented as the situation now.
  status: string;
  title: string;
  note: string;
  nextStep?: string;
  eventHref?: string;
};

export type HealthGroup = { key: string; title: string; lines: HealthLine[] };

export type LearnedNote = { id: string; note: string; day: string; dateLabel: string; ageLabel?: string; eventHref?: string };
export type LearnedGroup = { kind: GrowthKind; title: string; notes: LearnedNote[] };

export type UnlockedExperience = { id: string; title: string; day: string; dateLabel: string; ageLabel?: string };

export type AboutView = {
  basics: AboutBasics;
  measures: MeasureTrack[];
  health: HealthGroup[];
  learned: LearnedGroup[];
  unlocked: UnlockedExperience[];
};

// Plain nouns, not 「最近常说」: this page is the whole record, so a heading here must not claim
// recency the way the front page's growth line does (lib/growth-notes.ts keeps those labels).
export const LEARNED_KIND_TITLE: Partial<Record<GrowthKind, string>> = {
  language: "说话", motor: "动作", social: "和人相处", interest: "喜欢的", personality: "脾气", food: "吃饭", sleep: "睡觉",
};
// The order the parts are read in — language and movement first, because they are what a family
// asks about first. A kind with no rows simply does not appear.
export const LEARNED_ORDER: GrowthKind[] = ["language", "motor", "social", "interest", "food", "sleep", "personality"];
// Per kind, so one talkative month cannot bury the rest of the record.
export const LEARNED_PER_KIND = 5;

// An approved story whose own title says it was a first. Deliberately the TITLE and not the story
// body: the title is the editorial line about what the day WAS, so 「第一步」 there is a claim about
// the day, while the same words inside a paragraph are as likely to be 「第一次听说」 about someone
// else. No synonyms, no fuzziness, nothing inferred from a date being early.
export const FIRST_TIME_TITLE = /第一次|第一天|第一步|首次/;

export function unlockedExperiences(chapters: YearChapter[], birthDay?: string): UnlockedExperience[] {
  const found: UnlockedExperience[] = [];
  for (const year of chapters) for (const month of year.months) for (const memory of month.memories) {
    if (!FIRST_TIME_TITLE.test(memory.title)) continue;
    found.push({ id: memory.id, title: memory.title, day: memory.signature.day, dateLabel: memory.signature.dateLabel, ageLabel: memory.signature.ageLabel });
  }
  // Oldest first: unlocks read as the order they happened in, which is the only order that makes a
  // list of firsts into a growth record rather than a feed.
  return found.sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
}

export function measureTracks(records: GrowthRecord[], birthDay?: string): MeasureTrack[] {
  const tracks: MeasureTrack[] = [];
  for (const [kind, title] of [["height", "身高"], ["weight", "体重"]] as const) {
    const history = measurements(records, kind, birthDay);
    const latest = history[history.length - 1];
    if (latest) tracks.push({ kind, title, latest, history });
  }
  return tracks;
}

// care_records the family may see, grouped by the episode they belong to. A record with no episode
// is its own group: it is one thing the family noticed, and folding unrelated records together by
// keyword would be inventing a problem that nobody recorded.
export function healthGroups(records: CareRecord[], birthDay?: string): HealthGroup[] {
  const visible = records
    .filter((record) => record.visibility !== "private")
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id));
  const groups = new Map<string, HealthGroup>();
  for (const record of visible) {
    const key = record.careEpisodeId ?? record.id;
    const day = record.observedAt.slice(0, 10);
    const line: HealthLine = {
      id: record.id,
      day,
      dateLabel: formatDay(day),
      ageLabel: ageOn(birthDay, day),
      status: record.status,
      title: record.title,
      note: record.note,
      nextStep: record.nextStep?.trim() || undefined,
      eventHref: record.lifeEventId ? `/events/${record.lifeEventId}` : undefined,
    };
    const group = groups.get(key);
    if (group) group.lines.push(line);
    // The group is titled from its NEWEST record, which is the first one seen here (records are
    // sorted newest first): how the family last described the issue, not how it was first phrased.
    else groups.set(key, { key, title: record.title, lines: [line] });
  }
  // Groups by their newest record, newest first — what is being watched now reads first, without
  // the page saying anything about whether it is over.
  return [...groups.values()].sort((a, b) => b.lines[0].day.localeCompare(a.lines[0].day) || a.key.localeCompare(b.key));
}

export function learnedGroups(records: GrowthRecord[], birthDay?: string): LearnedGroup[] {
  const groups: LearnedGroup[] = [];
  for (const kind of LEARNED_ORDER) {
    const notes = records
      .filter((record) => record.kind === kind && record.visibility !== "private" && record.note?.trim())
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id))
      .slice(0, LEARNED_PER_KIND)
      .map((record) => {
        const day = record.observedAt.slice(0, 10);
        return {
          id: record.id,
          note: record.note.trim(),
          day,
          dateLabel: formatDay(day),
          ageLabel: ageOn(birthDay, day),
          eventHref: record.lifeEventId ? `/events/${record.lifeEventId}` : undefined,
        };
      });
    if (notes.length > 0) groups.push({ kind, title: LEARNED_KIND_TITLE[kind] ?? kind, notes });
  }
  return groups;
}

export function buildAboutView({ chapters, store, birthDay, time }: FamilyArchive): AboutView {
  const portrait = latestPortrait(chapters);
  return {
    basics: {
      age: birthDay ? ageOn(birthDay, time.today) : undefined,
      birthDay,
      birthLabel: birthDay ? formatDay(birthDay) : undefined,
      // The portrait says the day it was taken, and whether that day is recent, so a year-old
      // picture is never read as what he looks like now (lib/time-truth.ts).
      portrait: portrait ? { ...portrait, recent: isRecent(portrait.day, time) } : undefined,
    },
    measures: measureTracks(store.growthRecords, birthDay),
    health: healthGroups(store.careRecords, birthDay),
    learned: learnedGroups(store.growthRecords, birthDay),
    unlocked: unlockedExperiences(chapters, birthDay),
  };
}
