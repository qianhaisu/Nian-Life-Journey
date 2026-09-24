import type { LifeEvent } from "./types";

// Display-only family labels; original stories and source messages remain unchanged.
export function prenatalStoryForFamily<T extends Pick<LifeEvent, "occurredAt" | "title" | "story" | "storySections">>(event: T): T {
  const month = event.occurredAt?.slice(0, 7);
  if (!month || month < "2024-06" || month > "2024-12") return event;
  const label = (text: string) => text.replace(/苏静/g, "妈妈").replace(/\bTed\b/g, "爸爸");
  return { ...event, title: event.title ? label(event.title) : event.title,
    story: event.story ? label(event.story) : event.story,
    storySections: event.storySections?.map(label) };
}
