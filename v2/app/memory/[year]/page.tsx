import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { renderOnDemand } from "@/lib/render-on-demand";

export async function generateMetadata({ params }: { params: Promise<{ year: string }> }): Promise<Metadata> {
  return { title: `${(await params).year} 年的记忆` };
}
export default async function YearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  if (!/^\d{4}$/.test(year)) notFound();
  // Keep old year bookmarks usable while the annual book is unpublished.
  await renderOnDemand();
  const archive = await loadFamilyArchiveOnDemand();
  if (!archive.chapters.some(chapter => chapter.year === year)) notFound();
  redirect(`/memory#year-${year}`);
}
