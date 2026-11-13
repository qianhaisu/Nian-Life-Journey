import type { ReactNode } from "react";

type MotifRenderer = () => ReactNode;

const MOTIFS: Record<string, MotifRenderer> = {
  // 杭州：三潭印月小石塔 + 西湖拱桥
  "cn:330100": () => (
    <>
      <path d="M16 68 Q34 54 50 68 Q66 54 84 68" strokeWidth="1.7" />
      <path d="M12 74 Q32 71 50 74 Q68 77 88 74" strokeWidth="1.5" />
      <path d="M47 46 L50 32 L53 46 Z" strokeWidth="1.6" />
      <circle cx="50" cy="52" r="5.5" strokeWidth="1.6" />
      <path d="M46 57 L45 66 M54 57 L55 66" strokeWidth="1.6" />
    </>
  ),
  // 温州：江心屿双塔 + 瓯江帆影
  "cn:330300": () => (
    <>
      <path d="M27 64 L31 32 L35 64 M26 44 H36 M25 54 H37" strokeWidth="1.6" />
      <path d="M65 64 L69 30 L73 64 M64 42 H74 M63 53 H75" strokeWidth="1.6" />
      <path d="M44 66 L52 44 L58 66 Z" strokeWidth="1.5" />
      <path d="M14 73 Q36 69 52 73 Q70 77 86 73" strokeWidth="1.5" />
    </>
  ),
  // 湖州：太湖月亮酒店 + 莫干山竹影
  "cn:330500": () => (
    <>
      <path d="M31 70 A21 21 0 1 1 69 70" strokeWidth="2.1" />
      <path d="M38 70 A14 14 0 1 1 62 70" strokeWidth="1.5" />
      <path d="M18 72 Q50 68 82 72" strokeWidth="1.5" />
      <path d="M20 62 L23 30 M22 44 L15 39 M22 36 L29 31" strokeWidth="1.5" />
    </>
  ),
  // 绍兴：乌篷船 + 石拱桥
  "cn:330600": () => (
    <>
      <path d="M16 64 Q50 40 84 64" strokeWidth="1.8" />
      <path d="M26 64 A24 18 0 0 1 74 64" strokeWidth="1.5" />
      <path d="M30 73 Q50 79 70 73 L66 68 H34 Z" strokeWidth="1.6" />
      <path d="M39 68 Q50 58 61 68" strokeWidth="1.6" />
      <path d="M14 79 Q50 75 86 79" strokeWidth="1.4" />
    </>
  ),
  // 宁波：天一阁飞檐 + 三江口帆影
  "cn:330200": () => (
    <>
      <path d="M22 48 Q50 38 78 48 L72 52 H28 Z" strokeWidth="1.7" />
      <path d="M32 52 V68 M44 52 V68 M56 52 V68 M68 52 V68" strokeWidth="1.5" />
      <path d="M24 68 H76" strokeWidth="1.6" />
      <path d="M18 75 Q50 71 82 75" strokeWidth="1.4" />
    </>
  ),
  // 舟山：跨海斜拉桥 + 岛屿灯塔
  "cn:330900": () => (
    <>
      <path d="M48 68 L50 28 L52 68" strokeWidth="1.8" />
      <path d="M50 32 L20 64 M50 38 L30 64 M50 32 L80 64 M50 38 L70 64" strokeWidth="1.35" />
      <path d="M14 66 H86" strokeWidth="1.7" />
      <path d="M16 75 Q34 71 50 75 Q68 79 84 75" strokeWidth="1.5" />
    </>
  ),
  // 金华/义乌：拨浪鼓 + 商贸拱廊
  "cn:330700": () => (
    <>
      <circle cx="50" cy="44" r="14" strokeWidth="1.8" />
      <path d="M50 58 V76" strokeWidth="2.0" />
      <path d="M36 44 Q30 48 27 52 M64 44 Q70 48 73 52" strokeWidth="1.5" />
      <circle cx="26" cy="53" r="2.3" strokeWidth="1.5" />
      <circle cx="74" cy="53" r="2.3" strokeWidth="1.5" />
      <path d="M22 72 Q36 62 50 72 Q64 62 78 72" strokeWidth="1.4" />
    </>
  ),
  // 嘉兴：南湖画舫 + 烟雨楼重檐
  "cn:330400": () => (
    <>
      <path d="M34 40 Q50 32 66 40 H34 Z M28 50 Q50 43 72 50 H28 Z" strokeWidth="1.6" />
      <path d="M36 50 V62 M64 50 V62" strokeWidth="1.5" />
      <path d="M24 68 L30 74 H70 L76 68 Z" strokeWidth="1.7" />
      <path d="M16 78 Q50 74 84 78" strokeWidth="1.4" />
    </>
  ),
  // 台州：神仙居奇峰云海
  "cn:331000": () => (
    <>
      <path d="M20 72 L34 36 L44 62 L56 26 L68 58 L80 72" strokeWidth="1.8" />
      <path d="M18 64 Q36 58 50 64 Q66 70 84 62" strokeWidth="1.5" />
    </>
  ),
  // 丽水：梯田云雾山
  "cn:331100": () => (
    <>
      <path d="M18 66 Q38 46 58 62 Q70 50 84 66" strokeWidth="1.7" />
      <path d="M20 72 Q46 60 80 72 M24 78 Q50 68 76 78" strokeWidth="1.5" />
      <circle cx="68" cy="34" r="5" strokeWidth="1.5" />
    </>
  ),
  // 上海：东方明珠 + 外滩天际线
  "cn:310000": () => (
    <>
      <path d="M50 18 V31 M47 68 L50 38 L53 68" strokeWidth="1.7" />
      <circle cx="50" cy="35" r="4.5" strokeWidth="1.7" />
      <circle cx="50" cy="54" r="7" strokeWidth="1.7" />
      <path d="M22 72 V56 H32 V72 M68 72 V50 H78 V72 M14 72 H86" strokeWidth="1.6" />
    </>
  ),
  // 苏州：虎丘塔 + 园林月亮门
  "cn:320500": () => (
    <>
      <circle cx="50" cy="54" r="22" strokeWidth="1.5" />
      <path d="M44 68 L48 26 L53 26 L56 68" strokeWidth="1.65" />
      <path d="M43 36 H57 M42 46 H58 M41 56 H59" strokeWidth="1.45" />
    </>
  ),
  // 南京：紫金山城墙垛口 + 梧桐枝
  "cn:320100": () => (
    <>
      <path d="M18 68 V50 H26 V55 H34 V50 H42 V55 H58 V50 H66 V55 H74 V50 H82 V68 Z" strokeWidth="1.65" />
      <path d="M24 44 Q50 24 76 44" strokeWidth="1.5" />
    </>
  ),
  // 无锡：太湖鼋头渚帆船 + 樱花枝
  "cn:320200": () => (
    <>
      <path d="M48 64 V28 L68 58 H48 M46 64 V36 L32 58 H46" strokeWidth="1.7" />
      <path d="M26 68 L32 74 H68 L74 68 Z" strokeWidth="1.6" />
      <path d="M16 78 Q50 74 84 78" strokeWidth="1.4" />
    </>
  ),
  // 成都（含川西）：大熊猫 + 雪山远峰 + 竹枝
  "cn:510100": () => (
    <>
      <path d="M14 66 L32 38 L46 58 L64 34 L86 66" strokeWidth="1.4" />
      <circle cx="38" cy="44" r="5" strokeWidth="1.7" />
      <circle cx="62" cy="44" r="5" strokeWidth="1.7" />
      <circle cx="50" cy="56" r="13" strokeWidth="1.75" />
      <circle cx="44" cy="54" r="2.2" strokeWidth="1.6" />
      <circle cx="56" cy="54" r="2.2" strokeWidth="1.6" />
      <path d="M48 61 Q50 63 52 61" strokeWidth="1.5" />
    </>
  ),
  // 西安：大雁塔 + 古城墙
  "cn:610100": () => (
    <>
      <path d="M49 22 L50 16 L51 22" strokeWidth="1.6" />
      <path d="M39 68 L44 26 H56 L61 68" strokeWidth="1.75" />
      <path d="M41 34 H59 M40 42 H60 M39 50 H61 M38 58 H62" strokeWidth="1.5" />
      <path d="M18 72 H82" strokeWidth="1.7" />
    </>
  ),
  // 洛杉矶：圣莫尼卡摩天轮 + 棕榈树
  "us:us-ca-losangeles": () => (
    <>
      <circle cx="60" cy="46" r="16" strokeWidth="1.65" />
      <path d="M60 30 V62 M44 46 H76 M49 35 L71 57 M71 35 L49 57 M52 72 L60 62 L68 72" strokeWidth="1.35" />
      <path d="M28 72 Q30 54 26 38" strokeWidth="1.8" />
      <path d="M26 38 Q16 34 14 42 M26 38 Q22 28 32 30 M26 38 Q36 36 36 44" strokeWidth="1.5" />
    </>
  ),
  // 北京：天坛祈年殿
  "cn:110000": () => (
    <>
      <path d="M50 20 L34 34 H66 Z M30 44 L50 33 L70 44 H30 Z M26 55 L50 44 L74 55 H26 Z" strokeWidth="1.65" />
      <path d="M32 55 V68 H68 V55 M22 72 H78" strokeWidth="1.6" />
    </>
  ),
};

const FALLBACK_MOTIF: MotifRenderer = () => (
  <>
    <path d="M18 68 L38 40 L54 60 L68 42 L84 68" strokeWidth="1.7" />
    <circle cx="70" cy="30" r="5" strokeWidth="1.5" />
    <path d="M14 74 Q50 70 86 74" strokeWidth="1.4" />
  </>
);

export const CITY_STAMP_MOTIF_KEYS = Object.keys(MOTIFS);

export function hasCityStampMotif(stampKey: string): boolean {
  return Object.hasOwn(MOTIFS, stampKey);
}

export function TravelStampMotif({ stampKey }: { stampKey: string }) {
  const renderMotif = MOTIFS[stampKey] ?? FALLBACK_MOTIF;
  return (
    <svg className="travel-stamp-motif" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {renderMotif()}
    </svg>
  );
}
