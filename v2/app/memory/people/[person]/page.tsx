import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { READING_PEOPLE } from "@/lib/life-reading";

export async function generateMetadata({ params }: { params: Promise<{ person: string }> }): Promise<Metadata> {
  const { person: id } = await params;
  const person = READING_PEOPLE.find(item => item.id === id);
  return { title: person ? `${person.label} · 一起长大的人` : "人物" };
}

/** Existing bookmarks keep their person, but the full portrait now lives on one page. */
export default async function PersonPage({ params }: { params: Promise<{ person: string }> }) {
  const { person: id } = await params;
  const person = READING_PEOPLE.find(item => item.id === id);
  if (!person) notFound();
  redirect(`/memory/people#person-${person.id}`);
}
