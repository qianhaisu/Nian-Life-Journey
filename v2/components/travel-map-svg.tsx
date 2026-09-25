// 迷雾地图的绘制（旅行模块第 2 期）。纯绘图，没有状态：服务端（旅程页的小地图）和浏览器（旅行页的
// 交互地图）画的是同一套东西。
//
// 风格（Teddy 2026-09-25：「地图要可爱的风格，不要像高德地图那种那么正式」）：
//   · 边线用一层轻微的位移滤镜抖一抖，像手画的；外面一圈粗的奶茶色描边，整块陆地像一张剪纸；
//   · 没去过的地方是带小点的雾，上面飘几朵云；去过的是一块块柔和的纸贴，白边加一点投影；
//   · 家是一栋小房子，去过的地方插一面小旗子。
// 同时守住产品原则第 4 节「不幼儿化」：不用卡通人物、不用大红大黄，温度来自形状和纸的质感。
import type { KeyboardEvent, ReactNode } from "react";
import type { ChinaGeo, GeoArea, ProvinceGeo, UsGeo } from "@/lib/travel/geo-types";

// 柔和的纸贴色，按第一次去的先后轮着用
// 不含绿色：绿色留给「家」（HOME_COLOR），免得金华看起来也像家
export const STICKER_COLORS = ["#F2C4A4", "#C3D8E6", "#F3D99C", "#EBB9B0", "#D9CBE6", "#F0CFA0", "#BFDCD6"];
export const HOME_COLOR = "#B9CFA5";
const FOG = "#EEE8DE";
const FOG_DOT = "#DDD2C3";
const OUTLINE = "#D6C8B5";
const INK = "#5A5249";

export function MapDefs({ id }: { id: string }) {
  return (
    <defs>
      <filter id={`${id}-wobble`} x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="7" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id={`${id}-sticker`} x="-10%" y="-10%" width="120%" height="125%">
        <feDropShadow dx="0" dy="2.2" stdDeviation="0.6" floodColor="#9C8468" floodOpacity="0.35" />
      </filter>
      <radialGradient id={`${id}-mist`}>
        <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
        <stop offset="0.55" stopColor="#FFFFFF" stopOpacity="0.55" />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
      </radialGradient>
      <pattern id={`${id}-fog`} width="9" height="9" patternUnits="userSpaceOnUse">
        <rect width="9" height="9" fill={FOG} />
        <circle cx="2.5" cy="2.5" r="1" fill={FOG_DOT} />
        <circle cx="7" cy="7" r="0.8" fill={FOG_DOT} />
      </pattern>
    </defs>
  );
}

/** 地名标签：手指点在字上也算点了那一块，但不再单独算一个按钮（区块本身已经是按钮，读屏不念两遍）。 */
function labelTap(onPress?: () => void) {
  return onPress ? ({ onClick: onPress, "aria-hidden": true, style: { cursor: "pointer" } } as const) : ({ "aria-hidden": true } as const);
}

/** 键盘也能点：Enter / 空格 等同点击。 */
function pressable(label: string, onPress?: () => void, selected?: boolean) {
  if (!onPress) return {};
  return {
    role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": selected,
    onClick: onPress,
    onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPress(); } },
    style: { cursor: "pointer" },
  } as const;
}

function Cloud({ x, y, s = 1, className }: { x: number; y: number; s?: number; className?: string }) {
  return (
    <g className={className} transform={`translate(${x} ${y}) scale(${s})`} opacity="0.85" aria-hidden="true">
      <path d="M-34 10 a14 14 0 0 1 8-24 a20 20 0 0 1 36-6 a15 15 0 0 1 26 10 a12 12 0 0 1-2 22 Z" fill="#FFFFFF" />
    </g>
  );
}

export function House({ x, y, s = 1, label }: { x: number; y: number; s?: number; label?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} aria-label={label} role={label ? "img" : undefined}>
      <ellipse cx="0" cy="11" rx="11" ry="3" fill="#000" opacity="0.12" />
      <path d="M-10 0 L0 -10 L10 0 V10 H-10 Z" fill="#A85D43" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
      <rect x="-3" y="3" width="6" height="7" rx="1.5" fill="#fff" />
    </g>
  );
}

export function Flag({ x, y, s = 1, color = "#A85D43", active = false }: { x: number; y: number; s?: number; color?: string; active?: boolean }) {
  const k = active ? s * 1.35 : s;
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`}>
      <ellipse cx="0" cy="0" rx="6" ry="2" fill="#000" opacity="0.14" />
      <path d="M0 0 V-20" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <path d="M0.5 -20 Q9 -18 14 -15 Q9 -12 0.5 -10 Z" fill={color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
    </g>
  );
}

function Label({ x, y, text, size, dy = 0, anchor = "middle" }: { x: number; y: number; text: string; size: number; dy?: number; anchor?: "middle" | "start" }) {
  return (
    <text x={x} y={y + dy} fontSize={size} textAnchor={anchor} fontWeight={700} fill={INK}
      stroke="#FFFDF8" strokeWidth={size * 0.32} strokeLinejoin="round" paintOrder="stroke" className="travel-map-label">
      {text}
    </text>
  );
}

function Areas({ areas, id, fillOf, onPick, selected }: {
  areas: GeoArea[]; id: string; fillOf: (a: GeoArea) => string | undefined;
  onPick?: (a: GeoArea) => void; selected?: string;
}) {
  const fogged = areas.filter((a) => !fillOf(a));
  const lit = areas.filter((a) => fillOf(a));
  return (
    <g filter={`url(#${id}-wobble)`}>
      {/* 整块陆地的粗描边：在所有区块下面画一遍粗线，内部边界被上层盖住，只剩外轮廓 */}
      <g aria-hidden="true">{areas.map((a) => <path key={a.adcode} d={a.d} fill={OUTLINE} stroke={OUTLINE} strokeWidth="9" strokeLinejoin="round" />)}</g>
      <g aria-hidden="true">{fogged.map((a) => <path key={a.adcode} d={a.d} fill={`url(#${id}-fog)`} stroke="#F8F4EC" strokeWidth="1.3" strokeLinejoin="round" />)}</g>
      <g>
        {lit.map((a) => (
          <path key={a.adcode} d={a.d} fill={fillOf(a)} stroke="#FFFFFF" strokeWidth={selected === a.adcode ? 4.5 : 2.6} strokeLinejoin="round"
            filter={`url(#${id}-sticker)`} className={selected === a.adcode ? "travel-map-selected" : undefined}
            {...pressable(a.name, onPick ? () => onPick(a) : undefined, selected === a.adcode)} />
        ))}
      </g>
    </g>
  );
}

/**
 * 会动的迷雾（Teddy 2026-09-25：「没去过的地方可以有动效迷雾」）。
 * 只盖在没去过的区块上（clipPath 用的就是这些区块），雾团是柔和的径向渐变，靠 CSS transform 慢慢漂——
 * 不用实时模糊或湍流滤镜，手机也画得动。放在抖动滤镜外面，免得每一帧都重算位移。
 * 系统设了「减少动态效果」时雾停着不动（travel.css）。
 */
function FogMist({ areas, id, width, height, lit }: { areas: GeoArea[]; id: string; width: number; height: number; lit: (a: GeoArea) => boolean }) {
  const fogged = areas.filter((a) => !lit(a));
  if (!fogged.length) return null;
  // 雾团按取景框比例铺开：几排错开的大椭圆，每团一个动画节奏
  const blobs: { cx: number; cy: number; rx: number; ry: number; k: number }[] = [];
  const cols = 4, rows = 3;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    blobs.push({ cx: ((c + (r % 2 ? 0.9 : 0.4)) / cols) * width, cy: ((r + 0.5) / rows) * height, rx: width * 0.2, ry: height * 0.13, k: (r * cols + c) % 3 });
  }
  return (
    <g aria-hidden="true" pointerEvents="none">
      <clipPath id={`${id}-fogclip`}>{fogged.map((a) => <path key={a.adcode} d={a.d} />)}</clipPath>
      <g clipPath={`url(#${id}-fogclip)`}>
        {blobs.map((b, i) => (
          <ellipse key={i} cx={b.cx} cy={b.cy} rx={b.rx} ry={b.ry} fill={`url(#${id}-mist)`} className={`travel-mist travel-mist-${b.k}`} />
        ))}
      </g>
    </g>
  );
}

// 长江三角洲挤：上海、江苏、浙江三个名字会叠在一起，各挪一点
const LABEL_NUDGE: Record<string, [number, number]> = { "310000": [40, 6], "320000": [-14, -12], "330000": [0, 36] };

const short = (name: string) => name.replace(/(维吾尔自治区|壮族自治区|回族自治区|藏族羌族自治州|特别行政区|自治区|自治州|省|市)$/, "");

export function ChinaSvg({ geo, id, lit, home, selected, onPick, title, children, clouds = true }: {
  geo: ChinaGeo; id: string; lit: ReadonlyMap<string, string>; home?: { x: number; y: number };
  selected?: string; onPick?: (adcode: string) => void; title: string; children?: ReactNode; clouds?: boolean;
}) {
  const fillOf = (a: GeoArea) => lit.get(a.adcode);
  const { inset } = geo;
  const tw = 128, scale = tw / inset.w, th = inset.h * scale;
  const tx = geo.width - tw - 8, ty = geo.height - th - 8;
  const insetAreas = geo.provinces.filter((p) => inset.provinces.includes(p.adcode));
  return (
    <svg viewBox={`0 0 ${geo.width} ${geo.height}`} className="travel-map-svg" role="group" aria-label={title}>
      <title>{title}</title>
      <MapDefs id={id} />
      <Areas areas={geo.provinces} id={id} fillOf={fillOf} onPick={onPick ? (a) => onPick(a.adcode) : undefined} selected={selected} />
      <FogMist areas={geo.provinces} id={id} width={geo.width} height={geo.height} lit={(a) => !!fillOf(a)} />
      {clouds ? (
        <g aria-hidden="true">
          <Cloud x={190} y={250} s={1.5} className="travel-cloud travel-cloud-a" />
          <Cloud x={390} y={130} s={1.2} className="travel-cloud travel-cloud-b" />
          <Cloud x={720} y={150} s={1.1} className="travel-cloud travel-cloud-a" />
          <Cloud x={560} y={560} s={1} className="travel-cloud travel-cloud-b" />
          <Cloud x={120} y={470} s={1.1} className="travel-cloud travel-cloud-b" />
        </g>
      ) : null}
      <g>
        {geo.provinces.filter((a) => lit.has(a.adcode)).map((a) => (
          <g key={a.adcode} {...labelTap(onPick ? () => onPick(a.adcode) : undefined)}>
            <Label x={a.label[0] + (LABEL_NUDGE[a.adcode]?.[0] ?? 0)} y={a.label[1] + (LABEL_NUDGE[a.adcode]?.[1] ?? 0)} text={short(a.name)} size={30} />
          </g>
        ))}
      </g>
      {home ? <House x={home.x} y={home.y} s={1.6} label="家" /> : null}
      {children}
      {/* 南海诸岛 */}
      <g aria-label="南海诸岛">
        <rect x={tx - 4} y={ty - 4} width={tw + 8} height={th + 8} rx="14" fill="#FFFDF8" stroke={OUTLINE} strokeWidth="2" />
        <clipPath id={`${id}-inset`}><rect x={inset.x} y={inset.y} width={inset.w} height={inset.h} /></clipPath>
        <g transform={`translate(${tx} ${ty}) scale(${scale}) translate(${-inset.x} ${-inset.y})`} clipPath={`url(#${id}-inset)`} aria-hidden="true">
          {insetAreas.map((a) => <path key={a.adcode} d={a.d} fill={lit.get(a.adcode) ?? "#E3D9CA"} stroke={OUTLINE} strokeWidth={2 / scale * 0.5} />)}
          <path d={inset.hainanFine} fill="#E3D9CA" stroke={OUTLINE} strokeWidth={1 / scale} />
          <path d={geo.jd} fill="#A9998A" />
        </g>
      </g>
    </svg>
  );
}

export type MapPin = { placeId: string; x: number; y: number; name: string; home?: boolean; color?: string };

export function ProvinceSvg({ geo, id, lit, homeUnit, selected, onPickUnit, pins, activePins, onPickPin, title }: {
  geo: ProvinceGeo; id: string; lit: ReadonlyMap<string, string>; homeUnit?: string;
  selected?: string; onPickUnit?: (adcode: string) => void; pins: MapPin[]; activePins?: ReadonlySet<string>;
  onPickPin?: (pin: MapPin) => void; title: string;
}) {
  const fillOf = (a: GeoArea) => (a.adcode === homeUnit ? HOME_COLOR : lit.get(a.adcode));
  return (
    <svg viewBox={`0 0 ${geo.width} ${geo.height}`} className="travel-map-svg" role="group" aria-label={title}>
      <title>{title}</title>
      <MapDefs id={id} />
      <Areas areas={geo.units} id={id} fillOf={fillOf} onPick={onPickUnit ? (a) => onPickUnit(a.adcode) : undefined} selected={selected} />
      <FogMist areas={geo.units} id={id} width={geo.width} height={geo.height} lit={(a) => !!fillOf(a)} />
      <g>
        {geo.units.filter((a) => fillOf(a) && a.adcode !== homeUnit).map((a) => (
          <g key={a.adcode} {...labelTap(onPickUnit ? () => onPickUnit(a.adcode) : undefined)}>
            <Label x={a.label[0]} y={a.label[1]} text={short(a.name)} size={19} dy={-6} />
          </g>
        ))}
      </g>
      <PinLayer pins={pins} activePins={activePins} onPickPin={onPickPin} labelSize={15} />
    </svg>
  );
}

export function UsSvg({ geo, id, pins, activePins, onPickPin, title }: {
  geo: UsGeo; id: string; pins: MapPin[]; activePins?: ReadonlySet<string>; onPickPin?: (pin: MapPin) => void; title: string;
}) {
  return (
    <svg viewBox={`0 0 ${geo.width} ${geo.height}`} className="travel-map-svg travel-map-us" role="group" aria-label={title}>
      <title>{title}</title>
      <MapDefs id={id} />
      <g filter={`url(#${id}-wobble)`}>
        <path d={geo.outline} fill={OUTLINE} stroke={OUTLINE} strokeWidth="9" strokeLinejoin="round" />
        <path d={geo.outline} fill={STICKER_COLORS[0]} stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" filter={`url(#${id}-sticker)`} />
      </g>
      <Label x={geo.width * 0.62} y={geo.height * 0.36} text="加利福尼亚" size={22} />
      <Cloud x={geo.width * 0.12} y={geo.height * 0.82} s={1.1} className="travel-cloud travel-cloud-a" />
      <PinLayer pins={pins} activePins={activePins} onPickPin={onPickPin} labelSize={16} />
    </svg>
  );
}

function PinLayer({ pins, activePins, onPickPin, labelSize }: { pins: MapPin[]; activePins?: ReadonlySet<string>; onPickPin?: (pin: MapPin) => void; labelSize: number }) {
  // 浙江一省就有十几面旗子，德清、莫干山、安吉挤在一起：名字只给选中的那几面（和家）。
  // 想全部显示名字的地图（加州只有几面），把全部旗子传进 activePins。
  return (
    <g>
      {pins.map((p) => {
        const active = !!activePins?.has(p.placeId);
        return (
          <g key={p.placeId} {...pressable(p.name, onPickPin ? () => onPickPin(p) : undefined, active)}>
            <circle cx={p.x} cy={p.y - 8} r="16" fill="transparent" />
            {p.home ? <House x={p.x} y={p.y} s={1.1} label="家" /> : <Flag x={p.x} y={p.y} color={p.color} active={active} />}
            {/* 旗子的名字写在旗面右边：写在下面会压住城市本身的名字（四川小地图上「川西」和「成都」叠在一起） */}
            {p.home ? <Label x={p.x} y={p.y + labelSize + 4} text="家" size={labelSize} />
              : active ? <Label x={p.x + 16} y={p.y - 12} text={p.name} size={labelSize} anchor="start" /> : null}
          </g>
        );
      })}
    </g>
  );
}
