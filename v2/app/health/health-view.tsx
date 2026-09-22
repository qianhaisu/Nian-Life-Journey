"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HealthPage, PageBand, PageEpisode, PageNode, PageVisit } from "@/lib/health/page/model";

// HEALTH-04 健康页（按 r5 设计）：只有主时间轴，按年切换（默认当年全年），手机横向滑动 + 左右箭头；
// 红色只来自核查过的记录区间（原文写明 = 实心，疑似持续 = 斜纹，只知开始 = 短渐隐），其余是同一种默认底色；
// 节点的日期、内容、附件默认收起，点开才显示。病程与观察与护理都默认折叠。当前年份的时间轴只画到今天（北京时间，由服务端给出）。
// 报告附件在页内弹层打开（带“返回”按钮），不离开本页，年份、展开的病程和滚动位置都保留。

const DAY = 86400000;
const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const mdShort = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const PAD = 28, RPAD = 36, GAP = 26, PPD_MOBILE = 4;
const CAT: Record<PageEpisode["category"], string> = { resp: "呼吸道", fever: "发热", burn: "烫伤", other: "其他" };
const CAT_ORDER: PageEpisode["category"][] = ["resp", "fever", "burn", "other"];

function Icon({ kind }: { kind: "fever" | "visit" | "exam" | "flag" | "clip" | "down" | "up" | "left" | "right" | "lung" | "band" | "eye" | "alert" }) {
  switch (kind) {
    case "fever": return <svg className="hp-ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF5A36" d="M12 1.5c.8 3.6 5.8 5.8 5.8 11.6A5.8 5.8 0 0 1 12 22.5a5.8 5.8 0 0 1-5.8-5.9c0-3 1.8-4.4 2.8-6.3.9 1 1.2 2 2.1 2.2C11 9.3 10.6 5.5 12 1.5z" /><path fill="#FFC83D" d="M12.2 11.2c.4 1.9 3 3 3 6a3.1 3.1 0 0 1-6.2 0c0-1.6 1-2.3 1.5-3.3.5.5.8 1 1.2 1.1-.1-1.3-.1-2.5.5-3.8z" /></svg>;
    case "visit": return <svg className="hp-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="3.5" fill="#3C7BE0" /><path d="M12 8v9M7.5 12.5h9" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" /></svg>;
    case "exam": return <svg className="hp-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3h5v12.5a2.5 2.5 0 0 1-5 0z" fill="#fff" stroke="#7A5FD0" strokeWidth="1.8" /><path d="M10.4 10.5h3.2v5a1.6 1.6 0 0 1-3.2 0z" fill="#7A5FD0" /><path d="M8 3h8" stroke="#7A5FD0" strokeWidth="2" strokeLinecap="round" /></svg>;
    case "flag": return <svg className="hp-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v18" stroke="#826544" strokeWidth="2.2" strokeLinecap="round" /><path d="M7 4h11l-3 4 3 4H7z" fill="#826544" /></svg>;
    case "clip": return <svg className="hp-ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="#7A5FD0" strokeWidth="2.2" strokeLinecap="round" d="M8.5 12.5l5.2-5.2a3 3 0 0 1 4.3 4.2l-7.2 7.2a4.8 4.8 0 0 1-6.8-6.8l6.9-6.9" /></svg>;
    case "lung": return <svg className="hp-ic l" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8" stroke="#3C7BE0" strokeWidth="2" strokeLinecap="round" /><path fill="#3C7BE0" d="M10.5 10C7.5 8.5 4 12 4 17c0 2.5 1.2 3.5 3 3.5 2.3 0 3.5-1.2 3.5-3.2z" /><path fill="#3C7BE0" d="M13.5 10c3-1.5 6.5 2 6.5 7 0 2.5-1.2 3.5-3 3.5-2.3 0-3.5-1.2-3.5-3.2z" /></svg>;
    case "band": return <svg className="hp-ic l" viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(-40 12 12)"><rect x="2" y="8" width="20" height="8" rx="4" fill="#F6A6B8" /><rect x="8.5" y="8" width="7" height="8" fill="#E9577A" /></g></svg>;
    case "eye": return <svg className="hp-ic l" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="#EEF1EA" stroke="#626F56" strokeWidth="1.8" /><circle cx="12" cy="12" r="3" fill="#626F56" /></svg>;
    case "alert": return <svg className="hp-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#E5484D" /><path d="M12 7v6M12 16.5h.01" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /></svg>;
    case "down": return <svg className="hp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>;
    case "up": return <svg className="hp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>;
    case "left": return <svg className="hp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>;
    case "right": return <svg className="hp-i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;
  }
}
const Xp = () => <span className="hp-xp"><Icon kind="down" /><em /></span>;

type Att = { href: string; label: string };
const AttCtx = createContext<(a: Att) => void>(() => {});
function AttLink({ a }: { a: Att }) {
  const open = useContext(AttCtx);
  return <a className="hp-att" href={a.href} target="_blank" rel="noreferrer" onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); open(a); }}><Icon kind="clip" />{a.label}</a>;
}
/** Full-screen viewer over the health page: the page underneath is never navigated away from. Back button, Esc and the phone's back gesture all close it. */
function AttViewer({ a, onClose }: { a: Att; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [asFrame, setAsFrame] = useState(false);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", key); back.current?.focus();
    return () => { document.body.style.overflow = prev; removeEventListener("keydown", key); };
  }, [onClose]);
  return <div className="hp-view" role="dialog" aria-modal="true" aria-label={`报告附件：${a.label}`}>
    <div className="hp-view-bar">
      <button type="button" className="hp-view-back" ref={back} data-act="att-back" onClick={onClose}><Icon kind="left" />返回</button>
      <span className="hp-view-t">{a.label}</span>
      {asFrame ? null : <span className="hp-view-z">
        <button type="button" aria-label="缩小" onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}>－</button>
        <button type="button" aria-label="还原" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" aria-label="放大" onClick={() => setZoom((z) => Math.min(5, +(z + 0.5).toFixed(1)))}>＋</button>
      </span>}
    </div>
    <div className="hp-view-body">
      {asFrame ? <iframe src={a.href} title={a.label} className="hp-view-frame" />
        : <img src={a.href} alt={a.label} style={{ width: `${zoom * 100}%` }} onError={() => setAsFrame(true)} />}
    </div>
    <div className="hp-view-foot"><a href={a.href} target="_blank" rel="noreferrer">在新窗口打开原件</a></div>
  </div>;
}

interface Bridge { id: string; b1: PageBand; b2: PageBand }
type Sel = { type: "node"; id: string } | { type: "band"; id: string } | { type: "rt" } | { type: "bridge"; id: string } | null;

export function HealthView({ page }: { page: HealthPage }) {
  const [att, setAtt] = useState<Att | null>(null);
  const open = useCallback((a: Att) => { try { history.pushState({ hpAtt: 1 }, ""); } catch { /* no history: the back button still closes it */ } setAtt(a); }, []);
  const close = useCallback(() => { if (history.state && history.state.hpAtt) history.back(); else setAtt(null); }, []);
  useEffect(() => {
    const pop = () => { if (!(history.state && history.state.hpAtt)) setAtt(null); };
    addEventListener("popstate", pop); return () => removeEventListener("popstate", pop);
  }, []);
  return <AttCtx.Provider value={open}><div className="hp">
    <div className="hp-head"><h1 className="hp-h1">健康</h1><Link className="hp-btn" href="/health/record">＋ 记一笔</Link></div>
    <JumpBar />
    <section className="hp-part" id="hp-s1" aria-labelledby="hp-t1">
      <Timeline page={page} />
    </section>
    <div className="hp-narrow">
      <section className="hp-part" id="hp-s2" aria-labelledby="hp-t2"><h2 id="hp-t2">病程分析</h2><Episodes page={page} /></section>
      <section className="hp-part" id="hp-s3" aria-labelledby="hp-t3"><h2 id="hp-t3">观察与护理</h2><FollowUp page={page} /></section>
      <p className="hp-disc">辅助整理，不是诊断，不能代替医生。</p>
    </div>
    {att ? <AttViewer a={att} onClose={close} /> : null}
  </div></AttCtx.Provider>;
}

function JumpBar() {
  const [cur, setCur] = useState("hp-s1");
  useEffect(() => {
    const on = () => { const y = innerHeight * 0.35; let c = "hp-s1"; for (const id of ["hp-s1", "hp-s2", "hp-s3"]) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top < y) c = id; } setCur(c); };
    addEventListener("scroll", on, { passive: true }); return () => removeEventListener("scroll", on);
  }, []);
  return <nav className="hp-jump" aria-label="健康页三个部分">
    {([["hp-s1", "健康时间轴"], ["hp-s2", "病程分析"], ["hp-s3", "观察与护理"]] as const).map(([id, l]) =>
      <button key={id} type="button" aria-pressed={cur === id} onClick={() => document.getElementById(id)?.scrollIntoView()}>{l}</button>)}
  </nav>;
}

function Timeline({ page }: { page: HealthPage }) {
  const [year, setYear] = useState(page.defaultYear);
  const [sel, setSel] = useState<Sel>(null);
  const [cw, setCw] = useState(0);
  const [showSickInfo, setShowSickInfo] = useState(false);
  const sc = useRef<HTMLDivElement>(null);
  const today = page.today, curYear = Number(today.slice(0, 4));
  // the current year is drawn only up to today; earlier years keep the whole year
  const Y0 = Date.UTC(year, 0, 1), Y1 = year >= curYear ? Math.min(Date.UTC(year + 1, 0, 1), ms(today) + DAY) : Date.UTC(year + 1, 0, 1);
  const days = (Y1 - Y0) / DAY;
  const ppd = cw >= 800 ? (cw - PAD - RPAD) / days : Math.max(PPD_MOBILE, cw ? (cw - PAD - RPAD) / days : PPD_MOBILE);
  const X = useCallback((d: string | number) => PAD + ((typeof d === "number" ? d : ms(d)) - Y0) / DAY * ppd, [Y0, ppd]);
  const W = Math.max(X(Y1) + RPAD, cw);
  const asOf = page.asOf;

  useLayoutEffect(() => {
    const el = sc.current; if (!el) return;
    const measure = () => setCw(el.clientWidth);
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect();
  }, []);
  // default position: near the latest record of the chosen year (or its end)
  useEffect(() => {
    const el = sc.current; if (!el || !cw) return;
    const t = asOf && ms(asOf) >= Y0 && ms(asOf) < Y1 ? X(asOf) - el.clientWidth * 0.8 : W;
    el.scrollLeft = t;
  }, [year, cw]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodes = useMemo(() => {
    const inYear = page.nodes.filter((n) => ms(n.date) >= Y0 && ms(n.date) < Y1);
    const groups: { id: string; x: number; xl: number; nodes: PageNode[] }[] = [];
    for (const n of inYear) { const x = X(n.date), g = groups[groups.length - 1]; if (g && x - g.xl < GAP) { g.nodes.push(n); g.xl = x; } else groups.push({ id: n.id, x, xl: x, nodes: [n] }); }
    return groups;
  }, [page.nodes, Y0, Y1, X]);
  const bands = page.bands.filter((b) => ms(b.end) + DAY > Y0 && ms(b.start) < Y1 && b.start <= today);

  // bridge connectors: visually connect bands with a gap of 1–3 days (ok-status only)
  const bridges = useMemo<Bridge[]>(() => {
    const ok = page.bands.filter((b) => b.status === "ok" && ms(b.end) + DAY > Y0 && ms(b.start) < Y1 && b.start <= today);
    const sorted = [...ok].sort((a, b) => ms(a.start) - ms(b.start));
    const out: Bridge[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const b1 = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const b2 = sorted[j];
        const diff = ms(b2.start) - ms(b1.end);
        if (diff >= 2 * DAY && diff <= 4 * DAY) out.push({ id: `${b1.id}--${b2.id}`, b1, b2 });
        if (diff > 4 * DAY) break;
      }
    }
    return out;
  }, [page.bands, Y0, Y1, today]);

  // cumulative sick days for the selected year (union of bands, bridges and unassigned nodes)
  const sickDays = useMemo(() => {
    const eY1 = Math.min(Y1, ms(today) + DAY);
    const ok = page.bands.filter((b) => b.status === "ok" && ms(b.end) + DAY > Y0 && ms(b.start) < eY1 && b.start <= today);
    const sorted = [...ok.filter((b) => b.kind !== "open")].sort((a, b) => ms(a.start) - ms(b.start));
    const set = new Set<number>();
    const clip = (d: number) => { if (d >= Y0 && d < eY1) set.add(d); };
    if (sorted.length) {
      let lo = ms(sorted[0].start), hi = ms(sorted[0].end) + DAY;
      for (let i = 1; i < sorted.length; i++) {
        const ns = ms(sorted[i].start), ne = ms(sorted[i].end) + DAY;
        if (ns - hi <= 3 * DAY) hi = Math.max(hi, ne);
        else { for (let d = lo; d < hi; d += DAY) clip(d); lo = ns; hi = ne; }
      }
      for (let d = lo; d < hi; d += DAY) clip(d);
    }
    for (const b of ok.filter((b) => b.kind === "open")) for (let d = ms(b.start); d < ms(b.start) + 4 * DAY; d += DAY) clip(d);
    for (const n of page.nodes) if (n.unassigned && ms(n.date) >= Y0 && ms(n.date) < eY1) clip(ms(n.date));
    return set.size;
  }, [page.bands, page.nodes, Y0, Y1, today]);

  const noData = [] as { a: number; b: number }[];
  const first = page.nodes[0]?.date;
  if (first && ms(first) > Y0) noData.push({ a: Y0, b: Math.min(ms(first), Y1) });
  if (asOf && ms(asOf) + DAY < Y1) noData.push({ a: Math.max(ms(asOf) + DAY, Y0), b: Y1 });
  const rt = page.enrolment && ms(page.enrolment.date) >= Y0 && ms(page.enrolment.date) < Y1 ? page.enrolment : null;
  const choose = (s: Sel) => setSel((cur) => (JSON.stringify(cur) === JSON.stringify(s) ? null : s));
  const pickYear = (y: number) => { setYear(y); setSel(null); };
  const fits = W <= cw + 1;
  const bandTitle = (b: PageBand) => b.status === "needs_review" ? "待重新核对" : b.kind === "recorded" ? "原文写明" : b.kind === "suspected" ? "疑似持续" : "只知道开始";

  return <div className={`hp-tl${fits ? " fits" : ""}`} id="hp-tl">
    <div className="hp-tl-title"><h2 id="hp-t1">健康时间轴</h2><div className="hp-sub">（{year}年1月 ～ {year >= curYear ? md(today) : "12月"}{asOf && ms(asOf) >= Y0 && ms(asOf) < Y1 ? ` · 资料截至 ${md(asOf)}` : ""}）</div></div>
    <div className="hp-legend" aria-label="图例">
      <span><i className="l-p" />有问题或疑似问题（原文写明的时段）</span>
      <span><Icon kind="fever" />发热</span>
      <span><i className="l-s" />疑似持续（几条记录连起来看）</span>
      <span><Icon kind="visit" />就医</span>
      <span><i className="l-open" />只知道开始，结束不明</span>
      <span><Icon kind="exam" />检查</span>
      <span><i className="l-nd" />未标出问题区间（不代表健康）</span>
      <span><i className="l-un" />还没归入病程</span>
    </div>
    <div className="hp-tools">
      <div className="hp-years" role="group" aria-label="年份">{page.years.map((y) => <button key={y} type="button" data-year={y} aria-pressed={y === year} onClick={() => pickYear(y)}>{y}</button>)}</div>
      <span className="sp" />
      <button type="button" className="hp-arr" data-arr="-1" aria-label="向左" onClick={() => sc.current?.scrollBy({ left: -240, behavior: "smooth" })}><Icon kind="left" /></button>
      <button type="button" className="hp-arr" data-arr="1" aria-label="向右" onClick={() => sc.current?.scrollBy({ left: 240, behavior: "smooth" })}><Icon kind="right" /></button>
    </div>
    {sickDays > 0 ? <div className="hp-sick-days">年度累计生病 😷 {sickDays} 天<button type="button" className="hp-sick-info" aria-label="计算说明" onClick={() => setShowSickInfo((x) => !x)}>ⓘ</button>{showSickInfo ? <span className="hp-sick-tip">含疑似时段；短间隔和结束不明时按约定补算，不是确诊患病天数。</span> : null}</div> : null}
    <div className="hp-scroll" ref={sc} tabIndex={0} aria-label="详细时间轴，可左右滑动">
      <div className="hp-track" style={{ width: W }}>
        {Array.from({ length: 12 }, (_, i) => i).filter((i) => Date.UTC(year, i, 1) < Y1).map((i) => { const x = X(Date.UTC(year, i, 1)); return <div key={i}><div className="hp-monl" style={{ left: x }} /><div className="hp-mon" style={{ left: Math.max(x, PAD + 10) }}>{i + 1}月</div></div>; })}
        <div className="hp-bp hp-base" style={{ left: X(Y0), width: X(Y1) - X(Y0) }} />
        {noData.filter((p) => X(p.b) - X(p.a) > 80).map((p) => <div key={p.a} className="hp-ndl" style={{ left: (X(p.a) + X(p.b)) / 2 }}>尚无资料</div>)}
        {bands.map((b) => {
          const a = Math.max(ms(b.start), Y0), e = Math.min(ms(b.end) + DAY, Y1);
          const left = X(a), w = b.kind === "open" ? 18 : Math.max(X(e) - left, 7);
          const cls = b.status === "needs_review" ? "review" : b.kind === "recorded" ? "p" : b.kind === "suspected" ? "s" : "open";
          return <button key={b.id} type="button" className={`hp-bp ${cls}`} data-band={b.id} data-kind={b.kind} data-status={b.status} style={{ left, width: w }} aria-expanded={sel?.type === "band" && sel.id === b.id} aria-label={`${bandTitle(b)}：${md(b.start)}${b.kind === "open" ? "起" : `–${md(b.end)}`} ${b.label}`} onClick={() => choose({ type: "band", id: b.id })} />;
        })}
        {bridges.map((br) => { const left = X(ms(br.b1.end) + DAY), w = X(ms(br.b2.start)) - left; return w > 0 ? <button key={br.id} type="button" className="hp-bp bridge" style={{ left, width: w }} aria-expanded={sel?.type === "bridge" && sel.id === br.id} aria-label="相邻区间连接，点击查看" onClick={() => choose({ type: "bridge", id: br.id })} /> : null; })}
        {asOf && ms(asOf) >= Y0 && ms(asOf) < Y1 ? <><div className="hp-asof" style={{ left: X(ms(asOf) + DAY) }} /><div className="hp-asof-l" style={{ left: X(ms(asOf) + DAY) }}>截至 {mdShort(asOf)}</div></> : null}
        {rt ? <button type="button" className="hp-rt" data-rt style={{ left: X(rt.date) - 1 }} aria-expanded={sel?.type === "rt"} aria-label={`入托，${md(rt.date)}`} onClick={() => choose({ type: "rt" })}><span className="pole" /><span className="t">入托</span></button> : null}
        {nodes.map((g) => {
          const all = g.nodes.flatMap((n) => n.entries);
          const k = (["fever", "visit", "exam"] as const).find((x) => all.some((e) => e.kind === x));
          const un = g.nodes.every((n) => n.unassigned);
          const d0 = g.nodes[0].date, d1 = g.nodes[g.nodes.length - 1].date;
          return <div key={g.id}><div className="hp-stem" style={{ left: g.x }} data-stem={g.id} />
            <button type="button" className={`hp-nd${un ? " un" : ""}`} style={{ left: g.x }} data-ev={g.id} aria-expanded={sel?.type === "node" && sel.id === g.id} aria-controls="hp-detail" aria-label={`${d0 === d1 ? md(d0) : `${md(d0)}–${md(d1)}`}的记录`} onClick={() => choose({ type: "node", id: g.id })}>
              {k ? <Icon kind={k} /> : <span className="dot" />}
            </button></div>;
        })}
      </div>
    </div>
    <Detail sel={sel} groups={nodes} page={page} onClose={() => setSel(null)} bandTitle={bandTitle} bridges={bridges} />
  </div>;
}

function Detail({ sel, groups, page, onClose, bandTitle, bridges }: { sel: Sel; groups: { id: string; nodes: PageNode[] }[]; page: HealthPage; onClose: () => void; bandTitle: (b: PageBand) => string; bridges: Bridge[] }) {
  if (!sel) return <div id="hp-detail" hidden />;
  const close = <button type="button" className="hp-close" data-act="close" onClick={onClose}><Icon kind="up" />收起</button>;
  if (sel.type === "rt" && page.enrolment) return <div id="hp-detail" className="hp-detail" aria-live="polite"><div className="dtop"><b>入托 · {md(page.enrolment.date)}</b>{close}</div><p className="hp-muted">{page.enrolment.note}</p></div>;
  if (sel.type === "band") {
    const b = page.bands.find((x) => x.id === sel.id); if (!b) return <div id="hp-detail" hidden />;
    return <div id="hp-detail" className="hp-detail" aria-live="polite">
      <div className="dtop"><b>{bandTitle(b)} · {md(b.start)}{b.kind === "open" ? " 起" : ` – ${md(b.end)}`}{b.startApprox ? "（开始日期是约数）" : ""}</b>{close}</div>
      <p>{b.label}</p>
      <p className="hp-muted">{b.explain}</p>
      {b.timeNote ? <p className="hp-muted">时间说明：{b.timeNote}</p> : null}
      {b.status === "needs_review" ? <p className="hp-warn">这段需要重新核对：{b.statusReasons.join("；")}。在核对之前不按原来的判断画成红色。</p> : null}
      {b.supports.length ? <><h4>依据的记录</h4><ul className="hp-refs">{b.supports.map((r) => <RefLine key={r.id} date={r.date} text={r.text} />)}</ul></> : null}
      {b.counter.length ? <><h4>相反或不一致的记录</h4><ul className="hp-refs">{b.counter.map((r) => <RefLine key={r.id} date={r.date} text={r.text} />)}</ul></> : null}
    </div>;
  }
  if (sel.type === "bridge") {
    const br = bridges.find((b) => b.id === sel.id);
    if (!br) return <div id="hp-detail" hidden />;
    const gapDays = (ms(br.b2.start) - ms(br.b1.end)) / DAY - 1;
    return <div id="hp-detail" className="hp-detail" aria-live="polite">
      <div className="dtop"><b>相邻区间 · {md(br.b1.end)} – {md(br.b2.start)}</b>{close}</div>
      <p>两次记录隔得很近（{gapDays} 天），可能还没完全好。</p>
      <p className="hp-muted">上一段：{br.b1.label}；下一段：{br.b2.label}。这只是展示上的连线，不代表有原文记录。</p>
    </div>;
  }
  const g = groups.find((x) => sel.type === "node" && x.id === sel.id); if (!g) return <div id="hp-detail" hidden />;
  const d0 = g.nodes[0].date, d1 = g.nodes[g.nodes.length - 1].date;
  return <div id="hp-detail" className="hp-detail" aria-live="polite">
    <div className="dtop"><b>{d0 === d1 ? md(d0) : `${md(d0)}–${md(d1)}`}</b>{close}</div>
    {g.nodes.flatMap((n) => n.entries).map((e) => <div className="dv" key={`${e.ledger}:${e.id}`}>
      <div className="dh">{e.kind === "dot" ? <span className="dot" /> : <Icon kind={e.kind} />}<b>{md(e.date)}{e.time ? ` ${e.time}` : ""} · {e.title}</b></div>
      <p className="hp-muted">{e.text}</p>
      <div className="src"><span className="chip">{e.sourceLabel}</span>{e.who ? <span>{e.who}</span> : null}{e.timeKind === "recorded" ? <span>· 只知道记录时间</span> : null}
        {e.attachments.map((a) => <AttLink key={a.href} a={a} />)}
        {e.episode ? <a className="chip ep" href={`#ep-${e.episode.id}`} onClick={() => openEp(e.episode!.id)}>{e.episode.title}</a> : <span>· 还没归入病程</span>}
      </div>
    </div>)}
  </div>;
}

/** A reviewed note usually starts with its own date ("4/2 「…」"); only prefix the record date when it does not. */
function RefLine({ date, text }: { date: string; text: string }) {
  return <li>{date && text.startsWith(mdShort(date)) ? null : <b>{date ? mdShort(date) : "日期不明"} </b>}{text}</li>;
}

function openEp(id: string) {
  const el = document.getElementById(`ep-${id}`) as HTMLDetailsElement | null; if (!el) return;
  const cat = el.closest("details.hp-cat") as HTMLDetailsElement | null; if (cat) cat.open = true; el.open = true;
  setTimeout(() => el.scrollIntoView({ block: "center" }), 30);
}

function Episodes({ page }: { page: HealthPage }) {
  if (!page.inputs.history) return <p className="hp-muted">历史病程资料还没有接通。</p>;
  return <>{Coverage({ page })}{CAT_ORDER.map((c) => {
    const eps = page.episodes.filter((e) => e.category === c).sort((a, b) => String(b.start).localeCompare(String(a.start)));
    if (!eps.length) return null;
    return <details className="hp-cat" key={c} id={`cat-${c}`}>
      <summary>{c === "burn" ? <Icon kind="band" /> : c === "fever" ? <Icon kind="fever" /> : <Icon kind="lung" />}<span>{CAT[c]}<small>{eps.length} 次病程</small></span><Xp /></summary>
      <div className="hp-cat-body">
        {c === "fever" ? <p className="hp-muted">呼吸道病程里出现的发热记在对应病程下，这里不重复计数。</p> : null}
        {eps.map((e) => <Episode key={e.id} e={e} />)}
      </div>
    </details>;
  })}</>;
}

/** Small coverage table: which of the child's own WeChat observations are on the timeline and why the others are not (no re-read of the whole ledger). */
function Coverage({ page }: { page: HealthPage }) {
  const c = page.coverage; const ex = Object.entries(c.excluded).filter(([, n]) => n > 0);
  if (!c.total) return null;
  return <details className="hp-cov"><summary>哪些微信记录显示在时间轴上<Xp /></summary>
    <table><tbody>
      <tr><td>已归入病程</td><td>{c.shownAttached}</td></tr>
      <tr><td>已确认是孩子、但还没归入病程</td><td>{c.shownUnattached}</td></tr>
      <tr><td>候选或同期背景（不计入病程）</td><td>{c.shownCandidate}</td></tr>
      {ex.map(([why, n]) => <tr key={why}><td>没有显示：{why}</td><td>{n}</td></tr>)}
    </tbody></table></details>;
}

function Episode({ e }: { e: PageEpisode }) {
  return <details className="hp-epi" id={`ep-${e.id}`}>
    <summary><span><b>{e.title}</b><small>{e.start ? md(e.start) : "开始日期不明"} – {e.endKnown && e.end ? md(e.end) : <span className="hp-unk">未知</span>}</small></span><Xp /></summary>
    <div className="hp-epb">
      <h4>就医记录</h4>
      {e.visits.length ? e.visits.map((v) => <Visit key={v.id} v={v} />) : <p className="hp-muted">这次没有医院记录（不等于没有就医）。</p>}
      <h4>发展经过</h4>
      <ul className="hp-course">
        {e.course.map((c, i) => <li key={i} className={c.review ? "review" : undefined}><span className="w">{mdShort(c.date)}</span>{c.text}{c.review ? <span className="hp-warn-inline">{c.review}</span> : null}</li>)}
        <li className="q"><span className="w">结束</span>{e.endKnown && e.end ? <>{md(e.end)}</> : <span className="hp-unk">时间未知</span>}{e.endNote ? <span className="hp-muted">（{e.endNote}）</span> : null}</li>
      </ul>
      <h4>病程总结</h4>
      <div className="hp-sum">
        {e.summary.review ? <p className="hp-warn-inline">{e.summary.review}</p> : null}
        {e.summary.short && e.summary.analysis ? <div className="hp-read" data-analysis={e.summary.analysis.version} data-short>
          {e.summary.analysis.review ? <p className="hp-warn-inline">{e.summary.analysis.review}</p> : null}
          {e.summary.analysis.newerNote ? <p className="hp-warn-inline">{e.summary.analysis.newerNote}</p> : null}
          <p>{e.summary.short.join("")}</p>
          <p className="hp-muted">资料截至 {md(e.summary.analysis.dataAsOf)}。</p>
        </div> : <>
          {e.summary.analysis ? <Reading a={e.summary.analysis} /> : null}
          {e.summary.points.length ? <ul>{e.summary.points.map((p, i) => <li key={i}>{p}</li>)}</ul> : <p>已审核底账里没有这一病程的要点。</p>}
          {e.summary.open.length ? <p className="hp-muted">还不确定：{e.summary.open.join("；")}</p> : null}
          <p className="hp-muted">{e.summary.medical}</p>
        </>}
      </div>
    </div>
  </details>;
}

function Reading({ a }: { a: NonNullable<PageEpisode["summary"]["analysis"]> }) {
  return <div className="hp-read" data-analysis={a.version}>
    {a.review ? <p className="hp-warn-inline">{a.review}</p> : null}
    {a.newerNote ? <p className="hp-warn-inline">{a.newerNote}</p> : null}
    {a.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
    <ul>{a.layers.map((l, i) => <li key={i}><b>{l.label}：</b>{l.text}</li>)}</ul>
    {a.uncertain.length ? <p className="hp-muted">不能确定：{a.uncertain.join("；")}</p> : null}
    <p>{a.impact}</p>
    <p className="hp-muted">截至 {md(a.dataAsOf)} 的资料：{a.currentStatus}</p>
    <p className="hp-muted">已采用：{a.adoptedBy}，{a.adoptedAt.slice(0, 10)}；审核依据：{a.basis}</p>
  </div>;
}

function Visit({ v }: { v: PageVisit }) {
  return <div className="hp-visit">
    <div className="vh"><b>{v.date ? md(v.date) : "日期不明"}</b><span>{v.hospital}{v.dept ? ` · ${v.dept}` : ""}</span>{!v.countsAsVisit ? <span className="chip">{v.kindLabel}</span> : null}</div>
    {v.diagnoses.length ? <div className="vrow"><span className="k">诊断</span><span>{v.diagnoses.join("；")}</span></div> : null}
    <div className="vrow"><span className="k">处方</span><span>{v.prescriptions.length ? <ul>{v.prescriptions.map((p, i) => <li key={i}>{p}</li>)}</ul> : "无处方记录"}</span></div>
    <div className="vrow"><span className="k">报告</span><span>{v.reports.length ? v.reports.map((a) => <AttLink key={a.href} a={a} />) : "没有报告原件"}</span></div>
  </div>;
}

function FollowUp({ page }: { page: HealthPage }) {
  const f = page.followUp;
  return <>
    {f.status !== "current" && f.staleReason ? <p className="hp-warn">{f.staleReason}</p> : null}
    {f.status === "missing" ? null : page.careGroups.map((g) => <details className="hp-grp" id={`care-${g.category}`} key={g.category}>
      <summary>{g.category === "burn" ? <Icon kind="band" /> : g.category === "fever" ? <Icon kind="fever" /> : g.category === "resp" ? <Icon kind="lung" /> : <Icon kind="eye" />}{CAT[g.category]}<small className="cnt">{g.items.length} 项</small><Xp /></summary>
      <div className="hp-grp-body">
        {g.items.map((m) => <div className="hp-it" key={m.id}><div><div className="t">{m.text}</div>{m.review ? <div className="hp-warn-inline">{m.review}</div> : null}</div></div>)}
      </div>
    </details>)}
  </>;
}
