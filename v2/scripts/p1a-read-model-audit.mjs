#!/usr/bin/env node
// READ-ONLY P1-A audit: loads the REAL production family archive through the exact same read model
// the four pages use, and reports what each page would actually render. No writes, no page text
// printed beyond lengths/flags where possible.
import { loadFamilyArchive } from "../lib/family-archive.ts";
import { buildHomeView } from "../lib/home-view.ts";
import { buildMemoryIndex, buildYearView, buildMonthView } from "../lib/memory-index.ts";
import { recentGrowthNotes, measurements } from "../lib/growth-notes.ts";
import { latestLeadPhoto } from "../lib/memory-chapters.ts";
import { ageOn } from "../lib/time-signature.ts";

const a = await loadFamilyArchive();
const s = a.store;
console.log("=== STORE SHAPE (canonical profile scope) ===");
console.log("events(published):", a.events.length);
for (const k of Object.keys(s)) {
  const v = s[k];
  if (Array.isArray(v)) console.log(`  ${k}: ${v.length}`);
  else if (v && typeof v === "object") console.log(`  ${k}: object`);
}
console.log("birthDay:", a.birthDay, "| time:", JSON.stringify(a.time));
console.log("snapshot:", a.snapshot ? `${a.snapshot.month} (len ${a.snapshot.summary?.length})` : "NONE");

console.log("\n=== CHAPTERS ===");
console.log("years:", a.chapters.map(y => `${y.year}(${y.months.length}m, ${y.ageSpan ?? "no-age"})`).join(" "));
let totMem=0, totTrace=0, totPhoto=0, memWithLead=0, memWithExcerpt=0;
for (const y of a.chapters) for (const m of y.months) {
  totMem+=m.memories.length; totTrace+=m.traceDays.length; totPhoto+=m.photos.length;
  memWithLead += m.memories.filter(x=>x.lead).length;
  memWithExcerpt += m.memories.filter(x=>x.excerpt).length;
}
console.log(`memories=${totMem} traceDays=${totTrace} monthPhotoSlots=${totPhoto} withLead=${memWithLead} withExcerpt=${memWithExcerpt}`);
console.log("\nper-month (newest 18): month | mem | traceDays | photos | age");
let n=0;
for (const y of a.chapters) for (const m of y.months) { if(n++>=24) break;
  console.log(`  ${m.month} | ${String(m.memories.length).padStart(3)} | ${String(m.traceDays.length).padStart(3)} | ${String(m.photos.length).padStart(2)} | ${String(m.photoCount).padStart(4)} | ${String(m.videoCount).padStart(3)} | ${String(m.photoDays.length).padStart(3)} | ${String(m.withheldMediaCount).padStart(3)} | ${m.ageLabel ?? "-"}`); }

console.log("\n=== MEMORY WEIGHT DISTRIBUTION ===");
const w={};
for (const y of a.chapters) for (const m of y.months) for (const x of m.memories) w[x.weight]=(w[x.weight]||0)+1;
console.log(JSON.stringify(w));

console.log("\n=== HOME PAGE ===");
const h = buildHomeView(a);
console.log("mark:", h.mark);
console.log("leadHeading:", h.leadHeading);
console.log("lead:", h.lead ? `${h.lead.memory.id} | day=${h.lead.memory.signature.day} | recent=${h.lead.recent} | lead-photo=${!!h.lead.memory.lead} | titleLen=${h.lead.memory.title.length} | excerpt=${!!h.lead.memory.excerpt}` : "NONE");
console.log("lead title:", h.lead?.memory.title);
console.log("laterLifeNote:", h.laterLifeNote ?? "none");
console.log("change:", h.change ? `${h.change.label} @ ${h.change.signature.day}` : "NONE");
console.log("thisMonth:", h.thisMonth ? `${h.thisMonth.month} photos=${h.thisMonth.photos.length} mem=${h.thisMonth.memories.length} traceDays=${h.thisMonth.traceDays.length}` : "NONE");
console.log("summary:", h.summary ? `len ${h.summary.length}` : "NONE");
console.log("monthHref:", h.monthHref);

console.log("\n=== /memory ===");
const idx = buildMemoryIndex(a.chapters);
console.log("nav:", JSON.stringify(idx.nav));
for (const y of idx.years) {
  const open=y.months.filter(m=>m.mode==="open"), ix=y.months.filter(m=>m.mode==="index");
  console.log(`  ${y.year}: open=${open.length} index=${ix.length} | open months: ${open.map(m=>`${m.chapter.month}(cur:${m.memories?.length ?? m.chapter.memories.length})`).join(",")}`);
}

console.log("\n=== /memory/[year] (newest year) ===");
const y0=a.chapters[0];
if (y0) { const v=buildYearView(y0);
  console.log(`year=${y0.year} memoryCount=${v.memoryCount} traceDayCount=${v.traceDayCount} months=${v.months.length}`);
  for (const m of v.months) console.log(`   ${m.chapter.month} titles=${m.titles.length} hidden=${m.hiddenMemoryCount} traceDays=${m.traceDayCount} photos=${m.chapter.photos.length}`);
}

console.log("\n=== /memory/[year]/[month] (home's thisMonth) ===");
if (h.thisMonth) { const v=buildMonthView(h.thisMonth);
  console.log(`month=${h.thisMonth.month} memories=${v.memories.length} traceGroups=${v.traces?.days?.length ?? JSON.stringify(Object.keys(v.traces??{}))}`);
  console.log("traces shape:", JSON.stringify(v.traces).slice(0,400));
}

console.log("\n=== /about (张年) ===");
console.log("age:", a.birthDay ? ageOn(a.birthDay, a.time.today) : "NO BIRTHDAY");
console.log("portrait:", latestLeadPhoto(a.chapters) ? "yes" : "NONE");
const notes = recentGrowthNotes(s.growthRecords, a.birthDay, 4, a.time);
console.log("growthRecords:", s.growthRecords.length, "| recentNotes:", notes.length, notes.map(x=>`${x.label}@${x.signature.day}${x.recent?"*":""}`).join(", "));
console.log("heights:", measurements(s.growthRecords,"height",a.birthDay).length, "weights:", measurements(s.growthRecords,"weight",a.birthDay).length);
console.log("careRecords(visible):", s.careRecords.filter(r=>r.visibility!=="private").length);

console.log("\n=== MEDIA ===");
console.log("media rows:", s.media.length);
const byType={}; for (const m of s.media) byType[m.type]=(byType[m.type]||0)+1;
const pubType={}; for (const m of a.media) pubType[m.type]=(pubType[m.type]||0)+1;
console.log("store by type:", JSON.stringify(byType), "| publishable by type:", JSON.stringify(pubType));
const claimed=new Set(a.events.flatMap(e=>e.mediaIds));
console.log("claimed by an event:", claimed.size, "| orphaned:", s.media.filter(m=>!claimed.has(m.id)).length);
const noTaken = s.media.filter(m=>!m.takenAt).length;
console.log("media without takenAt:", noTaken);
const mm={}; for (const m of a.media) { const k=(m.takenAt??"").slice(0,7)||"NONE"; mm[k]=(mm[k]||0)+1; }
console.log("publishable media by takenAt month:", JSON.stringify(Object.fromEntries(Object.entries(mm).sort((x,y)=>y[0].localeCompare(x[0])).slice(0,14))));
console.log("\n=== RAW SOURCES ===");
console.log("rawSources:", s.rawSources.length);
const rs={}; for (const r of s.rawSources) { const k=(r.capturedAt??"").slice(0,7)||"NONE"; rs[k]=(rs[k]||0)+1; }
console.log("by capturedAt month (newest 12):", JSON.stringify(Object.fromEntries(Object.entries(rs).sort((x,y)=>y[0].localeCompare(x[0])).slice(0,12))));
process.exit(0);
