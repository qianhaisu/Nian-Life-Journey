// Bounded, topic-linked prior context for developmental-transition judgements.
//
// The problem this solves, from the archive: on 2025-08-04 the family wrote 「他确实是一觉睡到了5点，
// 没有醒一下，我也没有哄一下」. That sentence proves he slept until five unassisted. It does not prove
// this was new — the window contains no novelty marker at all, and the surrounding line is a
// question (「是喜提什么新习惯了吗」), not an assertion. Teaching the editor to read novelty into such
// a sentence would be teaching it to invent milestones, which is the worst failure this stage has.
//
// The alternative is to give it the baseline: a few earlier observations on the SAME topic, so
// "he slept until five" can be compared against what was normal before. Deliberately narrow —
// topic-matched, capped, and drawn from a bounded lookback. Broad context is just a slower way of
// inviting the same invention, and it costs tokens on every call.
export type ObservationTopic = "sleep" | "crawl" | "stand" | "walk" | "speech" | "feeding" | "selfcare" | "teeth";

// Exported so a retrieval layer can filter BY TOPIC IN THE QUERY rather than fetching by recency
// and filtering afterwards. That ordering matters: at 50-150 messages a day, the 400 most recent
// messages cover about five days of a thirty-day lookback, so recency-first retrieval returned zero
// crawling baselines for the crawling case even though seven existed.
export const TOPIC_PATTERNS: Record<ObservationTopic, RegExp> = {
  sleep: /睡|醒|哄睡|夜醒|接觉|入睡/,
  crawl: /爬/,
  stand: /站|扶站/,
  walk: /走路|迈步|会走/,
  speech: /叫爸|叫妈|会叫|说话|发音|词/,
  feeding: /辅食|喂|自己吃|勺|奶瓶/,
  selfcare: /自己穿|自己洗|自己拿|自己端/,
  teeth: /长牙|出牙|牙齿/,
};

export function extractTopics(text: string): ObservationTopic[] {
  return (Object.keys(TOPIC_PATTERNS) as ObservationTopic[]).filter((topic) => TOPIC_PATTERNS[topic].test(text));
}

export function topicsForWindow(texts: Iterable<string>): ObservationTopic[] {
  const topics = new Set<ObservationTopic>();
  for (const text of texts) for (const topic of extractTopics(text)) topics.add(topic);
  return [...topics];
}

export type PriorObservationCandidate = { sourceId: string; observedAt: string; text: string };
// sourceId travels with every baseline line so the validator can later confirm that a transition
// claim cited a baseline the pipeline actually supplied (H8 path B).
export type SelectedPriorObservation = { sourceId: string; observedAt: string; topic: ObservationTopic; statement: string };

export type PriorObservationOptions = {
  /** Most recent N per topic. Recency matters more than volume for a baseline. */
  maxPerTopic?: number;
  maxTotal?: number;
  /** Only look this far back; a three-month-old habit is not this week's baseline. */
  lookbackDays?: number;
  maxStatementLength?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Picks the baseline lines for a window. Pure: the caller supplies candidates it has already
 * fetched, which keeps this testable and backend-agnostic.
 */
export function selectPriorObservations(
  candidates: PriorObservationCandidate[],
  topics: ObservationTopic[],
  windowDate: string,
  options: PriorObservationOptions = {},
): SelectedPriorObservation[] {
  const maxPerTopic = options.maxPerTopic ?? 3;
  const maxTotal = options.maxTotal ?? 8;
  const lookbackDays = options.lookbackDays ?? 30;
  const maxStatementLength = options.maxStatementLength ?? 60;
  const windowMs = Date.parse(`${windowDate.slice(0, 10)}T00:00:00Z`);

  const selected: SelectedPriorObservation[] = [];
  for (const topic of topics) {
    const forTopic = candidates
      .filter((candidate) => {
        const at = Date.parse(`${candidate.observedAt.slice(0, 10)}T00:00:00Z`);
        // Strictly earlier: a later observation cannot be the baseline this window changed from.
        if (!(at < windowMs)) return false;
        if ((windowMs - at) / DAY_MS > lookbackDays) return false;
        return TOPIC_PATTERNS[topic].test(candidate.text);
      })
      .toSorted((a, b) => b.observedAt.localeCompare(a.observedAt))
      .slice(0, maxPerTopic)
      .map((candidate) => ({ sourceId: candidate.sourceId, observedAt: candidate.observedAt.slice(0, 10), topic, statement: candidate.text.replace(/\s+/g, " ").trim().slice(0, maxStatementLength) }));
    selected.push(...forTopic);
  }
  return selected.slice(0, maxTotal);
}
