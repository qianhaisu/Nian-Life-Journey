import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DayDetail } from "@/components/day-detail";
import { readDay } from "@/lib/day-reading";

// A day's own page.
//
// It exists because MEMORY-04 wrote eight days the Organizer had never made a life_event for —
// 9/10's hospital afternoon, 9/15's 「今天说：鱼、鱼」, 9/17's tower of blocks. Those days had words
// and photographs and nowhere to point at. Rather than write life_events for them (production
// content, a different decision, and one nobody asked for), the reading itself gets an address.
//
// A day with no edited content is not found here — this route never invents a page for a date that
// has nothing to say, and months without edited content are unaffected.
export const revalidate = 300;
export async function generateStaticParams() { return []; }

export async function generateMetadata({ params }: { params: Promise<{ year: string; month: string; day: string }> }): Promise<Metadata> {
  const { year, month, day } = await params;
  const reading = await readDay(`${year}-${month}-${day}`);
  return { title: reading ? reading.title : "这一天不在档案里" };
}

export default async function DayPage({ params }: { params: Promise<{ year: string; month: string; day: string }> }) {
  const { year, month, day } = await params;
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) notFound();
  const reading = await readDay(`${year}-${month}-${day}`);
  if (!reading) notFound();

  return (
    <DayDetail
      day={reading.day}
      dateLabel={reading.dateLabel}
      ageLabel={reading.ageLabel}
      title={reading.title}
      paragraphs={reading.day.paragraphs}
      photos={reading.photos}
      sources={reading.sources}
      sourceMedia={reading.sourceMedia}
      speakerBySourceId={reading.content.speakerBySourceId}
      deliverableIds={reading.sourceDeliverable}
      monthHref={reading.monthHref}
      monthLabel={reading.monthLabel}
    />
  );
}
