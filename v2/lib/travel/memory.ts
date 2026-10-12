import type { HomeMemory } from "@/lib/home-memory";
import { MEMORY_TIMING } from "@/lib/home-memory";
import { displayIdentity, uniqueDisplayMedia } from "@/lib/media/display-identity";
import type { MediaRef } from "@/lib/memory-chapters";
import { coverScore, formatRange, type CoverScore, type Trip } from "./model";
import type { TripDay } from "./reading";

/** Only receives the travel reader's eligible, reviewed pool. No new image recognition or time-based scene guesses. */
export function buildTripMemory(trip: Trip, days: readonly TripDay[], scores: ReadonlyMap<string, CoverScore>, cover?: MediaRef, limit = 24): HomeMemory | undefined {
  const pool = days.filter(day => day.day >= trip.from && day.day <= trip.to)
    .sort((a, b) => a.day.localeCompare(b.day))
    .flatMap(day => day.photos.filter(media => media.type === "photo" && !scores.get(media.id)?.sensitive).map(media => ({ ...media, day, order: 0 })));
  pool.forEach((item, index) => { item.order = index; });
  const value = (id: string) => coverScore(scores.get(id), false) ?? -1;
  const files = uniqueDisplayMedia(pool, (next, previous) => value(next.id) > value(previous.id));
  const scenes = new Map<string, typeof files[number]>();
  for (const item of files) {
    const key = scores.get(item.id)?.sceneKey?.trim() || displayIdentity(item);
    const previous = scenes.get(key);
    if (!previous || value(item.id) > value(previous.id)) scenes.set(key, item);
  }
  const groups = new Map<string, typeof files>();
  for (const item of [...scenes.values()].sort((a, b) => a.day.day.localeCompare(b.day.day) || a.order - b.order)) {
    const group = groups.get(item.day.day) ?? [];
    group.push(item);
    groups.set(item.day.day, group);
  }
  const max = Math.max(1, Math.floor(limit));
  const allDays = [...groups.values()].map(group => group.sort((a, b) => value(b.id) - value(a.id) || a.order - b.order));
  // Spread long stays across the whole range; then give each represented day a turn before adding a second photo.
  const chosenDays = allDays.length <= max ? allDays : Array.from({ length: max }, (_, i) => allDays[max === 1 ? 0 : Math.round(i * (allDays.length - 1) / (max - 1))]);
  const selected: typeof files = [];
  for (let round = 0; selected.length < max; round++) {
    const next = chosenDays.flatMap(group => group[round] ? [group[round]] : []);
    if (!next.length) break;
    selected.push(...next.slice(0, max - selected.length));
  }
  selected.sort((a, b) => a.day.day.localeCompare(b.day.day) || a.order - b.order);
  if (!selected.length) return undefined;
  const coverIndex = cover ? selected.findIndex(item => displayIdentity(item) === displayIdentity(cover)) : -1;
  return {
    kind: "topic", key: `trip:${trip.id}`, title: "旅途里的画面", subtitle: formatRange(trip.from, trip.to),
    slides: selected.map(({ day, order: _order, ...media }) => ({ key: media.id, media, day: day.day, dateLabel: day.dateLabel,
      ageLabel: day.ageLabel, href: day.href, linkLabel: day.href ? "回到那天" : undefined })),
    coverIndex: coverIndex >= 0 ? coverIndex : 0,
    durationSeconds: selected.length * MEMORY_TIMING.slideSeconds,
    mood: "open", moodReason: "已确认出行的旅行照片回忆，沿用现有出游配乐",
    reason: `旅行审核池 ${pool.length} 张，按文件与已有场景分组收敛为 ${files.length} 个文件、${scenes.size} 个场景，均衡选用 ${selected.length} 张`,
  };
}
