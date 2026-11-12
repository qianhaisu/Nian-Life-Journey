// P5 首页定格大图与「家人的话」已审种子池（来源：p5-seeds/p5-seeds.json，经 #20 / #22 / #26 只读连库逐字核验）。
//
// 用途：
//   1. 首屏大图过渡兜底：当当月月稿尚未写入 homeHeroMediaId 时，优先尝试已人工目视审定的高清正面照候选；
//   2. 「家人的话」精选种子池：与各日页显式配置的 day.featuredQuote 合并去重，确保彻底移除旧正则抓取后，
//      即使在历史月稿尚未逐月补齐 featuredQuote 前，首页也能立即呈现原汁原味、零请假后勤语的家里口吻。

export type P5HeroSeedCandidate = {
  mediaId: string;
  month: string;
  day: string;
};

export type P5FamilyQuoteSeed = {
  day: string;
  month: string;
  text: string;
  speaker: string;
  sourceId: string;
};

export const P5_HERO_SEED_CANDIDATES: readonly P5HeroSeedCandidate[] = [
  {
    mediaId: "wechat-media:ecdc3bd2fd1c27319dd78b5bf65db729bac0dfb74141607a798c9d35edaaa9d8",
    month: "2026-11",
    day: "2026-11-09",
  },
  {
    mediaId: "wechat-media:153d37cc7468487383c38deec14b948752f3c2e088eb31ac3889fcad1f0c56ff",
    month: "2026-11",
    day: "2026-11-02",
  },
  {
    mediaId: "wechat-media:879e81579b4600cad20500325ca91967bfc314b45e5e020e6ef27d5cbdcb69b5",
    month: "2026-10",
    day: "2026-10-28",
  },
];

export const P5_FAMILY_QUOTE_SEEDS: readonly P5FamilyQuoteSeed[] = [
  {
    day: "2026-07-15",
    month: "2026-07",
    text: "我一看到年年心里就高兴不知怎的",
    speaker: "外婆",
    sourceId: "wechat-message:canonical:d53a0f028c7a12b6865ccd5ba437735fdc6bbdce312c44ed9a2398e097599f97",
  },
  {
    day: "2025-09-05",
    month: "2025-09",
    text: "张小年的两条小腿，不动好像不行，老是动。不过，还是挺有趣的。",
    speaker: "外婆",
    sourceId: "wechat-message:canonical:be30a5c106eaf04a62769ea9f5f2d7188684ae57fb4c1138ad7e79b40cdfd844",
  },
  {
    day: "2025-11-27",
    month: "2025-11",
    text: "他又长高了，又长新牙了",
    speaker: "外婆",
    sourceId: "wechat-message:canonical:825d1d3920963054cb088658ca10fa4e619dcc1320dfd4d37473b433e85e7678",
  },
  {
    day: "2026-05-20",
    month: "2026-05",
    text: "把小年养得胖墩墩",
    speaker: "外婆",
    sourceId: "wechat-message:canonical:a62419820df14d3156f6e4563da1933064d9a1f70fa9b42f812ff20fff42ea17",
  },
  {
    day: "2025-01-21",
    month: "2025-01",
    text: "今天挻快活的，越来越老练了。",
    speaker: "外公",
    sourceId: "wechat-message:canonical:cd562aa3e47cec963d01700d6b375d028b62948c41552ec9036060ca67f72e78",
  },
  {
    day: "2025-02-04",
    month: "2025-02",
    text: "现在他都想与你们交流了。",
    speaker: "外公",
    sourceId: "wechat-message:canonical:9380b120b759d34f4821a6fb64a618000d9a555598b39609fbac880c7fc65170",
  },
  {
    day: "2026-07-16",
    month: "2026-07",
    text: "小年年挺有胆量，抓得可带劲！",
    speaker: "外公",
    sourceId: "wechat-message:canonical:2aaa1c2b0e42f40a5964cffcd4e09e0acd37ec9830ca0880ef2821d3d8b9bf50",
  },
  {
    day: "2026-09-02",
    month: "2026-09",
    text: "吃点心，小年年每次都比别的孩子快点哦。",
    speaker: "外公",
    sourceId: "wechat-message:canonical:514c0bc70838f123dfbddb21b4bc30748a00ccff86d303e358d56f84b4cc0743",
  },
  {
    day: "2025-01-21",
    month: "2025-01",
    text: "过去都是手缝的小衣服穿到里面睡觉。",
    speaker: "奶奶",
    sourceId: "wechat-message:canonical:7b526967f71bb78d4b2c8b9bf2bfd9ef4dc05b21e5384351366b9ee7536c98ab",
  },
  {
    day: "2025-03-18",
    month: "2025-03",
    text: "拍的好，喜人的很。",
    speaker: "奶奶",
    sourceId: "wechat-message:canonical:3423ded9a454ac3501352e7c3770e46a5e79168a6cb5bfbf489507f47a230042",
  },
  {
    day: "2026-02-28",
    month: "2026-02",
    text: "换个老师关心了还一脸懵呢，反复看老师",
    speaker: "奶奶",
    sourceId: "wechat-message:canonical:fbf87e9c21b5bb7010bac1fab29c5b5a7d77459f7c6f0c6f09fbf6997c1e689e",
  },
  {
    day: "2025-03-21",
    month: "2025-03",
    text: "小年年武术练的不错",
    speaker: "爷爷",
    sourceId: "wechat-message:canonical:63109b6c0866cc22ca8e9e6e3cf76a44b7ec99a496aba2c14ee5aa3a3ddaf352",
  },
  {
    day: "2025-06-22",
    month: "2025-06",
    text: "小年年有朋友了",
    speaker: "爷爷",
    sourceId: "wechat-message:canonical:d50196d5746e8320ac9f85b9710965ec0ed0118a75f8cec7fcc9c6dacf53e869",
  },
  {
    day: "2025-11-16",
    month: "2025-11",
    text: "小年年会开大汽车了",
    speaker: "爷爷",
    sourceId: "wechat-message:canonical:12f954d75383d3dc435c43983b718062b2db4e8c9bb08c96881c2a4394a08538",
  },
  {
    day: "2025-04-09",
    month: "2025-04",
    text: "我也想放下，经常落地醒，落地哭",
    speaker: "妈妈",
    sourceId: "wechat-message:canonical:7471a7117bbee816d2f92b65025fba1b1b4dea5e8113fd9b1415174a671b1f84",
  },
  {
    day: "2026-09-24",
    month: "2026-09",
    text: "我知道为什么张小年跳得最好了，因为我估计全班就是他看电视看得最多",
    speaker: "妈妈",
    sourceId: "wechat-message:canonical:d3529811dbf21d5541d493069c50c0dc42e83a2008e3ad9352198ef94a244caf",
  },
  {
    day: "2026-10-14",
    month: "2026-10",
    text: "我们要让张小年继续笑眯眯",
    speaker: "妈妈",
    sourceId: "wechat-message:canonical:75b4af5b8c46e24fc8b86e120dd528480d5f45d85267080121aa5e87ccf5472c",
  },
  {
    day: "2026-10-22",
    month: "2026-10",
    text: "好家伙，我张小年总是担心没吃的",
    speaker: "妈妈",
    sourceId: "wechat-message:canonical:7957631280d28fdef0437c4145e0e91b7984000f88cd7637fb2c43f4cd6d2431",
  },
  {
    day: "2025-12-12",
    month: "2025-12",
    text: "当然没人比我们爱小年",
    speaker: "爸爸",
    sourceId: "wechat-message:canonical:16a1a06a75ff873622944db532fb6b35e2d7ebe34100a853f7dc8bcaac6269bd",
  },
  {
    day: "2026-02-24",
    month: "2026-02",
    text: "其实我最想看张小年跟着一排小朋友排队过马路的画面",
    speaker: "爸爸",
    sourceId: "wechat-message:canonical:38ccbc8e934c506febdf11fe59a7b699e6ee60c8eed2f4210492987f491a39b4",
  },
  {
    day: "2026-07-12",
    month: "2026-07",
    text: "他现在睡觉bgm换成好宝宝了",
    speaker: "爸爸",
    sourceId: "wechat-message:canonical:473a7f074602a227cf6ca5740e8cba700e15ec2f7458390921dfd910b61e8dc3",
  },
  {
    day: "2025-07-15",
    month: "2025-07",
    text: "看他一只手向上放着。放在那里就是想睡觉来了",
    speaker: "雪姨",
    sourceId: "wechat-message:canonical:6f2a237d0d55e1bdd7935af8d9f8a667b5b1d58d0922573aa5b2e05456c91fea",
  },
  {
    day: "2026-04-16",
    month: "2026-04",
    text: "没有一个小男孩能拒绝挖掘机",
    speaker: "多多",
    sourceId: "wechat-message:canonical:2f6293bc5894d31d4c18fb2093aec072882c8f344ffc4b864d75ad848622a801",
  },
  {
    day: "2026-07-14",
    month: "2026-07",
    text: "一说小年，泡澡去了，自己两只鞋子一拿踏踏踏的走了",
    speaker: "潇潇老师",
    sourceId: "wechat-message:canonical:919e334aa0f61bfa477f502a7b0150f504a232242d9708ab50b95516754cdeaf",
  },
];
