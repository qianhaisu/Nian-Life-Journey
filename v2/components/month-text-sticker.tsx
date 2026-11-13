export type TextStickerTheme =
  | "reading"
  | "toy"
  | "outdoor"
  | "food"
  | "sleep"
  | "care"
  | "walk"
  | "animal"
  | "water"
  | "music"
  | "weather"
  | "family"
  | "journal";

const THEME_RULES: readonly { theme: TextStickerTheme; pattern: RegExp }[] = [
  { theme: "reading", pattern: /绘本|读书|小汽车书|翻书|画册|看书|认字|识字|故事书/ },
  { theme: "toy", pattern: /小车|绿小车|汽车|积木|拼图|玩具|滑板车|足球|皮球|气球|摇摇车/ },
  { theme: "care", pattern: /发烧|医院|看病|医生|吃药|体检|打针|疫苗|咳嗽|感冒|体温/ },
  { theme: "food", pattern: /吃饭|辅食|面条|米糊|粥|水果|西瓜|草莓|零食|喝奶|小勺|餐椅|蛋糕|面包|苹果|香蕉|吃/ },
  { theme: "sleep", pattern: /午睡|夜灯|哄睡|被窝|晚安|睡觉|睡着|醒来|小床|做梦/ },
  { theme: "water", pattern: /洗澡|玩水|泳池|泡泡|海边|浪花|刷牙|洗手|游泳/ },
  { theme: "animal", pattern: /小猫|猫咪|小狗|狗狗|麻雀|小鸟|金鱼|小鱼|鸭子|蝴蝶|动物/ },
  { theme: "music", pattern: /音乐|唱歌|儿歌|跳舞|拍手|打鼓|弹琴|哼歌/ },
  { theme: "weather", pattern: /下雨|雨伞|下雪|彩虹|云朵|刮风/ },
  { theme: "outdoor", pattern: /滑梯|公园|草坪|秋千|户外|阳光|晒太阳|银杏|落叶|花|树|草地|阳台/ },
  { theme: "walk", pattern: /散步|出门|走路|迈步|学步|推车|扶着|站起来|爬行/ },
  { theme: "family", pattern: /爸爸|妈妈|外婆|外公|爷爷|奶奶|雪姨|抱抱|亲亲|开心|笑/ },
];

export function pickMonthTextStickerTheme(title?: string, summary?: string): TextStickerTheme {
  const combined = `${title ?? ""} ${summary ?? ""}`.trim();
  if (!combined) return "journal";
  for (const rule of THEME_RULES) {
    if (rule.pattern.test(combined)) return rule.theme;
  }
  return "journal";
}

function StickerIllustration({ theme }: { theme: TextStickerTheme }) {
  switch (theme) {
    case "reading":
      return (
        <svg viewBox="0 0 48 48" className="month-text-sticker-svg" aria-hidden="true" focusable="false">
          <path d="M8 14c0-2 2-3 4-3h10v25H12c-2 0-4 1-4 2.5V14z" fill="#DBEAFE" stroke="#3B82F6" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M40 14c0-2-2-3-4-3H26v25h10c2 0 4 1 4 2.5V14z" fill="#EFF6FF" stroke="#3B82F6" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M13 18h5M13 23h5M30 18h5M30 23h4" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round" />
          <path d="M24 7l1.2 2.4 2.6.4-1.9 1.8.4 2.6L24 13l-2.3 1.2.4-2.6-1.9-1.8 2.6-.4L24 7z" fill="#F59E0B" />
        </svg>
      );
    case "toy":
      return (
        <svg viewBox="0 0 48 48" className="month-text-sticker-svg" aria-hidden="true" focusable="false">
          <path d="M10 27l4-9c.7-1.6 2.2-2.5 4-2.5h12c1.8 0 3.3.9 4 2.5l4 9v7c0 1.4-1.1 2.5-2.5 2.5H12.5C11.1 36.5 10 35.4 10 34v-7z" fill="#D1FAE5" stroke="#059669" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M16 19.5h16l2.4 6H13.6l2.4-6z" fill="#ECFDF5" />
          <circle cx="16.5" cy="36.5" r="4" fill="#334155" stroke="#FFFFFF" strokeWidth="1.6" />
          <circle cx="31.5" cy="36.5" r="4" fill="#334155" stroke="#FFFFFF" strokeWidth="1.6" />
          <circle cx="24" cy="30.5" r="2" fill="#F59E0B" />
        </svg>
      );
    case "outdoor":
      return (
        <svg viewBox="0 0 48 48" className="month-text-sticker-svg" aria-hidden="true" focusable="false">
          <circle cx="34" cy="14" r="5" fill="#FDE68A" stroke="#F59E0B" strokeWidth="2" />
          <path d="M20 38V24" stroke="#92400E" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="20" cy="20" r="9.5" fill="#BBF7D0" stroke="#16A34A" strokeWidth="2.2" />
          <path d="M9 38h30" stroke="#22C55E" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M31 32c2-3 5-4 7-2-1 3-4 4-7 2z" fill="#FBBF24" />
        </svg>
      );
    case "food":
      return (
        <svg viewBox="0 0 48 48" className="month-text-sticker-svg" aria-hidden="true" focusable="false">
          <path d="M10 24h28c0 8.5-6.2 14-14 14s-14-5.5-14-14z" fill="#FEF3C7" stroke="#D97706" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M16 38h16" stroke="#D97706" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M30 12l5 10" stroke="#EA580C" strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="36" cy="11" rx="3.2" ry="2.2" transform="rotate(-25 36 11)" fill="#FDBA74" stroke="#EA580C" strokeWidth="1.8" />
          <path d="M18 17c0-2 2-3 2-5M24 16c0-2 2-3 2-5" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "sleep":
      return (
        <svg viewBox="0 0 48 48" className="month-text-sticker-svg" aria-hidden="true" focusable="false">
          <path d="M30 12a12 12 0 1 0 9 19.8A10 10 0 0 1 30 12z" fill="#FDE68A" stroke="#D97706" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M33 14l1 2 2 .3-1.5 1.4.4 2-1.9-1-1.9 1 .4-2-1.5-1.4 2-.3 1-2z" fill="#F59E0B" />
          <circle cx="15" cy="15" r="1.6" fill="#A78BFA" />
        </svg>
      );
    case "care":
      return (
        <svg viewBox="0 0 48 48" className="month-text-sticker-svg" aria-hidden="true" focusable="false">
          <rect x="11" y="16" width="26" height="20" rx="5" fill="#FFE4E6" stroke="#E11D48" strokeWidth="2.2" />
          <path d="M19 16v-3c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2v3" stroke="#E11D48" strokeWidth="2.2" />
          <path d="M24 22v8M20 26h8" stroke="#E11D48" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      );
    case "walk":
      return (
        <svg viewBox="0 0 48 48" className="month-text-sticker-svg" aria-hidden="true" focusable="false">
          <ellipse cx="18" cy="21" rx="4.2" ry="6.2" transform="rotate(-12 18 21)" fill="#BFDBFE" stroke="#2563EB" strokeWidth="2" />
          <circle cx="15" cy="12" r="1.4" fill="#2563EB" />
          <circle cx="18.5" cy="11.5" r="1.4" fill="#2563EB" />
          <ellipse cx="30" cy="30" rx="4.2" ry="6.2" transform="rotate(10 30 30)" fill="#BFDBFE" stroke="#2563EB" strokeWidth="2" />
          <circle cx="29" cy="21" r="1.4" fill="#2563EB" />
          <circle cx="32.5" cy="21.5" r="1.4" fill="#2563EB" />
        </svg>
      );
    case "animal":
      return (
        <svg viewBox="0 0 48 48" className="month-text-sticker-svg" aria-hidden="true" focusable="false">
          <path d="M14 20l2-8 6 5h4l6-5 2 8c2.2 2.4 3 5 3 8 0 6.2-5.8 10-13 10S11 34.2 11 28c0-3 .8-5.6 3-8z" fill="#FFEDD5" stroke="#EA580C" strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="19.5" cy="26" r="1.7" fill="#431407" />
          <circle cx="28.5" cy="26" r="1.7" fill="#431407" />
          <path d="M22.5 29.5L24 31l1.5-1.5" stroke="#EA580C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "water":
      return (
        <svg viewBox="0 0 48 48" className="month-text-sticker-svg" aria-hidden="true" focusable="false">
          <path d="M24 10c5.5 7 9 12 9 16.5a9 9 0 1 1-18 0C15 22 18.5 17 24 10z" fill="#CFFAFE" stroke="#0891B2" strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="34" cy="15" r="3" fill="#E0F2FE" stroke="#0284C7" strokeWidth="1.8" />
          <circle cx="13" cy="19" r="2" fill="#E0F2FE" stroke="#0284C7" strokeWidth="1.6" />
        </svg>
      );
    case "music":
      return (
        <svg viewBox="0 0 48 48" className="month-text-sticker-svg" aria-hidden="true" focusable="false">
          <path d="M20 33V15l15-3v18" stroke="#7C3AED" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="16.5" cy="33.5" r="4" fill="#DDD6FE" stroke="#7C3AED" strokeWidth="2.2" />
          <circle cx="31.5" cy="30.5" r="4" fill="#DDD6FE" stroke="#7C3AED" strokeWidth="2.2" />
        </svg>
      );
    case "weather":
      return (
        <svg viewBox="0 0 48 48" className="month-text-sticker-svg" aria-hidden="true" focusable="false">
          <path d="M15 29h19a6 6 0 0 0 .6-12A8 8 0 0 0 19 15a6.5 6.5 0 0 0-4 14z" fill="#E0F2FE" stroke="#0284C7" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M18 34l-1.5 4M24 34l-1.5 4M30 34l-1.5 4" stroke="#38BDF8" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
    case "family":
      return (
        <svg viewBox="0 0 48 48" className="month-text-sticker-svg" aria-hidden="true" focusable="false">
          <path d="M24 37s-11-6.8-11-15a6.5 6.5 0 0 1 11-4.5A6.5 6.5 0 0 1 35 22c0 8.2-11 15-11 15z" fill="#FCE7F3" stroke="#DB2777" strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="36" cy="13" r="2.2" fill="#F59E0B" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 48 48" className="month-text-sticker-svg" aria-hidden="true" focusable="false">
          <rect x="12" y="10" width="24" height="28" rx="4" fill="#F3E8FF" stroke="#7C3AED" strokeWidth="2.2" />
          <path d="M18 18h12M18 24h10M18 30h7" stroke="#A78BFA" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="34" cy="14" r="3" fill="#FDE047" />
        </svg>
      );
  }
}

export function MonthTextSticker({
  title,
  summary,
}: {
  day?: string;
  title?: string;
  summary?: string;
}) {
  const theme = pickMonthTextStickerTheme(title, summary);
  return (
    <span className={`month-text-sticker month-text-sticker--${theme}`} data-sticker-theme={theme} aria-hidden="true">
      <StickerIllustration theme={theme} />
    </span>
  );
}
