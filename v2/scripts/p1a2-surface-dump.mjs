#!/usr/bin/env node
// Reads the LOCAL JSON snapshot (real production data) through the real read layer and prints what
// each surface will render: home cover choice, month composition shapes, about-page eras.
// No network, no writes.
import { composeFamilyArchive } from "../lib/family-archive.ts";
import { buildHomeView } from "../lib/home-view.ts";
import { buildMonthComposition } from "../lib/publication-moments.ts";
import { buildMemoryIndex } from "../lib/memory-index.ts";
import { findMonth, latestPortrait, recentTraceNotes } from "../lib/memory-chapters.ts";
import { getAllEvents, getStore } from "../lib/db/repository.ts";
import { isRecent } from "../lib/time-truth.ts";

const [events, store] = await Promise.all([getAllEvents(), getStore()]);
const archive = composeFamilyArchive(store, events);
const snip = (t, n = 40) => { const s = String(t).replace(/\s+/g, " "); return [...s].length <= n ? s : [...s].slice(0, n).join("") + "…"; };
const momentLine = (m) => `${m.day} ${m.kind}${m.memory ? ` "${m.memory.title}"` : ""}${m.text.length ? ` text=[${m.text.map((t) => snip(t, 24)).join(" / ")}]` : ""}${m.hero ? ` hero=${m.hero.width}x${m.hero.height}` : ""}${m.supporting.length ? ` +${m.supporting.length}sm` : ""}${m.morePhotoCount ? ` (+${m.morePhotoCount} archive)` : ""}`;

console.log("=== HOME ===");
const home = buildHomeView(archive);
console.log("mark:", home.mark);
console.log("cover.kind:", home.cover.kind);
if (home.cover.kind === "moment") {
  console.log("  " + momentLine(home.cover.cover.moment));
  console.log("  moreDayCount:", home.cover.cover.moreDayCount);
}
if (home.cover.kind === "memory" || home.cover.kind === "dated") console.log(`  lead: "${home.cover.lead.memory.title}" @${home.cover.lead.memory.signature.day} recent=${home.cover.lead.recent}`);
console.log("pastLead:", home.pastLead ? `"${home.pastLead.memory.title}" @${home.pastLead.memory.signature.day}` : "none");
console.log("laterLifeNote:", home.laterLifeNote ?? "none");
console.log("thisMonth:", home.thisMonth?.month, "preview:", home.thisMonthPreview.map((p) => `${p.width}x${p.height}`).join(", ") || "none");

for (const monthKey of ["2026-08", "2025-10", "2025-08", "2025-07"]) {
  const chapter = findMonth(archive.chapters, monthKey);
  if (!chapter) { console.log(`\n=== ${monthKey}: NO CHAPTER ===`); continue; }
  const c = buildMonthComposition(chapter, archive.privilege);
  console.log(`\n=== MONTH ${monthKey} (mode=${c.mode}) ===`);
  console.log("narration:", c.narration ?? "none");
  console.log(`chapter moments: ${c.chapter.length}`);
  for (const m of c.chapter) console.log("  " + momentLine(m));
  console.log(`chronicle moments: ${c.chronicle.length}`);
  for (const m of c.chronicle) console.log("  " + momentLine(m));
  console.log(`quietDays: ${c.quietDays.length} [${c.quietDays.map((d) => d.day.slice(8)).join(",")}]`);
  console.log(`archive: ${c.archiveDays.reduce((s, d) => s + d.photos.length, 0)} photos over ${c.archiveDays.length} days | small excluded: ${c.smallImageCount}`);
  console.log(`cover: ${c.cover ? `${c.cover.id.slice(0, 24)} ${c.cover.width}x${c.cover.height}` : "none"} | preview: ${c.preview.length}`);
}

console.log("\n=== /memory index (open months) ===");
const index = buildMemoryIndex(archive.chapters, undefined, archive.privilege);
for (const year of index.years) for (const month of year.months.filter((m) => m.mode === "open")) {
  console.log(`  ${month.chapter.month}: featured=${month.featured.length} preview=${month.preview.length} mode=${month.compositionMode} traceDays=${month.traces.dayCount}`);
}

console.log("\n=== 张年 ===");
const portrait = latestPortrait(archive.chapters);
console.log("portrait:", portrait ? `${portrait.day} ${portrait.photo.width}x${portrait.photo.height}` : "none");
const notes = recentTraceNotes(archive.chapters, 4);
for (const note of notes) console.log(`  note ${note.day} recent=${isRecent(note.day, archive.time)}: ${snip(note.entry, 30)}`);
process.exit(0);
