import type { ReactNode } from "react";

type MotifRenderer = () => ReactNode;

const MOTIFS: Record<string, MotifRenderer> = {
  // 杭州：三潭印月小石塔 + 西湖拱桥
  "cn:330100": () => (
    <>
      <path d="M12 72 Q34 52 50 72 Q66 52 88 72" strokeWidth="2.3" />
      <path d="M10 78 Q32 74 50 78 Q68 82 90 78" strokeWidth="1.9" />
      <path d="M46 42 L50 24 L54 42 Z" fill="currentColor" fillOpacity="0.18" strokeWidth="2.1" />
      <circle cx="50" cy="49" r="6.5" fill="currentColor" fillOpacity="0.14" strokeWidth="2.1" />
      <path d="M45 55 L44 68 M55 55 L56 68" strokeWidth="2.1" />
    </>
  ),
  // 温州：江心屿双塔 + 瓯江帆影
  "cn:330300": () => (
    <>
      <path d="M23 70 L28 24 L33 70 Z" fill="currentColor" fillOpacity="0.16" strokeWidth="2.1" />
      <path d="M22 38 H34 M21 50 H35 M20 61 H36" strokeWidth="1.8" />
      <path d="M67 70 L72 22 L77 70 Z" fill="currentColor" fillOpacity="0.16" strokeWidth="2.1" />
      <path d="M66 36 H78 M65 49 H79 M64 60 H80" strokeWidth="1.8" />
      <path d="M43 72 L51 46 L59 72 Z" fill="currentColor" fillOpacity="0.14" strokeWidth="1.9" />
      <path d="M12 78 Q36 73 52 78 Q70 83 88 78" strokeWidth="2.0" />
    </>
  ),
  // 湖州：太湖月亮酒店 + 莫干山竹影
  "cn:330500": () => (
    <>
      <path d="M28 73 A24 24 0 1 1 72 73" strokeWidth="3.0" />
      <path d="M36 73 A16 16 0 1 1 64 73" fill="currentColor" fillOpacity="0.12" strokeWidth="2.0" />
      <path d="M14 75 Q50 70 86 75" strokeWidth="2.0" />
      <path d="M18 66 L21 26 M20 44 L12 38 M20 35 L28 29" strokeWidth="2.0" />
    </>
  ),
  // 绍兴：乌篷船 + 石拱桥
  "cn:330600": () => (
    <>
      <path d="M12 66 Q50 36 88 66" strokeWidth="2.5" />
      <path d="M24 66 A26 20 0 0 1 76 66" fill="currentColor" fillOpacity="0.12" strokeWidth="2.0" />
      <path d="M26 75 Q50 83 74 75 L69 68 H31 Z" fill="currentColor" fillOpacity="0.2" strokeWidth="2.2" />
      <path d="M37 68 Q50 56 63 68" fill="currentColor" fillOpacity="0.16" strokeWidth="2.1" />
      <path d="M12 83 Q50 79 88 83" strokeWidth="1.8" />
    </>
  ),
  // 宁波：天一阁飞檐 + 三江口帆影
  "cn:330200": () => (
    <>
      <path d="M18 46 Q50 32 82 46 L74 52 H26 Z" fill="currentColor" fillOpacity="0.18" strokeWidth="2.3" />
      <path d="M26 37 Q50 28 74 37" strokeWidth="1.9" />
      <path d="M30 52 V72 M43 52 V72 M57 52 V72 M70 52 V72" strokeWidth="2.1" />
      <path d="M20 72 H80" strokeWidth="2.2" />
      <path d="M14 79 Q50 74 86 79" strokeWidth="1.8" />
    </>
  ),
  // 舟山：跨海斜拉桥 + 海浪
  "cn:330900": () => (
    <>
      <path d="M47 70 L50 22 L53 70 Z" fill="currentColor" fillOpacity="0.18" strokeWidth="2.3" />
      <path d="M50 27 L16 66 M50 36 L28 66 M50 27 L84 66 M50 36 L72 66" strokeWidth="1.75" />
      <path d="M10 68 H90" strokeWidth="2.4" />
      <path d="M14 78 Q34 73 50 78 Q68 83 86 78" strokeWidth="2.0" />
    </>
  ),
  // 金华/义乌：拨浪鼓 + 商贸拱廊
  "cn:330700": () => (
    <>
      <circle cx="50" cy="40" r="16" fill="currentColor" fillOpacity="0.15" strokeWidth="2.4" />
      <path d="M50 56 V79" strokeWidth="2.6" />
      <path d="M34 40 Q27 45 23 51 M66 40 Q73 45 77 51" strokeWidth="1.9" />
      <circle cx="22" cy="52" r="3.2" fill="currentColor" fillOpacity="0.28" strokeWidth="1.9" />
      <circle cx="78" cy="52" r="3.2" fill="currentColor" fillOpacity="0.28" strokeWidth="1.9" />
      <path d="M18 75 Q34 62 50 75 Q66 62 82 75" strokeWidth="1.9" />
    </>
  ),
  // 嘉兴：南湖画舫 + 烟雨楼重檐
  "cn:330400": () => (
    <>
      <path d="M32 36 Q50 26 68 36 H32 Z M24 48 Q50 39 76 48 H24 Z" fill="currentColor" fillOpacity="0.18" strokeWidth="2.1" />
      <path d="M34 48 V64 M66 48 V64" strokeWidth="2.0" />
      <path d="M20 70 L28 78 H72 L80 70 Z" fill="currentColor" fillOpacity="0.2" strokeWidth="2.2" />
      <path d="M14 83 Q50 78 86 83" strokeWidth="1.8" />
    </>
  ),
  // 台州：神仙居奇峰云海
  "cn:331000": () => (
    <>
      <path d="M16 74 L32 32 L44 60 L58 22 L72 56 L84 74 Z" fill="currentColor" fillOpacity="0.16" strokeWidth="2.3" />
      <path d="M14 64 Q36 56 52 64 Q68 72 86 62" strokeWidth="2.0" />
    </>
  ),
  // 丽水：梯田云雾山
  "cn:331100": () => (
    <>
      <path d="M14 68 Q36 42 58 62 Q72 48 86 68" fill="currentColor" fillOpacity="0.14" strokeWidth="2.2" />
      <path d="M16 74 Q46 60 84 74 M22 81 Q50 69 78 81" strokeWidth="2.0" />
      <circle cx="72" cy="30" r="6" fill="currentColor" fillOpacity="0.16" strokeWidth="2.0" />
    </>
  ),
  // 上海：东方明珠 + 外滩天际线
  "cn:310000": () => (
    <>
      <path d="M50 14 V28 M46 72 L50 36 L54 72" strokeWidth="2.2" />
      <circle cx="50" cy="33" r="5.5" fill="currentColor" fillOpacity="0.2" strokeWidth="2.2" />
      <circle cx="50" cy="54" r="8.5" fill="currentColor" fillOpacity="0.2" strokeWidth="2.2" />
      <path d="M18 76 V54 H30 V76 M70 76 V48 H82 V76 M10 76 H90" fill="currentColor" fillOpacity="0.14" strokeWidth="2.1" />
    </>
  ),
  // 苏州：虎丘塔 + 园林月亮门
  "cn:320500": () => (
    <>
      <circle cx="50" cy="52" r="26" strokeWidth="2.0" />
      <path d="M42 74 L47 22 L53 22 L58 74 Z" fill="currentColor" fillOpacity="0.18" strokeWidth="2.1" />
      <path d="M41 34 H59 M40 46 H60 M39 58 H61" strokeWidth="1.9" />
    </>
  ),
  // 南京：紫金山城墙垛口 + 梧桐弧
  "cn:320100": () => (
    <>
      <path d="M14 72 V50 H24 V56 H34 V50 H44 V56 H56 V50 H66 V56 H76 V50 H86 V72 Z" fill="currentColor" fillOpacity="0.18" strokeWidth="2.2" />
      <path d="M22 42 Q50 20 78 42" strokeWidth="2.0" />
    </>
  ),
  // 无锡：太湖鼋头渚帆船
  "cn:320200": () => (
    <>
      <path d="M48 66 V22 L72 58 H48 Z" fill="currentColor" fillOpacity="0.18" strokeWidth="2.2" />
      <path d="M45 66 V32 L28 58 H45 Z" fill="currentColor" fillOpacity="0.14" strokeWidth="2.0" />
      <path d="M22 70 L30 78 H70 L78 70 Z" fill="currentColor" fillOpacity="0.2" strokeWidth="2.2" />
      <path d="M14 83 Q50 78 86 83" strokeWidth="1.8" />
    </>
  ),
  // 成都（含川西）：大熊猫 + 雪山远峰
  "cn:510100": () => (
    <>
      <path d="M12 72 L30 40 L46 62 L66 34 L88 72" strokeWidth="1.8" />
      <circle cx="35" cy="36" r="6.5" fill="currentColor" fillOpacity="0.26" strokeWidth="2.2" />
      <circle cx="65" cy="36" r="6.5" fill="currentColor" fillOpacity="0.26" strokeWidth="2.2" />
      <circle cx="50" cy="52" r="16" fill="currentColor" fillOpacity="0.12" strokeWidth="2.3" />
      <circle cx="43" cy="50" r="3" fill="currentColor" fillOpacity="0.28" strokeWidth="2.0" />
      <circle cx="57" cy="50" r="3" fill="currentColor" fillOpacity="0.28" strokeWidth="2.0" />
      <path d="M47 59 Q50 62 53 59" strokeWidth="2.0" />
    </>
  ),
  // 西安：大雁塔 + 古城墙
  "cn:610100": () => (
    <>
      <path d="M49 20 L50 13 L51 20" strokeWidth="2.0" />
      <path d="M36 72 L42 22 H58 L64 72 Z" fill="currentColor" fillOpacity="0.18" strokeWidth="2.3" />
      <path d="M39 32 H61 M38 42 H62 M37 52 H63 M36 62 H64" strokeWidth="1.9" />
      <path d="M14 76 H86" strokeWidth="2.3" />
    </>
  ),
  // 洛杉矶：圣莫尼卡摩天轮 + 棕榈树
  "us:us-ca-losangeles": () => (
    <>
      <circle cx="62" cy="44" r="19" fill="currentColor" fillOpacity="0.12" strokeWidth="2.2" />
      <path d="M62 25 V63 M43 44 H81 M49 31 L75 57 M75 31 L49 57 M52 76 L62 63 L72 76" strokeWidth="1.75" />
      <path d="M25 76 Q28 54 23 34" strokeWidth="2.4" />
      <path d="M23 34 Q11 29 9 39 M23 34 Q18 22 30 24 M23 34 Q35 31 35 42" strokeWidth="2.0" />
    </>
  ),
  // 北京：天坛祈年殿
  "cn:110000": () => (
    <>
      <path d="M50 16 L32 32 H68 Z M28 44 L50 31 L72 44 H28 Z M24 57 L50 44 L76 57 H24 Z" fill="currentColor" fillOpacity="0.18" strokeWidth="2.1" />
      <path d="M30 57 V72 H70 V57 M18 76 H82" strokeWidth="2.2" />
    </>
  ),
};

const FALLBACK_MOTIF: MotifRenderer = () => (
  <>
    <path d="M14 72 L36 38 L54 60 L70 40 L86 72 Z" fill="currentColor" fillOpacity="0.15" strokeWidth="2.2" />
    <circle cx="72" cy="28" r="6" fill="currentColor" fillOpacity="0.18" strokeWidth="2.0" />
    <path d="M12 78 Q50 73 88 78" strokeWidth="1.9" />
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
