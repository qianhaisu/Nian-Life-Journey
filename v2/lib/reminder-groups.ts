import type { HomeReminder } from "@/components/home-reminders";

const normalize = (title: string) => title.normalize("NFKC").replace(/\s+/g, "").replace(/[，,。；;！!]/g, "");
const actionKey = (title: string) => {
  const text = normalize(title);
  // The second clause explains the same leave request; preserve every other action.
  return text.includes("请假") ? text.replace(/(?:当天|那天|今天)?不去托班/g, "") : text;
};

/** A display projection only: source rows, extracted status and original item ids stay intact. */
export function groupReminders(items: readonly HomeReminder[]): HomeReminder[] {
  const groups = new Map<string, HomeReminder>();
  for (const item of items) {
    const key = JSON.stringify([actionKey(item.title), item.whenKey ?? item.whenDay ?? item.whenText, item.pendingConfirmation ?? false, item.actionable]);
    const existing = groups.get(key);
    if (!existing) { groups.set(key, { ...item, aliasIds: [...(item.aliasIds ?? [item.id])], sources: [...item.sources] }); continue; }
    existing.aliasIds = [...new Set([...existing.aliasIds!, ...(item.aliasIds ?? [item.id])])].sort();
    existing.id = existing.aliasIds[0];
    if (item.title.length < existing.title.length) existing.title = item.title;
    existing.note = [...new Set([existing.note, item.note].filter(Boolean))].join("；") || undefined;
    const seen = new Set(existing.sources.map((source) => JSON.stringify(source)));
    for (const source of item.sources) if (!seen.has(JSON.stringify(source))) { existing.sources.push(source); seen.add(JSON.stringify(source)); }
  }
  return [...groups.values()];
}
