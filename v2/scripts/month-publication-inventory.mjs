// Read-only: what does every month actually publish? Runs the real composition layer
// (lib/publication-moments.ts) over the real repository and prints, per month, how much reaches
// each reading layer. No writes, no model calls — this answers "would a family member opening this
// month see anything?" without deploying or screenshotting.
//
//   REPOSITORY_BACKEND=postgres node --import tsx scripts/month-publication-inventory.mjs
import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });

const { loadFamilyArchive } = await import("../lib/family-archive.ts");
const { buildMonthComposition } = await import("../lib/publication-moments.ts");

const archive = await loadFamilyArchive();
const rows = [];
for (const year of archive.chapters) {
  for (const month of year.months) {
    const composition = buildMonthComposition(month, archive.privilege);
    rows.push({
      month: month.month,
      chapter: composition.chapter.length,
      chronicleDays: composition.chronicle.length,
      shownPhotos: composition.chronicle.reduce((sum, moment) => sum + (moment.hero ? 1 : 0) + moment.supporting.length, 0),
      quietDays: composition.quietDays.length,
      archivePhotos: composition.archiveDays.reduce((sum, day) => sum + day.photos.length, 0),
      mode: composition.mode,
      readable: composition.chapter.length > 0 || composition.chronicle.length > 0,
    });
  }
}
rows.sort((a, b) => a.month.localeCompare(b.month));
console.table(rows);
const blank = rows.filter((row) => !row.readable);
console.log(`months: ${rows.length}, readable: ${rows.length - blank.length}, blank: ${blank.length}${blank.length ? " → " + blank.map((r) => r.month).join(", ") : ""}`);
