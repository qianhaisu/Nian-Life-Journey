import { createHash } from "node:crypto";

export function reminderUnitFingerprint(unit) {
  return createHash("sha256").update(JSON.stringify({ day: unit.day, messages: unit.messages.map(({ id, t, who, text, media }) => ({ id, t, who, text, media })) })).digest("hex");
}

// A direct source review can exclude private material or an already completed action.
// Any added or changed message requires a fresh review; an old decision cannot hide it.
export function reviewedReminderUnit(unit, reviews) {
  const entry = reviews?.[`${unit.shortId}|${unit.day}`];
  if (entry?.reviewer !== "codex" || entry.decision !== "no-new-public-reminder" || !entry.reason || !entry.reviewedAt || entry.fingerprint !== reminderUnitFingerprint(unit)) return null;
  return { items: [], statusUpdates: [] };
}
