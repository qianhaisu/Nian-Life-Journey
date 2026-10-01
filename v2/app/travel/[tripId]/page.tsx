import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TripReading } from "@/components/trip-reading";
import { renderOnDemand } from "@/lib/render-on-demand";
import { readTrip } from "@/lib/travel/reading";
import { placeNames } from "@/lib/travel/model";
import "../travel.css";
import "../../home.css";

export async function generateMetadata({ params }: { params: Promise<{ tripId: string }> }): Promise<Metadata> {
  const { tripId } = await params;
  const trip = (await readTrip(tripId))?.trip;
  return { title: trip ? `${trip.recordOnly ? placeNames(trip) : trip.title} · 旅行` : "旅行" };
}

// 一次旅程的两块内容：精选照片回忆 + 全程散文。已发布日页收在散文后的来源折叠里。
export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  await renderOnDemand();
  const { tripId } = await params;
  const reading = await readTrip(tripId);
  if (!reading) notFound();
  return <TripReading reading={reading} />;
}
