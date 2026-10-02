import type { TimelineDay } from "./month-timeline";
import type { MediaRef } from "./memory-chapters";
import { displayIdentity } from "./media/display-identity";
import { ageOn, formatMonth } from "./time-signature";

/** Published reading material only. Never raw sources, unreviewed event identities or face guesses. */
export type ReadingDay = Pick<TimelineDay, "day" | "href" | "title" | "ageLabel" | "photos" | "milestone" | "lead"> & { paragraphs: string[] };
export type ReadingMatch = { entry: ReadingDay; excerpt: string };
export function readingAge(birthDay: string | undefined, day: string, knownAge?: string): string | undefined {
  return ageOn(birthDay, day) ?? knownAge ?? (birthDay && day < birthDay ? "出生前" : undefined);
}
/** One day picture per requested position; file aliases and known scenes stay unique on the page. */
export function selectReadingPhotos(entries: readonly ReadingDay[], sceneKey: (media: MediaRef) => string | undefined = () => undefined): (MediaRef | undefined)[] {
  const files = new Set<string>(); const scenes = new Set<string>();
  return entries.map(entry => entry.photos.find(media => {
    const key = displayIdentity(media); const scene = sceneKey(media);
    if (media.type !== "photo" || files.has(key) || (scene && scenes.has(scene))) return false;
    files.add(key); if (scene) scenes.add(scene); return true;
  }));
}
export const GROWTH_CATEGORIES = [
  { id: "language", label: "语言" }, { id: "action", label: "行动" },
  { id: "sleep", label: "睡眠" }, { id: "interest", label: "兴趣" },
] as const;
export type GrowthCategory = typeof GROWTH_CATEGORIES[number]["id"];

// These rules organise already published words; they do not diagnose abilities or invent milestones.
// Separate threads keep walking, eating and toileting from becoming one supposed progression.
export const GROWTH_THREADS: { id: string; category: GrowthCategory; title: string; match: RegExp }[] = [
  { id: "words", category: "language", title: "从称呼到表达", match: /(?:他|张年|张小年|小年年?|宝宝|宝贝)[「“"]?(?:现在|最近|刚刚|已经|开始|终于|还|也|自己|会|能|很|慢慢|试着|学着|开心地|在班里|学会|了|又|就|不太|还不|不会){0,5}(?:说|喊|叫|念|开口|发音|来一句)|(?:会|开始|试着|学着|学会了?|能|开口)(?:叫|喊|说)(?:[「“"]|爸爸|妈妈|奶奶|爷爷|外公|外婆)|(?:他|张年|小年|宝宝|宝贝)[「“][^」”]{0,24}(?:自己说|会说|说了|喊着|叫着)/ },
  { id: "walking", category: "action", title: "身体和脚步的变化", match: /翻身|会翻|翻过来|走路|走了|迈步|迈出|独立行走|站起来|扶站|爬行(?!垫)|会爬|学爬|自己爬|跑起来|自己走|学走/ },
  { id: "eating", category: "action", title: "自己吃饭的尝试", match: /自己(?!给|帮|为|把).{0,4}(?:吃|拿.{0,2}勺|用.{0,2}勺)|(?:独立|自主)(?:吃|进食)|(?:他|小年|张年|宝宝|宝贝).{0,12}(?:握|拿|用).{0,6}(?:勺|筷)/ },
  { id: "toileting", category: "action", title: "小马桶的日子", match: /马桶|如厕|自己尿|自己拉|自主排便/ },
  { id: "sleeping", category: "sleep", title: "睡眠里的变化", match: /午睡|入睡|睡着|睡醒|夜醒|夜奶|整觉|哄睡|睡眠|睡了|睡得|睡觉/ },
  { id: "vehicles", category: "interest", title: "车和轮子的日子", match: /玩具车|玩具挖掘机|玩具翻斗车|小汽车|积木火车|(?:喜欢|爱玩|追着|盯着).{0,5}(?:车|轮子|挖掘机|火车)/ },
  { id: "books", category: "interest", title: "书和故事", match: /绘本|看书|读书|翻书|听故事|讲故事/ },
  { id: "music", category: "interest", title: "音乐响起来的时候", match: /音乐|跳舞|唱歌|儿歌|钢琴|打鼓/ },
  { id: "play", category: "interest", title: "想玩的那些东西", match: /玩水|玩沙|搭积木|踢球|拍球|玩球|玩玩具|玩(?:着|了).{0,4}玩具|喜欢.{0,4}(?:玩具|球|水|沙|积木)|拿.{0,8}(?:玩具|小球)|抱.{0,8}球|积木.{0,6}搭/ },
];

const compact = (text: string) => text.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
export function readingTexts(entry: ReadingDay): string[] {
  return entry.paragraphs.length ? entry.paragraphs : entry.title ? [entry.title] : [];
}

/** Sentence boundaries outside quotes. An attributed quotation stays attached to its attribution. */
export function readingSentences(text: string): string[] {
  const out: string[] = []; let start = 0; const closing: string[] = [];
  const pairs: Record<string, string> = { "「": "」", "“": "”", "『": "』" };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (pairs[char]) closing.push(pairs[char]);
    else if (char === closing.at(-1)) closing.pop();
    if (!closing.length && /[。！？；\n]/.test(char)) { const unit = text.slice(start, i + 1).trim(); if (unit) out.push(unit); start = i + 1; }
  }
  const rest = text.slice(start).trim(); if (rest) out.push(rest);
  return out;
}

const CHILD = /他|张年|张小年|小年|宝宝|宝贝/;
const PLANNING_ONLY = /希望|建议|应该|打算|准备|计划|下周|明天|以后|目标是|主题是|老师写的|需要与他|每天让他|没有啦|就是一瞬间|注意.{0,8}(?:不要|别)|可以.{0,8}(?:让|给|带|陪|与|对他|和他)|让他.{0,8}(?:试|练|学)|要不要|[？?]/;
function childSpeechText(text: string): string {
  // "妈妈看着他说" means mother spoke *to* him, not that he spoke.
  return text.replace(/(?:看着|对着|对|向|跟|和|与|告诉|问|替|代|帮)(?:他|小年年?|张年|宝宝|宝贝)(?=说|讲|喊|叫)/g, "听的人");
}
function childSpeechRecord(text: string): boolean {
  if (!GROWTH_THREADS[0].match.test(childSpeechText(text)) || PLANNING_ONLY.test(text) || /给孩子|给宝宝|没力气|上班|出差/.test(text)) return false;
  return quotesIn(text).length > 0 || /会(?:说|喊|叫)|(?:试着|学着|尝试|开始)(?:说|喊|叫)|开口|发音|英语单词|跟着读|词汇|来一句|(?:他说|小年说)[\p{Script=Han}]{1,3}[。！…]$/u.test(text);
}
function childSpeechSegments(text: string): string[] {
  const cleaned = childSpeechText(text);
  return [...cleaned.matchAll(new RegExp(GROWTH_THREADS[0].match.source, "g"))].map(match => {
    const after = cleaned.slice(match.index! + match[0].length).replace(/^[，、：:“「"\s了过]+/, "");
    // Stop at the end of this utterance, before another person's words in the same sentence.
    return match[0] + after.split(/[」”"，。；！？\n]/)[0];
  });
}
export function growthExcerpt(entry: ReadingDay, thread: typeof GROWTH_THREADS[number]): string | undefined {
  return readingTexts(entry).flatMap(readingSentences).find(text => {
    if (!thread.match.test(thread.id === "words" ? childSpeechText(text) : text) || PLANNING_ONLY.test(text)) return false;
    // Group photography and adult actions are not this child's growth evidence.
    if (/孩子们|宝宝们|几个孩子|一个孩子|有的.{0,12}有的/.test(text) && !/张年|张小年|小年/.test(text)) return false;
    if (thread.id === "words") {
      if (/妈妈说|爸爸说|爷爷说|奶奶说|外公说|外婆说|老师说/.test(text) && !CHILD.test(text.replace(/他们|孩子们|宝宝们/g, ""))) return false;
      return childSpeechRecord(text);
    }
    return CHILD.test(text) || /^(?:会|开始|试着|学着|自己|午睡|睡觉|睡眠|入睡|夜醒|整觉)/.test(text);
  });
}

/** Exact excerpts; no generated speech, inferred speaker or synthetic "first". */
export function quotesIn(text: string): string[] {
  const quotes: string[] = [];
  for (const match of text.matchAll(/「([^「」\n]{1,100})」|“([^“”\n]{1,100})”|"([^"\n]{1,100})"/g)) {
    const quote = (match[1] ?? match[2] ?? match[3]).trim();
    if (quote && !quotes.includes(quote)) quotes.push(quote);
  }
  return quotes;
}

export type GrowthThread = typeof GROWTH_THREADS[number] & { matches: ReadingMatch[]; anchors: ReadingMatch[] };
export function growthThreads(entries: readonly ReadingDay[], birthDay?: string): GrowthThread[] {
  const ordered = [...entries].filter(entry => !!birthDay && entry.day >= birthDay).sort((a, b) => a.day.localeCompare(b.day));
  return GROWTH_THREADS.flatMap(thread => {
    const seen = new Set<string>();
    const matches: ReadingMatch[] = [];
    for (const entry of ordered) {
      const excerpt = growthExcerpt(entry, thread);
      if (!excerpt || seen.has(compact(excerpt))) continue;
      seen.add(compact(excerpt));
      matches.push({ entry, excerpt });
    }
    if (!matches.length) return [];
    const indexes = matches.length <= 3 ? matches.map((_, i) => i) : [0, Math.floor((matches.length - 1) / 2), matches.length - 1];
    return [{ ...thread, matches, anchors: indexes.map(index => matches[index]) }];
  });
}

export type ReadingPerson = { id: string; label: string; aliases: readonly string[] };
// Family relationship labels have been confirmed in the identity registry. Generic "老师" is a
// collective reading entrance, never an inferred single teacher. No image/person association here.
export const READING_PEOPLE: readonly ReadingPerson[] = [
  { id: "mother", label: "妈妈", aliases: ["妈妈", "苏静", "阿静"] },
  { id: "father", label: "爸爸", aliases: ["爸爸"] },
  { id: "maternal-grandfather", label: "外公", aliases: ["外公"] },
  { id: "maternal-grandmother", label: "外婆", aliases: ["外婆"] },
  { id: "grandmother", label: "奶奶", aliases: ["奶奶"] },
  { id: "grandfather", label: "爷爷", aliases: ["爷爷"] },
  { id: "xueyi", label: "雪姨", aliases: ["雪姨"] },
  { id: "teacher-dabing", label: "大兵老师", aliases: ["大兵老师"] },
  { id: "teacher-xiaoxiao", label: "潇潇老师", aliases: ["潇潇老师"] },
  { id: "teacher-yangyang", label: "阳阳老师", aliases: ["阳阳老师"] },
  { id: "teachers", label: "老师们", aliases: ["老师"] },
];
export function personMatches(entries: readonly ReadingDay[], person: ReadingPerson): ReadingMatch[] {
  return [...entries].sort((a, b) => a.day.localeCompare(b.day)).flatMap(entry => {
    const excerpt = readingTexts(entry).flatMap(readingSentences).find(text => person.aliases.some(alias => text.includes(alias)));
    return excerpt ? [{ entry, excerpt }] : [];
  });
}

type SearchTerm = { alternatives: string[] };
export function searchTerms(query: string): SearchTerm[] {
  let text = compact(query).slice(0, 100);
  const terms: SearchTerm[] = [];
  for (const person of READING_PEOPLE) {
    if (person.aliases.some(alias => text.includes(alias))) {
      terms.push({ alternatives: [...person.aliases] });
      for (const alias of person.aliases) text = text.split(alias).join(" ");
    }
  }
  if (/自己(?:吃饭|吃东西|进食)/.test(text)) {
    terms.push({ alternatives: ["自己吃", "自己拿勺", "自己用勺", "自主进食", "自主吃饭", "独立进食", "独立吃饭"] });
    text = text.replace(/自己(?:吃饭|吃东西|进食)/g, " ");
  }
  // Question framing is not evidence. "第一次" selects the earliest *matching record*, and the UI
  // names it that way; missing earlier records must never become a claim about a real-life first.
  text = text.replace(/什么时候|哪一天|哪天|什么时候开始|开始|第一次|最早|后来|最近|有哪些|有没有|去过哪里|去过哪些地方|去过|在哪里|哪里|怎样|怎么|关于|张年|小年|的|了|和|与|一起|会|说|喊|叫|请|找|找找|记录|记忆|[，。！？?！「」“”"、：:]/g, " ");
  for (const part of text.split(/\s+/).filter(Boolean)) terms.push({ alternatives: [part] });
  return terms;
}
export type SearchResult = ReadingMatch & { quotes: string[] };
export function searchArchive(entries: readonly ReadingDay[], query: string): SearchResult[] {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const oldestFirst = /第一次|最早|什么时候|开始/.test(query);
  const speechIntent = /(?:说|喊|叫).+/.test(query);
  const travelTogether = /(?:和|跟|与).*(?:去过|去|到|哪里)/.test(query);
  const person = READING_PEOPLE.find(person => person.aliases.some(alias => query.includes(alias)));
  return entries.flatMap(entry => {
    const texts = entry.paragraphs.flatMap(readingSentences);
    if (entry.title) texts.push(entry.title);
    const excerpt = texts.find(text => {
      if (!terms.every(term => term.alternatives.some(word => compact(text).includes(compact(word))))) return false;
      if (speechIntent && (!childSpeechRecord(text) || /(?:还|并|尚|没|不)(?:有|能|会)?(?:说|喊|叫)/.test(text)
        || !childSpeechSegments(text).some(segment => terms.every(term => term.alternatives.some(word => compact(segment).includes(compact(word))))))) return false;
      if (travelTogether && person) return person.aliases.some(alias => {
        const match = text.match(new RegExp(`(?:和|跟|与).{0,8}${alias}.{0,12}(?:去|到|逛|游|散步)|${alias}.{0,8}(?:带|陪|抱|和|跟).{0,12}(?:去|到|逛|游|散步)`));
        return !!match && !/说|问|建议|打算|希望|可以/.test(match[0]) && !PLANNING_ONLY.test(text);
      });
      return true;
    });
    if (!excerpt) return [];
    return [{ entry, excerpt, quotes: quotesIn(excerpt) }];
  }).sort((a, b) => oldestFirst ? a.entry.day.localeCompare(b.entry.day) : b.entry.day.localeCompare(a.entry.day));
}

export type BookMonthInput = { month: string; intro?: string; title?: string; pinnedPhotoId?: string; entries: ReadingDay[] };
export type BookChapter = BookMonthInput & { id: string; selected: ReadingDay[]; photos: { media: MediaRef; entry: ReadingDay }[] };
export type YearBook = { year: string; ongoing: boolean; ageLabel?: string; intro?: string; chapters: BookChapter[]; changes: GrowthThread[] };
export function buildYearBook(year: string, months: readonly BookMonthInput[], birthDay: string | undefined, today: string,
  photoReview: { sceneKey?: (media: MediaRef) => string | undefined; value?: (media: MediaRef) => number } = {}): YearBook {
  const seenPhotos = new Set<string>();
  const seenScenes = new Set<string>();
  const chapters = [...months].filter(month => month.month.startsWith(`${year}-`) && (month.entries.length || month.intro))
    .sort((a, b) => a.month.localeCompare(b.month)).map(month => {
      const sorted = [...month.entries].sort((a, b) => a.day.localeCompare(b.day));
      const ranked = [...sorted].sort((a, b) => Number(!!b.milestone) - Number(!!a.milestone) || Number(b.lead) - Number(a.lead) || a.day.localeCompare(b.day));
      const selected = ranked.filter(day => day.paragraphs.length).slice(0, 3).sort((a, b) => a.day.localeCompare(b.day));
      const photos: BookChapter["photos"] = [];
      const coverDay = sorted.find(entry => entry.photos.some(photo => photo.id === month.pinnedPhotoId));
      const days = [...new Map([...(coverDay ? [coverDay] : []), ...selected, ...sorted].map(entry => [entry.day, entry])).values()];
      const candidates = days.map(entry => ({ entry, photos: [...entry.photos].sort((a, b) =>
        Number(b.id === month.pinnedPhotoId) - Number(a.id === month.pinnedPhotoId) || (photoReview.value?.(b) ?? 0) - (photoReview.value?.(a) ?? 0)) }));
      const take = (media: MediaRef, entry: ReadingDay) => {
        const key = displayIdentity(media);
        const scene = photoReview.sceneKey?.(media);
        if (media.type !== "photo" || seenPhotos.has(key) || (scene && seenScenes.has(scene)) || photos.length >= 2) return false;
        seenPhotos.add(key); if (scene) seenScenes.add(scene); photos.push({ media, entry }); return true;
      };
      // One picture from different meaningful days before a second from the same day.
      for (const candidate of candidates) {
        for (const media of candidate.photos) if (take(media, candidate.entry)) break;
        if (photos.length >= 2) break;
      }
      if (photos.length < 2) for (const candidate of candidates) for (const media of candidate.photos) take(media, candidate.entry);
      return { ...month, id: `chapter-${month.month}`, title: month.title?.trim() || formatMonth(month.month), selected, photos };
    });
  const entries = chapters.flatMap(chapter => chapter.entries);
  const from = entries.map(entry => entry.day).sort()[0];
  const to = entries.map(entry => entry.day).sort().at(-1);
  const firstAge = from ? readingAge(birthDay, from) : undefined;
  const lastAge = to ? readingAge(birthDay, to) : undefined;
  const threads = growthThreads(entries, birthDay);
  return { year, ongoing: year === today.slice(0, 4), ageLabel: firstAge && lastAge ? firstAge === lastAge ? firstAge : `${firstAge} 到 ${lastAge}` : undefined,
    intro: readingSentences(chapters.find(chapter => chapter.intro)?.intro ?? "")[0], chapters,
    changes: GROWTH_CATEGORIES.flatMap(category => {
      const thread = threads.find(thread => thread.category === category.id && thread.matches.length >= 2);
      return thread ? [thread] : [];
    }) };
}
