// How much of the archive each layer shows by default. The book about 张年 has five layers of
// material, from rawest to most edited:
//
//   evidence        RawSource — a message, a photo; shown only on a memory's own page (evidence-list)
//   trace           DailyTrace — an ordinary day the archive noticed; folded, summarised, capped
//   memory          LifeEvent — a story worth reading; a few are curated onto index pages
//   chapter         MonthChapter — the primary archive unit (/memory/[year]/[month]); the only place
//                   a month is shown whole
//   annual chapter  YearChapter — the year's spine (/memory/[year]): months, ages, a few titles each
//
// Every number here is policy, not a fact about the current data: they bound what a page renders
// no matter how many rows exist (tens of thousands of sources, thousands of traces, hundreds of
// memories), and they are meant to be tuned by reading the pages, not by fitting today's sparse
// archive. Pages never re-sort or re-count around these — lib/memory-index.ts applies them once.
export type MemoryIaPolicy = {
  // /memory opens the newest months in full until about this many curated memories are on screen;
  // older months become one index row each.
  openMemoriesTarget: number;
  // Inside an open month on /memory, at most this many memories are shown (chapter > highlight >
  // memory weight, then ones with a photo, then newest); the rest is a count and a link to the month.
  curatedPerMonth: number;
  // The annual chapter lists at most this many memory titles per month.
  yearTitlesPerMonth: number;
  // Traces: the fold shows at most this many days inline; beyond it, the month page carries them.
  traceDaysInline: number;
  // And each day shows at most this many entries before "还有 N 条".
  traceEntriesPerDay: number;
  // /memory also stops opening months after this many, whatever their memory count: an archive
  // whose months are mostly photographs would otherwise never close the window (three curated
  // memories total never reaches openMemoriesTarget) and the index would render every month of
  // every year in full.
  openMonthsMax: number;
  // A day on the month page shows at most this many photographs before "这一天还有 N 张". The
  // complete eligible set stays behind the chapter — the month is an edited publication, not a
  // dump of the archive.
  monthPhotosPerDay: number;
};

export const DEFAULT_MEMORY_IA_POLICY: MemoryIaPolicy = {
  openMemoriesTarget: 16,
  curatedPerMonth: 3,
  yearTitlesPerMonth: 6,
  traceDaysInline: 10,
  traceEntriesPerDay: 6,
  openMonthsMax: 6,
  monthPhotosPerDay: 8,
};
