import type { BentoDayCard, BentoFamilyVoice, BentoTimeCapsule } from "./home-bento";

function parseUtcDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  if ([y, m, d].some((n) => Number.isNaN(n))) return NaN;
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function daysBetween(earlier: string, later: string): number {
  const a = parseUtcDay(earlier);
  const b = parseUtcDay(later);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round(b - a);
}

export function pickRotatedVoices(
  pool: readonly BentoFamilyVoice[],
  count: number,
  slot: number,
): BentoFamilyVoice[] {
  if (pool.length <= count) return [...pool];
  const step = Math.min(count, Math.max(1, pool.length - count));
  const offset = (((slot * step) % pool.length) + pool.length) % pool.length;
  const picked: BentoFamilyVoice[] = [];
  const usedIds = new Set<string>();
  const usedSpeakers = new Set<string>();

  for (let i = 0; i < pool.length && picked.length < count; i += 1) {
    const item = pool[(offset + i) % pool.length];
    if (usedIds.has(item.id) || usedSpeakers.has(item.speaker)) continue;
    usedIds.add(item.id);
    usedSpeakers.add(item.speaker);
    picked.push(item);
  }
  for (let i = 0; i < pool.length && picked.length < count; i += 1) {
    const item = pool[(offset + i) % pool.length];
    if (usedIds.has(item.id)) continue;
    usedIds.add(item.id);
    picked.push(item);
  }
  return picked;
}

export function pickRotatedJournalDays(
  pool: readonly BentoDayCard[],
  count: number,
  slot: number,
): BentoDayCard[] {
  if (pool.length <= count) return [...pool];
  const offset = (((slot * count) % pool.length) + pool.length) % pool.length;
  const picked: BentoDayCard[] = [];
  const usedDays = new Set<string>();
  for (let i = 0; i < pool.length && picked.length < count; i += 1) {
    const item = pool[(offset + i) % pool.length];
    if (usedDays.has(item.day)) continue;
    usedDays.add(item.day);
    picked.push(item);
  }
  return picked.sort((a, b) => b.day.localeCompare(a.day));
}

export function pickRotatedCapsules(
  pool: readonly BentoTimeCapsule[],
  count: number,
  slot: number,
): BentoTimeCapsule[] {
  if (pool.length <= count) return [...pool].sort((a, b) => b.day.localeCompare(a.day));
  const offset = (((slot * count) % pool.length) + pool.length) % pool.length;
  const picked: BentoTimeCapsule[] = [];
  const usedDays = new Set<string>();
  const usedMonths = new Set<string>();
  const usedAgeLabels = new Set<string>();
  const usedPhotoIds = new Set<string>();
  const usedDisplayKeys = new Set<string>();

  const recordPick = (item: BentoTimeCapsule) => {
    usedDays.add(item.day);
    usedMonths.add(item.month);
    if (item.badgeLabel !== "出生前") usedAgeLabels.add(item.badgeLabel);
    usedPhotoIds.add(item.photo.id);
    const dk = (item.photo as { displayKey?: string }).displayKey;
    if (dk) usedDisplayKeys.add(dk);
    picked.push(item);
  };

  for (let i = 0; i < pool.length && picked.length < count; i += 1) {
    const item = pool[(offset + i) % pool.length];
    const dk = (item.photo as { displayKey?: string }).displayKey;
    if (
      usedDays.has(item.day) ||
      usedMonths.has(item.month) ||
      (item.badgeLabel !== "出生前" && usedAgeLabels.has(item.badgeLabel)) ||
      usedPhotoIds.has(item.photo.id) ||
      (dk && usedDisplayKeys.has(dk)) ||
      picked.some((p) => Math.abs(daysBetween(p.day, item.day)) < 20)
    ) {
      continue;
    }
    recordPick(item);
  }
  for (let i = 0; i < pool.length && picked.length < count; i += 1) {
    const item = pool[(offset + i) % pool.length];
    const dk = (item.photo as { displayKey?: string }).displayKey;
    if (usedDays.has(item.day) || usedPhotoIds.has(item.photo.id) || (dk && usedDisplayKeys.has(dk))) continue;
    recordPick(item);
  }
  return picked.sort((a, b) => b.day.localeCompare(a.day));
}
