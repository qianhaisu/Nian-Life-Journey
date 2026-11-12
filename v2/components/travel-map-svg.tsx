// 迷雾地图的绘制（旅行模块第 2 期；2026-11-12 升级为日光微粉彩贴纸地图色调）。纯绘图，没有状态：
// 服务端（旅程页的小地图）和浏览器（旅行页的交互地图）画的是同一套东西。
//
// 风格：一张现代清透的微粉彩剪纸贴纸地图：
//   · 清透天青色海面上放着一整块纯白剪纸边陆地、冷板岩底托投影；
//   · 去过的地方是明快清新的微粉彩贴纸；没去过的地方是轻盈冷雾与流动云朵；
//   · 家是一栋钴蓝屋顶小房子，钴蓝虚线航线从家连向去过的地方；地名是纯白圆胶囊，去处是水滴小图钉。
// 三层叠放（同一个 viewBox）：底图（有滤镜，静止）/ 动效（雾、云、航线，不接收点击）/ 顶层（标签、图钉、家）。
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import type { ChinaGeo, GeoArea, ProvinceGeo, UsGeo } from "@/lib/travel/geo-types";

// 日光微粉彩贴纸色，按第一次去的先后轮换；薄荷翡翠绿留给「家」（HOME_COLOR）
export const STICKER_COLORS = ["#93C5FD", "#C4B5FD", "#FDBA74", "#F9A8D4", "#67E8F9", "#FDE047", "#A5B4FC"];
export const HOME_COLOR = "#6EE7B7";
const FOG = "#EDF2F7";
const FOG_DOT = "#CBD5E1";
const PAPER = "#FFFFFF";
const PLATE = "#BDD0E4";
const INK = "#0F172A";
const ROUTE = "#2563EB";

type Pt = { x: number; y: number };

/** 键盘也能点：Enter / 空格 等同点击。 */
function pressable(label: string, onPress?: () => void, selected?: boolean) {
  if (!onPress) return {};
  return {
    role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": selected, "data-hit": "",
    onClick: onPress,
    onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPress(); } },
    style: { cursor: "pointer" },
  } as const;
}
/** 标签：手指点在字上也算点了那一块，但不再单独算一个按钮（区块本身已经是按钮，读屏不念两遍）。 */
function labelTap(onPress?: () => void) {
  return onPress ? ({ onClick: onPress, "aria-hidden": true, "data-hit": "", style: { cursor: "pointer" } } as const) : ({ "aria-hidden": true } as const);
}

// ── 底图 ───────────────────────────────────────────────────────────────────────
function BaseDefs({ id }: { id: string }) {
  return (
    <defs>
      <filter id={`${id}-wobble`} x="-5%" y="-5%" width="110%" height="115%">
        <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="2" seed="7" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.4" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id={`${id}-sticker`} x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="3" stdDeviation="0.6" floodColor="#0F172A" floodOpacity="0.16" />
      </filter>
      <pattern id={`${id}-fog`} width="10" height="10" patternUnits="userSpaceOnUse">
        <rect width="10" height="10" fill={FOG} />
        <circle cx="2.5" cy="2.5" r="1.1" fill={FOG_DOT} />
        <circle cx="7.5" cy="7.5" r="0.9" fill={FOG_DOT} />
      </pattern>
    </defs>
  );
}

/** 一整块纸贴陆地：底板投影 → 白色剪纸边 → 雾 / 彩色贴纸。 */
function Land({ areas, id, fillOf, onPick, selected }: {
  areas: GeoArea[]; id: string; fillOf: (a: GeoArea) => string | undefined; onPick?: (a: GeoArea) => void; selected?: string;
}) {
  const fogged = areas.filter((a) => !fillOf(a));
  const lit = areas.filter((a) => fillOf(a));
  return (
    <g filter={`url(#${id}-wobble)`}>
      <g aria-hidden="true" transform="translate(0 9)">{areas.map((a) => <path key={a.adcode} d={a.d} fill={PLATE} stroke={PLATE} strokeWidth="12" strokeLinejoin="round" />)}</g>
      <g aria-hidden="true">{areas.map((a) => <path key={a.adcode} d={a.d} fill={PAPER} stroke={PAPER} strokeWidth="13" strokeLinejoin="round" />)}</g>
      <g aria-hidden="true">{fogged.map((a) => <path key={a.adcode} d={a.d} fill={`url(#${id}-fog)`} stroke="#F8FAFC" strokeWidth="1.4" strokeLinejoin="round" />)}</g>
      <g>
        {lit.map((a) => (
          <path key={a.adcode} d={a.d} fill={fillOf(a)} stroke={PAPER} strokeWidth={selected === a.adcode ? 5 : 3} strokeLinejoin="round"
            filter={`url(#${id}-sticker)`} className={`travel-lit${selected === a.adcode ? " is-selected" : ""}`}
            {...pressable(a.name, onPick ? () => onPick(a) : undefined, selected === a.adcode)} />
        ))}
      </g>
    </g>
  );
}

function Compass({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} aria-hidden="true" className="travel-compass">
      <circle r="22" fill={PAPER} stroke="#CBD5E1" strokeWidth="2.5" />
      <circle r="16" fill="none" stroke="#E2E8F0" strokeWidth="1.5" strokeDasharray="2 3" />
      <path d="M0 -15 L5 0 L0 15 L-5 0 Z" fill="#CBD5E1" />
      <path d="M0 -15 L5 0 L-5 0 Z" fill={ROUTE} />
      <text y="-26" fontSize="12" fontWeight="800" textAnchor="middle" fill={ROUTE}>N</text>
    </g>
  );
}

// ── 动效层 ─────────────────────────────────────────────────────────────────────
function Cloud({ x, y, s = 1, className }: { x: number; y: number; s?: number; className?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <g className={className}>
        <path d="M-30 10 a12 12 0 0 1 4-21 a17 17 0 0 1 31-9 a13 13 0 0 1 23 6 a11 11 0 0 1 2 24 Z" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M-16 -8 a9 9 0 0 1 12-6" fill="none" stroke="#E2E8F0" strokeWidth="2.4" strokeLinecap="round" />
      </g>
    </g>
  );
}

/**
 * 会动的迷雾。两条雾带各铺满两个画面宽，匀速横向流过（首尾接得上，看不出循环），只露在没去过的区块上。
 * 雾团是径向渐变，靠 CSS transform 移动，不用实时模糊。系统设了「减少动态效果」时只剩很慢的明暗呼吸（travel.css）。
 */
function Mist({ id, width, height, fogged }: { id: string; width: number; height: number; fogged: GeoArea[] }) {
  if (!fogged.length) return null;
  const lane = (row: number, n: number, seed: number) => {
    const blobs: { cx: number; cy: number; rx: number; ry: number }[] = [];
    for (let i = 0; i < n; i++) {
      const jitter = ((i * 37 + seed * 17) % 10) / 10;
      blobs.push({ cx: (i / n) * width + jitter * width * 0.08, cy: height * (row + jitter * 0.12), rx: width * (0.17 + jitter * 0.06), ry: height * (0.1 + jitter * 0.05) });
    }
    return [...blobs, ...blobs.map((b) => ({ ...b, cx: b.cx + width }))];
  };
  const a = lane(0.3, 5, 1), b = lane(0.66, 6, 2);
  return (
    <g>
      <clipPath id={`${id}-fogclip`}>{fogged.map((f) => <path key={f.adcode} d={f.d} />)}</clipPath>
      <g clipPath={`url(#${id}-fogclip)`}>
        <g className="travel-mist-lane travel-mist-lane-a" style={{ "--lane-from": "0px", "--lane-to": `${-width}px` } as CSSProperties}>
          {a.map((m, i) => <ellipse key={i} cx={m.cx} cy={m.cy} rx={m.rx} ry={m.ry} fill={`url(#${id}-mist)`} />)}
        </g>
        <g className="travel-mist-lane travel-mist-lane-b" style={{ "--lane-from": `${-width}px`, "--lane-to": "0px" } as CSSProperties}>
          {b.map((m, i) => <ellipse key={i} cx={m.cx} cy={m.cy} rx={m.rx} ry={m.ry} fill={`url(#${id}-mist)`} />)}
        </g>
      </g>
    </g>
  );
}

/** 从家出发的虚线航线：一条向上鼓起的弧，虚线一直往前流。 */
function Routes({ from, to, scale = 1 }: { from?: Pt; to: Pt[]; scale?: number }) {
  if (!from || !to.length) return null;
  return (
    <g fill="none" strokeLinecap="round">
      {to.map((t, i) => {
        const dx = t.x - from.x, dy = t.y - from.y, len = Math.hypot(dx, dy);
        if (len < 18 * scale) return null;
        const bend = Math.min(len * 0.28, 120 * scale);
        const cx = (from.x + t.x) / 2 + (dy / len) * bend * (dx > 0 ? -1 : 1);
        const cy = (from.y + t.y) / 2 - Math.abs(dx / len) * bend;
        return (
          <g key={i}>
            <path d={`M${from.x} ${from.y} Q${cx} ${cy} ${t.x} ${t.y}`} stroke="#FFFFFF" strokeWidth={5.5 * scale} opacity="0.82" />
            <path d={`M${from.x} ${from.y} Q${cx} ${cy} ${t.x} ${t.y}`} stroke={ROUTE} strokeWidth={2.5 * scale} strokeDasharray={`${7 * scale} ${7 * scale}`} className="travel-route" />
            <circle cx={t.x} cy={t.y} r={4 * scale} fill={ROUTE} stroke="#fff" strokeWidth={1.8 * scale} />
          </g>
        );
      })}
    </g>
  );
}

function FxDefs({ id }: { id: string }) {
  return (
    <defs>
      <radialGradient id={`${id}-mist`}>
        <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.96" />
        <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.7" />
        <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

// ── 顶层：标签、图钉、家 ─────────────────────────────────────────────────────────
function Pill({ x, y, text, size, tone = "paper" }: { x: number; y: number; text: string; size: number; tone?: "paper" | "ink" }) {
  const w = text.length * size * 1.02 + size * 1.1, h = size * 1.75;
  return (
    <g className="travel-pill">
      <rect x={x - w / 2} y={y - h / 2 + size * 0.14} width={w} height={h} rx={h / 2} fill="#0F172A" opacity="0.10" />
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={h / 2} fill={tone === "ink" ? INK : "#FFFFFF"} stroke={tone === "ink" ? INK : "#CBD5E1"} strokeWidth={size * 0.08} />
      <text x={x} y={y + size * 0.36} fontSize={size} fontWeight={700} textAnchor="middle" fill={tone === "ink" ? "#FFFFFF" : INK}>{text}</text>
    </g>
  );
}

export function House({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} aria-hidden="true">
      <ellipse cx="0" cy="12" rx="13" ry="3.5" fill="#0F172A" opacity="0.14" />
      <rect x="4" y="-15" width="4.5" height="8" rx="1" fill="#1D4ED8" stroke="#fff" strokeWidth="1.6" />
      <path d="M-11 -1 L0 -12 L11 -1 Z" fill="#2563EB" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
      <rect x="-8.5" y="-1.5" width="17" height="13" rx="2.5" fill="#F8FAFC" stroke="#fff" strokeWidth="1.6" />
      <rect x="-2.8" y="3.5" width="5.6" height="8" rx="2.2" fill="#2563EB" />
    </g>
  );
}

function PinGlyph({ x, y, color, active }: { x: number; y: number; color: string; active: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="1" rx="6" ry="2.2" fill="#0F172A" opacity="0.16" />
      <g className={active ? "travel-pin is-active" : "travel-pin"}>
        <path d="M0 0 C-2 -6 -9 -9.5 -9 -17 A9 9 0 1 1 9 -17 C9 -9.5 2 -6 0 0 Z" fill={color} stroke="#FFFFFF" strokeWidth="2.4" strokeLinejoin="round" />
        <circle cx="0" cy="-17" r="3.4" fill="#FFFFFF" />
      </g>
    </g>
  );
}

/** unit：图钉所在格子的 adcode（地级市），用来判断这一格的名字要不要让给图钉。 */
export type MapPin = { placeId: string; x: number; y: number; name: string; home?: boolean; color?: string; unit?: string };

function Pins({ pins, activePins, onPickPin, size }: { pins: MapPin[]; activePins?: ReadonlySet<string>; onPickPin?: (pin: MapPin) => void; size: number }) {
  // 被选中的画在最上面
  const ordered = [...pins].sort((a, b) => Number(!!activePins?.has(a.placeId)) - Number(!!activePins?.has(b.placeId)));
  // 名字避让：德清、莫干山、安吉挨得很近，名字叠在一起时按从上到下往下错开一行
  const h = size * 1.75, placed: { x0: number; x1: number; y: number }[] = [];
  const labelY = new Map<string, number>();
  for (const p of [...pins].filter((p) => activePins?.has(p.placeId) && !p.home).sort((a, b) => a.y - b.y)) {
    const w = p.name.length * size * 1.02 + size * 1.1, x0 = p.x + 12, x1 = x0 + w;
    let y = p.y - 17;
    while (placed.some((q) => x0 < q.x1 && q.x0 < x1 && Math.abs(q.y - y) < h + 3)) y += h + 3;
    placed.push({ x0, x1, y });
    labelY.set(p.placeId, y);
  }
  return (
    <g>
      {ordered.map((p) => {
        const active = !!activePins?.has(p.placeId);
        return (
          <g key={p.placeId} {...pressable(p.name, onPickPin ? () => onPickPin(p) : undefined, active)}>
            <circle cx={p.x} cy={p.y - 10} r="18" fill="transparent" />
            {p.home ? (
              <>
                <House x={p.x} y={p.y - 6} s={1.25} />
                <Pill x={p.x} y={p.y + 22} text="家" size={size} tone="ink" />
              </>
            ) : (
              <>
                <PinGlyph x={p.x} y={p.y} color={darken(p.color ?? "#3B82F6")} active={active} />
                {active ? <>
                  {Math.abs((labelY.get(p.placeId) ?? p.y - 17) - (p.y - 17)) > 1
                    ? <path d={`M${p.x + 4} ${p.y - 17} L${p.x + 12} ${labelY.get(p.placeId)}`} stroke={INK} strokeWidth="1.4" opacity="0.5" /> : null}
                  <Pill x={p.x + (p.name.length * size * 1.02 + size * 1.1) / 2 + 12} y={labelY.get(p.placeId) ?? p.y - 17} text={p.name} size={size} />
                </> : null}
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** 贴纸色做图钉会太淡：同色相压深一点，保证白色小圆心清晰可辨。 */
function darken(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.72).toString(16).padStart(2, "0");
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

// ── 三层舞台 ───────────────────────────────────────────────────────────────────
function Stage({ width, height, title, base, fx, top }: { width: number; height: number; title: string; base: ReactNode; fx: ReactNode; top: ReactNode }) {
  const vb = `0 0 ${width} ${height}`;
  return (
    <div className="travel-stage" role="group" aria-label={title} style={{ aspectRatio: `${width} / ${height}` }}>
      <svg viewBox={vb} className="travel-layer travel-layer-base">{base}</svg>
      <svg viewBox={vb} className="travel-layer travel-layer-fx" aria-hidden="true">{fx}</svg>
      <svg viewBox={vb} className="travel-layer travel-layer-top">{top}</svg>
    </div>
  );
}

// 长江三角洲挤：上海、江苏、浙江的名字用引线拉到海上
const CALLOUT: Record<string, [number, number]> = { "320000": [92, -62], "310000": [104, -4], "330000": [92, 58] };
const short = (name: string) => name.replace(/(维吾尔自治区|壮族自治区|回族自治区|藏族羌族自治州|特别行政区|自治区|自治州|省|市)$/, "");

export function ChinaSvg({ geo, id, lit, home, homeProvince, selected, onPick, title, clouds = true, routesTo }: {
  geo: ChinaGeo; id: string; lit: ReadonlyMap<string, string>; home?: Pt; homeProvince?: string;
  selected?: string; onPick?: (adcode: string) => void; title: string; clouds?: boolean;
  /** 航线终点（省的 adcode）；不给就连到所有亮着的省。 */
  routesTo?: string[];
}) {
  const fillOf = (a: GeoArea) => lit.get(a.adcode);
  const { inset } = geo;
  const tw = 128, scale = tw / inset.w, th = inset.h * scale;
  const tx = geo.width - tw - 14, ty = geo.height - th - 14;
  const insetAreas = geo.provinces.filter((p) => inset.provinces.includes(p.adcode));
  const litAreas = geo.provinces.filter((a) => lit.has(a.adcode));
  const targets = litAreas.filter((a) => (routesTo ? routesTo.includes(a.adcode) : true) && a.adcode !== homeProvince);
  return (
    <Stage width={geo.width} height={geo.height} title={title}
      base={<>
        <BaseDefs id={id} />
        <Land areas={geo.provinces} id={id} fillOf={fillOf} onPick={onPick ? (a) => onPick(a.adcode) : undefined} selected={selected} />
        <Compass x={70} y={70} s={1.5} />
        <g aria-label="南海诸岛">
          <rect x={tx - 5} y={ty - 5} width={tw + 10} height={th + 10} rx="16" fill={PAPER} stroke="#CBD5E1" strokeWidth="2.5" />
          <clipPath id={`${id}-inset`}><rect x={inset.x} y={inset.y} width={inset.w} height={inset.h} /></clipPath>
          <g transform={`translate(${tx} ${ty}) scale(${scale}) translate(${-inset.x} ${-inset.y})`} clipPath={`url(#${id}-inset)`} aria-hidden="true">
            {insetAreas.map((a) => <path key={a.adcode} d={a.d} fill={lit.get(a.adcode) ?? "#E2E8F0"} stroke="#CBD5E1" strokeWidth={1 / scale} />)}
            <path d={inset.hainanFine} fill="#E2E8F0" stroke="#CBD5E1" strokeWidth={1 / scale} />
            <path d={geo.jd} fill="#94A3B8" />
          </g>
        </g>
      </>}
      fx={<>
        <FxDefs id={id} />
        <Mist id={id} width={geo.width} height={geo.height} fogged={geo.provinces.filter((a) => !lit.has(a.adcode))} />
        {clouds ? <>
          <Cloud x={200} y={250} s={1.7} className="travel-cloud travel-cloud-a" />
          <Cloud x={420} y={150} s={1.3} className="travel-cloud travel-cloud-b" />
          <Cloud x={730} y={170} s={1.2} className="travel-cloud travel-cloud-c" />
          <Cloud x={560} y={600} s={1.1} className="travel-cloud travel-cloud-b" />
        </> : null}
        <Routes from={home} to={targets.map((a) => ({ x: a.label[0], y: a.label[1] }))} scale={1.4} />
      </>}
      top={<>
        {litAreas.map((a) => {
          const off = CALLOUT[a.adcode];
          const [lx, ly] = [a.label[0] + (off?.[0] ?? 0), a.label[1] + (off?.[1] ?? 0)];
          return (
            <g key={a.adcode} {...labelTap(onPick ? () => onPick(a.adcode) : undefined)}>
              {off ? <>
                <path d={`M${a.label[0]} ${a.label[1]} L${lx} ${ly}`} stroke={INK} strokeWidth="1.8" strokeDasharray="3 4" opacity="0.45" />
                <circle cx={a.label[0]} cy={a.label[1]} r="3.5" fill={INK} opacity="0.65" />
              </> : null}
              <Pill x={lx} y={ly} text={short(a.name)} size={24} tone={selected === a.adcode ? "ink" : "paper"} />
            </g>
          );
        })}
        {home ? <House x={home.x} y={home.y} s={1.8} /> : null}
      </>}
    />
  );
}

export function ProvinceSvg({ geo, id, lit, homeUnit, selected, onPickUnit, pins, activePins, onPickPin, title }: {
  geo: ProvinceGeo; id: string; lit: ReadonlyMap<string, string>; homeUnit?: string;
  selected?: string; onPickUnit?: (adcode: string) => void; pins: MapPin[]; activePins?: ReadonlySet<string>;
  onPickPin?: (pin: MapPin) => void; title: string;
}) {
  const fillOf = (a: GeoArea) => (a.adcode === homeUnit ? HOME_COLOR : lit.get(a.adcode));
  const home = pins.find((p) => p.home);
  const litUnits = geo.units.filter((a) => fillOf(a));
  return (
    <Stage width={geo.width} height={geo.height} title={title}
      base={<>
        <BaseDefs id={id} />
        <Land areas={geo.units} id={id} fillOf={fillOf} onPick={onPickUnit ? (a) => onPickUnit(a.adcode) : undefined} selected={selected} />
        <Compass x={44} y={geo.height - 48} />
      </>}
      fx={<>
        <FxDefs id={id} />
        <Mist id={id} width={geo.width} height={geo.height} fogged={geo.units.filter((a) => !fillOf(a))} />
        <Cloud x={geo.width * 0.2} y={geo.height * 0.82} s={1.1} className="travel-cloud travel-cloud-a" />
        <Cloud x={geo.width * 0.82} y={geo.height * 0.12} s={0.9} className="travel-cloud travel-cloud-c" />
        <Routes from={home ? { x: home.x, y: home.y } : undefined}
          to={litUnits.filter((a) => a.adcode !== homeUnit).map((a) => ({ x: a.label[0], y: a.label[1] + 16 }))} />
      </>}
      top={<>
        {/* 一格里插着亮起的图钉时，这一格的名字让给图钉（湖州：莫干山、安吉、德清的名字会压住「湖州」）；
            图钉在别的格子里就不让（点「成都」章时亮的是阿坝格子里的川西，成都的名字照常显示） */}
        {litUnits.filter((a) => a.adcode !== homeUnit && !pins.some((p) => p.unit === a.adcode && activePins?.has(p.placeId))).map((a) => (
          <g key={a.adcode} {...labelTap(onPickUnit ? () => onPickUnit(a.adcode) : undefined)}>
            <Pill x={a.label[0]} y={a.label[1]} text={short(a.name)} size={17} tone={selected === a.adcode ? "ink" : "paper"} />
          </g>
        ))}
        <Pins pins={pins} activePins={activePins} onPickPin={onPickPin} size={14} />
      </>}
    />
  );
}

export function UsSvg({ geo, id, pins, activePins, onPickPin, title }: {
  geo: UsGeo; id: string; pins: MapPin[]; activePins?: ReadonlySet<string>; onPickPin?: (pin: MapPin) => void; title: string;
}) {
  return (
    <Stage width={geo.width} height={geo.height} title={title}
      base={<>
        <BaseDefs id={id} />
        <g filter={`url(#${id}-wobble)`}>
          <path d={geo.outline} transform="translate(0 9)" fill={PLATE} stroke={PLATE} strokeWidth="12" strokeLinejoin="round" />
          <path d={geo.outline} fill={PAPER} stroke={PAPER} strokeWidth="13" strokeLinejoin="round" />
          <path d={geo.outline} fill={STICKER_COLORS[0]} stroke={PAPER} strokeWidth="3" strokeLinejoin="round" filter={`url(#${id}-sticker)`} />
        </g>
        <Compass x={geo.width - 56} y={56} />
      </>}
      fx={<>
        <Cloud x={geo.width * 0.16} y={geo.height * 0.78} s={1.2} className="travel-cloud travel-cloud-a" />
        <Cloud x={geo.width * 0.8} y={geo.height * 0.62} s={1} className="travel-cloud travel-cloud-b" />
      </>}
      top={<>
        <Pill x={geo.width * 0.64} y={geo.height * 0.36} text="加利福尼亚" size={20} />
        <Pins pins={pins} activePins={activePins} onPickPin={onPickPin} size={15} />
      </>}
    />
  );
}
