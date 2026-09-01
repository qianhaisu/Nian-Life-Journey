// Care-topic classification for the worthiness gate.
//
// Teething, constipation, allergy-elimination schedules, scalp scratching, night-waking management:
// these are real, they are about the child, and the family genuinely discussed them — but they are
// day-to-day care, not a memory anyone will want surfaced as one of the child's life events. The
// subject-relevance gate (Gate A) passes them, so worthiness (Gate B) has to be the thing that
// keeps them out, and it has to do so deterministically rather than hoping a prompt holds.
//
// Downgraded, never deleted: the facts stay in the archive as care/daily material.
const CARE_TOPIC = /便秘|拉屎|大便|拉肚子|腹泻|尿布疹|小便|尿量|排敏|过敏|湿疹|出牙|长牙|萌牙|牙龈|抓头|头垢|发烧|发热|退烧|咳嗽|感冒|鼻涕|喷嚏|呕吐|吐奶|胀气|肠绞痛|疹子|体温|喂药|吃药|药|疫苗|针|体检|哭闹|夜醒|睡眠记录|哄睡|抱睡|奶粉|喂养|辅食|排便/;

// A genuine new ability. Care topics deliberately take precedence over this list: "人生首次便秘"
// is phrased as a first, but it is still constipation, and a milestone word must not be able to
// promote a care topic into a life event.
const MILESTONE_TOPIC = /第一次|首次|学会|会爬|会走|会站|扶墙站|站起来|开口|会说|叫爸爸|叫妈妈|自己吃|自己走|迈步|翻身|独坐|里程碑/;

export type CareClassification = { careCount: number; milestoneCount: number; total: number; ratio: number; careDominated: boolean; qualifiesAsLifeEvent: boolean };

// Two separate judgements:
//   careDominated       — care carries at least half the batch: clearly a care record.
//   qualifiesAsLifeEvent — the stricter worthiness bar. A batch earns LifeEvent status only when it
//                          records a new ability, or when it contains no care content at all. That
//                          keeps "自己会爬" and "吃西红柿鸡蛋面" while dropping sleep-schedule
//                          planning and a difficult afternoon of crying, which are real and about
//                          the child but are care, not memories.
export function classifyCareTopics(statements: string[]): CareClassification {
  const meaningful = statements.map((statement) => statement.trim()).filter(Boolean);
  const total = meaningful.length;
  if (total === 0) return { careCount: 0, milestoneCount: 0, total: 0, ratio: 0, careDominated: false, qualifiesAsLifeEvent: false };
  const careCount = meaningful.filter((statement) => CARE_TOPIC.test(statement)).length;
  const milestoneCount = meaningful.filter((statement) => MILESTONE_TOPIC.test(statement) && !CARE_TOPIC.test(statement)).length;
  const ratio = careCount / total;
  return {
    careCount, milestoneCount, total, ratio,
    careDominated: milestoneCount === 0 && ratio >= 0.5,
    qualifiesAsLifeEvent: milestoneCount >= 1 || careCount === 0,
  };
}

export function isCareDominated(statements: string[]): boolean {
  return classifyCareTopics(statements).careDominated;
}

export function qualifiesAsLifeEvent(statements: string[]): boolean {
  return classifyCareTopics(statements).qualifiesAsLifeEvent;
}
