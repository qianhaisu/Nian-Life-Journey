import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArchiveNav } from "@/components/archive-nav";
import { YearBookReading } from "@/components/year-book";
import { loadFamilyArchiveForIsr } from "@/lib/family-archive";
import { listArchiveMonths } from "@/lib/db/repository";
import { buildTimeArchiveEnumerationAllowed } from "@/lib/db/config";
import { buildMemoryIndex } from "@/lib/memory-index";
import { readYearBook } from "@/lib/life-reading-load";
import "../reading.css";

export const revalidate = 300;
export async function generateStaticParams() {
  if (!buildTimeArchiveEnumerationAllowed()) return [];
  const months = await listArchiveMonths();
  return [...new Set(months.map(month => month.slice(0, 4)))].map(year => ({ year }));
}
export async function generateMetadata({ params }: { params: Promise<{ year: string }> }): Promise<Metadata> {
  return { title: `${(await params).year} 年 · 年度人生书` };
}
export default async function YearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  if (!/^\d{4}$/.test(year)) notFound();
  const archive = await loadFamilyArchiveForIsr();
  if (!archive.chapters.some(chapter => chapter.year === year)) notFound();
  const book = await readYearBook(archive, year);
  const { nav } = buildMemoryIndex(archive.chapters);
  return <><YearBookReading book={book} /><div className="reading-wrap"><ArchiveNav nav={nav} current={year} /></div></>;
}
