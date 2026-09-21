"use client";
// 爸妈手记 / 就医 / 已记录（HEALTH-03 r2）。所有数据来自 /api/health-record（服务端校验会话）。
// 未提交的草稿只留在内存；保存只有在服务端持久提交成功后才提示“已保存”，失败保留全部输入。
import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryEntry, RecordView, Symptoms } from "@/lib/health/record/service";

type Who = { who: "mom" | "dad"; label: string };
type Detail = { record: RecordView; history: HistoryEntry[] };
type WhenState = { mode: "" | "now" | "today" | "date" | "unknown"; nowAt: string; date: string; precision: "minute" | "day" | "approx"; time: string };

const HOSPITALS = ["省儿保（滨江）", "省儿保（莫干山）", "市儿童医院", "浙一", "三墩", "其他"];
const DEPARTMENTS = ["呼吸内科", "耳鼻喉", "外科", "其他"];
const NOSE = ["浓鼻涕", "清鼻涕"], COUGH = ["重度", "轻微"], SLEEP = ["哄睡困难", "夜醒多"];
const WHENS: [WhenState["mode"], string][] = [["now", "刚刚"], ["today", "今天（时间不详）"], ["date", "其他日期 / 时间"], ["unknown", "不确定"]];
const PRECS = { minute: "能到几点几分", day: "只知道是哪天", approx: "大概那几天" } as const;
const FIELD_LABEL: Record<string, string> = { text: "手记", "symptoms.temperature": "体温 ℃", "symptoms.temperatureFlag": "体温核对", "symptoms.nose": "鼻涕", "symptoms.cough": "咳嗽", "symptoms.nasalVoice": "鼻音", "symptoms.sleep": "睡眠", occurredAt: "发生时间", occurredPrecision: "时间精度", timeBasis: "时间依据", hospital: "医院", hospitalOther: "医院名称", department: "科室", departmentOther: "科室名称", note: "备注", attribution: "归属" };

const pad = (n: number) => String(n).padStart(2, "0");
const wallNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const today = () => wallNow().slice(0, 10);
const newId = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ""); };
const md = (s: string) => { const d = new Date(s.slice(0, 10) + "T00:00"); return `${d.getMonth() + 1}月${d.getDate()}日`; };
const mdt = (s: string) => `${md(s)} ${s.slice(11, 16)}`;

async function api(method: string, path: string, body?: unknown, form?: FormData) {
  try {
    const res = await fetch(`/api/health-record/${path}`, { method, credentials: "same-origin", headers: body !== undefined && !form ? { "content-type": "application/json" } : undefined, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any = null; try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, ok: res.ok && !!json?.ok, json };
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: 0, ok: false, json: { message: "网络不通，你填的内容还在，请检查网络后重试。" } as any };
  }
}

function whenPayload(w: WhenState) {
  if (w.mode === "now") return { mode: "now", at: w.nowAt };
  if (w.mode === "today") return { mode: "today", date: w.date };
  if (w.mode === "date") return { mode: "date", date: w.date, precision: w.precision, time: w.time };
  return { mode: "unknown" };
}
const blankWhen = (): WhenState => ({ mode: "", nowAt: "", date: "", precision: "day", time: "" });

function occurredLine(r: RecordView) {
  const o = r.occurred;
  const rec = `记录于 ${mdt(r.recordedAt)}${r.author ? `（${r.author}）` : ""}`;
  if (r.kind === "visit") return `${rec} · ${o.at ? `就医日期 ${md(o.at)}` : "就医日期未知（没填，不当作今天已就诊）"}`;
  if (!o.at) return `${rec} · 发生时间不确定`;
  if (o.basis === "parent_reported_now") return `${rec} · 发生于 ${mdt(o.at)}（刚刚）`;
  if (o.basis === "parent_reported_today") return `${rec} · 发生于 ${md(o.at)}（今天，时间不详）`;
  return `${rec} · 发生于 ${o.precision === "minute" ? mdt(o.at) : md(o.at)}（${o.precision === "minute" ? "具体到分钟" : o.precision === "approx" ? "大概" : "只知道是哪天"}）`;
}
function chips(s: Symptoms | undefined) {
  const b: string[] = []; if (!s) return b;
  if (s.temperature) b.push(`体温 ${s.temperature.value} ℃${s.temperatureFlag ? "（已确认，数值不常见）" : ""}`);
  if (s.nose) b.push(s.nose); if (s.cough) b.push(`咳嗽：${s.cough}`); if (s.nasalVoice) b.push("有鼻音（喉音）");
  if (s.sleep?.length) b.push(`睡眠：${s.sleep.join("、")}`);
  return b;
}
const other = (v?: string, o?: string) => (v === "其他" ? (o ? `其他：${o}` : "其他（没写名称）") : v || "未填");
function Summary({ r }: { r: RecordView }) {
  if (r.kind === "note") { const c = chips(r.symptoms); return <>{r.text || <span className="hint">（没写文字）</span>}{c.length ? <div className="hint">{c.join(" · ")}</div> : null}</>; }
  if (r.kind === "visit") return <><b>{other(r.hospital, r.hospitalOther)} · {other(r.department, r.departmentOther)}</b><div className="hint">{r.images?.length ? `报告图 ${r.images.length} 张` : "没有报告图"}{r.note ? ` · ${r.note}` : ""}</div></>;
  return <>{r.text ?? "旧记录"}<div className="hint">（旧版本录入的记录，只能查看）</div></>;
}
const Tags = ({ r }: { r: RecordView }) => (
  <div>
    <span className="tag kind">{r.kind === "note" ? "爸妈手记" : r.kind === "visit" ? "就医" : "旧记录"}</span>
    {r.voided ? <span className="tag unk">已撤销归属</span> : null}
    {r.revision > 1 ? <span className="tag corr">已更正</span> : null}
    {!r.occurred.at ? <span className="tag unk">{r.kind === "visit" ? "就医日期未知" : "时间不确定"}</span> : null}
  </div>
);

export function RecordApp({ initialWho }: { initialWho: Who | null }) {
  const [who, setWho] = useState<Who | null>(initialWho);
  const [tab, setTab] = useState<"note" | "visit" | "hist">("note");
  const [toast, setToast] = useState("");
  const [listVersion, setListVersion] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((m: string) => { setToast(m); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 3200); }, []);
  const lost = useCallback(() => { setWho(null); }, []);

  if (!who) return <Login onDone={setWho} />;
  return (
    <div className="hr-app">
      <header className="top"><h1>健康记录<small>给张年记一笔 · 由家长录入</small></h1>
        <div className="who"><span>{who.label}</span><button className="btn ghost" style={{ minHeight: 36, padding: "4px 8px" }} onClick={async () => { await api("DELETE", "session"); setWho(null); }}>退出</button></div></header>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
      <main id="hr-view">
        {tab === "note" ? <NoteForm onLost={lost} say={say} onSaved={() => setListVersion((v) => v + 1)} onOpen={(id) => { setTab("hist"); setOpenId(id); }} /> : null}
        {tab === "visit" ? <VisitForm onLost={lost} say={say} onSaved={() => setListVersion((v) => v + 1)} onOpen={(id) => { setTab("hist"); setOpenId(id); }} /> : null}
        {tab === "hist" ? <History version={listVersion} openId={openId} setOpenId={setOpenId} onLost={lost} say={say} onChanged={() => setListVersion((v) => v + 1)} /> : null}
      </main>
      <nav className="tabs" aria-label="主要功能"><div>{([["note", "✏️", "爸妈手记"], ["visit", "🏥", "就医"], ["hist", "🗂️", "已记录"]] as const).map(([k, ic, l]) => (
        <button key={k} data-tab={k} aria-current={tab === k ? "page" : undefined} onClick={() => { setTab(k); setOpenId(null); setToast(""); }}><span className="ic" aria-hidden="true">{ic}</span>{l}</button>))}</div></nav>
    </div>
  );
}

function Login({ onDone }: { onDone: (w: Who) => void }) {
  const [who, setWhoSel] = useState<"mom" | "dad" | "">("");
  const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  return (
    <form className="login" onSubmit={async (e) => {
      e.preventDefault(); if (!who) { setErr("请先选择妈妈或爸爸。"); return; }
      setBusy(true); const r = await api("POST", "session", { who, password: pw }); setBusy(false);
      if (r.ok) onDone({ who: r.json.who, label: r.json.label }); else setErr(r.json?.message ?? "登录失败。");
    }}>
      <h1>健康记录</h1><p className="hint">只有妈妈和爸爸可以进入。</p>
      <label className="f">我是</label>
      <div className="seg two" role="group" aria-label="我是">{([["mom", "妈妈"], ["dad", "爸爸"]] as const).map(([k, l]) => <button type="button" key={k} data-who={k} aria-pressed={who === k} onClick={() => setWhoSel(k)}>{l}</button>)}</div>
      <label className="f" htmlFor="hr-pw">密码</label>
      <input id="hr-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} />
      {err ? <div className="err" role="alert">{err}</div> : null}
      <div className="actions"><button className="btn block" type="submit" disabled={busy}>进入</button></div>
    </form>
  );
}

/* ---------------- 爸妈手记 ---------------- */
function Chip({ on, onClick, children, ...rest }: { on: boolean; onClick: () => void; children: React.ReactNode } & React.HTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="chip" aria-pressed={on} onClick={onClick} {...rest}>{children}</button>;
}
function WhenPicker({ w, set, label, note }: { w: WhenState; set: (w: WhenState) => void; label: string; note?: boolean }) {
  const pick = (m: WhenState["mode"]) => { if (w.mode === m) { set({ ...w, mode: "" }); return; } set({ ...w, mode: m, nowAt: m === "now" ? wallNow() : w.nowAt, date: m === "today" ? today() : w.mode === "today" ? "" : w.date }); };
  const hint = { "": "没选：发生时间记为不确定，不会当成现在。记录时间会自动记下。", now: `发生时间记为 ${w.nowAt.slice(11)}（你点“刚刚”的这一刻；保存失败重试也不变）。`, today: "发生在今天，几点不详。", date: "记录时间自动记下；发生时间按你选的日期和精度。", unknown: "发生时间留空，不猜。" }[w.mode];
  return (
    <>
      <label className="f">{label}{note ? <span className="opt">不选就记为“不确定”</span> : null}</label>
      <div className="seg four" role="group" aria-label={label}>{WHENS.map(([v, l]) => <button type="button" key={v} data-when={v} aria-pressed={w.mode === v} onClick={() => pick(v)}>{l}</button>)}</div>
      {w.mode === "date" ? <>
        <div className="row" style={{ marginTop: 10 }}>
          <div><label className="f" htmlFor="hr-date">哪一天</label><input id="hr-date" type="date" max={today()} value={w.date} onChange={(e) => set({ ...w, date: e.target.value })} /></div>
          <div><label className="f" htmlFor="hr-prec">有多确定</label><select id="hr-prec" value={w.precision} onChange={(e) => set({ ...w, precision: e.target.value as WhenState["precision"] })}>{Object.entries(PRECS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        </div>
        {w.precision === "minute" ? <><label className="f" htmlFor="hr-time">几点</label><input id="hr-time" type="time" value={w.time} onChange={(e) => set({ ...w, time: e.target.value })} /></> : null}
      </> : null}
      <p className="hint" style={{ marginTop: 8 }}>{hint}</p>
    </>
  );
}

function SymptomFields({ v, set }: { v: SymState; set: (v: SymState) => void }) {
  return (
    <>
      <label className="f" htmlFor="hr-temp">体温 <span className="opt">单位 ℃</span></label>
      <div className="row" style={{ alignItems: "center" }}><input id="hr-temp" type="text" inputMode="decimal" value={v.temp} placeholder="例如 37.8" onChange={(e) => set({ ...v, temp: e.target.value })} aria-describedby="hr-tempu" /><span id="hr-tempu" style={{ flex: "0 0 auto", fontWeight: 800 }}>℃</span></div>
      <label className="f">鼻涕 <span className="opt">再点一次取消</span></label>
      <div className="chips" role="group" aria-label="鼻涕">{NOSE.map((x) => <Chip key={x} on={v.nose === x} onClick={() => set({ ...v, nose: v.nose === x ? "" : x })}>{x}</Chip>)}</div>
      <label className="f">咳嗽 <span className="opt">再点一次取消</span></label>
      <div className="chips" role="group" aria-label="咳嗽">{COUGH.map((x) => <Chip key={x} on={v.cough === x} onClick={() => set({ ...v, cough: v.cough === x ? "" : x })}>{x}</Chip>)}</div>
      <label className="f">鼻音</label>
      <div className="chips"><Chip on={v.nasal} onClick={() => set({ ...v, nasal: !v.nasal })}>有鼻音（喉音）</Chip></div>
      <label className="f">睡眠 <span className="opt">可多选，可都不选</span></label>
      <div className="chips" role="group" aria-label="睡眠">{SLEEP.map((x) => <Chip key={x} on={v.sleep.includes(x)} onClick={() => set({ ...v, sleep: v.sleep.includes(x) ? v.sleep.filter((y) => y !== x) : [...v.sleep, x] })}>{x}</Chip>)}</div>
    </>
  );
}
interface SymState { temp: string; nose: string; cough: string; nasal: boolean; sleep: string[] }
const blankSym = (): SymState => ({ temp: "", nose: "", cough: "", nasal: false, sleep: [] });
const symPayload = (v: SymState) => ({ temperature: v.temp.trim(), nose: v.nose, cough: v.cough, nasalVoice: v.nasal, sleep: v.sleep });
const symFrom = (s: Symptoms | undefined): SymState => ({ temp: s?.temperature ? String(s.temperature.value) : "", nose: s?.nose ?? "", cough: s?.cough ?? "", nasal: !!s?.nasalVoice, sleep: s?.sleep ?? [] });

interface Props { onLost: () => void; say: (m: string) => void; onSaved: () => void; onOpen: (id: string) => void }

function NoteForm({ onLost, say, onSaved, onOpen }: Props) {
  const [entryId, setEntryId] = useState(newId);
  const [text, setText] = useState(""); const [w, setW] = useState<WhenState>(blankWhen);
  const [more, setMore] = useState(false); const [sym, setSym] = useState<SymState>(blankSym);
  const [phase, setPhase] = useState<"edit" | "saving" | "done">("edit");
  const [err, setErr] = useState<{ msg: string; needsConfirm?: boolean } | null>(null);
  const [saved, setSaved] = useState<RecordView | null>(null);

  const submit = async (confirmUnusualTemp = false) => {
    setPhase("saving"); setErr(null);
    const r = await api("POST", "entries", { type: "note", entryId, text, when: whenPayload(w), symptoms: symPayload(sym), confirmUnusualTemp });
    if (r.status === 401) { onLost(); return; }
    if (r.ok) { setSaved(r.json.record); setPhase("done"); onSaved(); say(r.json.duplicate ? "这一次提交已经保存过了，没有重复保存" : "已保存"); return; }
    setPhase("edit");
    if (r.json?.code === "temperature_needs_confirmation") { setMore(true); setErr({ msg: r.json.message, needsConfirm: true }); return; }
    if (r.json?.code === "invalid_temperature") setMore(true);
    setErr({ msg: r.json?.message ?? "没有保存成功，你填的内容还在。" });
  };

  if (phase === "done" && saved) return (
    <div className="card"><div className="ok"><b>已保存。</b></div><Tags r={saved} /><p style={{ fontWeight: 600 }}><Summary r={saved} /></p><p className="hint">{occurredLine(saved)}</p>
      <div className="actions"><button className="btn" onClick={() => onOpen(saved.id)}>查看</button>
        <button className="btn sec" onClick={() => { setEntryId(newId()); setText(""); setW(blankWhen()); setSym(blankSym()); setMore(false); setSaved(null); setPhase("edit"); }}>再记一条</button></div></div>
  );
  return (
    <>
      <h2>今天怎么样？</h2><p className="hint">一句话就够。下面的都可以不填——没填只表示没记，不代表正常。</p>
      {err ? <div className="err" role="alert"><b>{err.needsConfirm ? "请核对体温。" : "没保存成功。"}</b> {err.msg}{err.needsConfirm ? <div className="actions"><button className="btn" onClick={() => submit(true)}>确认无误，保存</button></div> : <div className="hint">你写的内容都还在，重试不会重复保存。</div>}</div> : null}
      <label className="f" htmlFor="hr-text">发生了什么？</label>
      <textarea id="hr-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="例如：中午吃得少，摸着有点烫……" />
      <WhenPicker w={w} set={setW} label="发生在什么时候？" note />
      <details className="more" open={more}><summary onClick={(e) => { e.preventDefault(); setMore(!more); }}>再补充一点<span className="hint" style={{ fontWeight: 500, marginLeft: 8 }}>可不填</span></summary>
        <div className="inner"><SymptomFields v={sym} set={(v) => { setSym(v); if (err?.needsConfirm) setErr(null); }} /></div></details>
      <div className="actions"><button className="btn block" disabled={phase === "saving"} onClick={() => submit(false)}>{phase === "saving" ? "保存中…" : err && !err.needsConfirm ? "重试保存" : "保存"}</button></div>
    </>
  );
}

/* ---------------- 就医 ---------------- */
interface Pick { file: File; url: string }
const MAX_FILES = 8, MAX_MB = 12;
function VisitForm({ onLost, say, onSaved, onOpen }: Props) {
  const [entryId, setEntryId] = useState(newId);
  const [hospital, setHospital] = useState(""); const [hospitalOther, setHospitalOther] = useState("");
  const [dept, setDept] = useState(""); const [deptOther, setDeptOther] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]); const [note, setNote] = useState("");
  const [dateOn, setDateOn] = useState(false); const [date, setDate] = useState("");
  const [phase, setPhase] = useState<"edit" | "saving" | "done">("edit");
  const [err, setErr] = useState(""); const [saved, setSaved] = useState<RecordView | null>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const addFiles = (list: FileList | null) => {
    if (!list) return; const add: Pick[] = []; let msg = "";
    for (const f of Array.from(list)) {
      if (!f.type.startsWith("image/")) { msg = `“${f.name}”不是图片，已跳过。`; continue; }
      if (f.size > MAX_MB * 1048576) { msg = `“${f.name}”超过 ${MAX_MB} MB，请压缩后再传。`; continue; }
      if (picks.length + add.length >= MAX_FILES) { msg = `一次最多传 ${MAX_FILES} 张。`; break; }
      const url = URL.createObjectURL(f); urls.current.push(url); add.push({ file: f, url });
    }
    setPicks([...picks, ...add]); setErr(msg);
  };
  const submit = async () => {
    setPhase("saving"); setErr("");
    const payload = { type: "visit", entryId, hospital, hospitalOther, department: dept, departmentOther: deptOther, note, visitDate: dateOn ? date : "" };
    const form = new FormData(); form.set("payload", JSON.stringify(payload)); for (const p of picks) form.append("files", p.file, p.file.name);
    const r = await api("POST", "entries", payload, form);
    if (r.status === 401) { onLost(); return; }
    if (r.ok) { setSaved(r.json.record); setPhase("done"); onSaved(); say(r.json.duplicate ? "这一次提交已经保存过了，没有重复保存" : "已保存"); return; }
    setPhase("edit"); setErr(r.json?.message ?? "没有保存成功，你填的内容和图片都还在。");
  };
  if (phase === "done" && saved) return (
    <div className="card"><div className="ok"><b>已保存。</b></div><Tags r={saved} /><p style={{ fontWeight: 600 }}><Summary r={saved} /></p><p className="hint">{occurredLine(saved)}</p>
      <div className="actions"><button className="btn" onClick={() => onOpen(saved.id)}>查看</button>
        <button className="btn sec" onClick={() => { setEntryId(newId()); setHospital(""); setHospitalOther(""); setDept(""); setDeptOther(""); setPicks([]); setNote(""); setDateOn(false); setDate(""); setSaved(null); setPhase("edit"); }}>再记一次</button></div></div>
  );
  return (
    <>
      <h2>这次去看医生</h2><p className="hint">医院、科室没写就是“未填”。传了图或写了备注，也不代表已经确诊或吃了药。</p>
      {err ? <div className="err" role="alert">{err}{phase === "edit" && picks.length + note.length > 0 ? <div className="hint">你填的内容和图片都还在，重试不会重复保存。</div> : null}</div> : null}
      <label className="f">医院</label>
      <div className="chips" role="group" aria-label="医院">{HOSPITALS.map((x) => <Chip key={x} on={hospital === x} onClick={() => setHospital(hospital === x ? "" : x)}>{x}</Chip>)}</div>
      {hospital === "其他" ? <><label className="f" htmlFor="hr-ho">医院名称</label><input id="hr-ho" type="text" value={hospitalOther} onChange={(e) => setHospitalOther(e.target.value)} placeholder="写下名称" maxLength={60} /></> : null}
      <label className="f">科室</label>
      <div className="chips" role="group" aria-label="科室">{DEPARTMENTS.map((x) => <Chip key={x} on={dept === x} onClick={() => setDept(dept === x ? "" : x)}>{x}</Chip>)}</div>
      {dept === "其他" ? <><label className="f" htmlFor="hr-do">科室名称</label><input id="hr-do" type="text" value={deptOther} onChange={(e) => setDeptOther(e.target.value)} placeholder="写下名称" maxLength={60} /></> : null}
      <label className="f">上传报告图 <span className="opt">可选多张，先在本机预览</span></label>
      <label className="filebtn" htmlFor="hr-files"><span aria-hidden="true">📷</span>选择图片<input id="hr-files" type="file" accept="image/*" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} /></label>
      {picks.length ? <div className="thumbs" aria-label="已选图片预览">{picks.map((p, i) => (
        <div className="thumb" key={p.url}><img src={p.url} alt={`报告图预览：${p.file.name}`} /><div className="nm">{p.file.name}</div>
          <button type="button" className="rm" aria-label={`移除 ${p.file.name}`} onClick={() => setPicks(picks.filter((_, j) => j !== i))}>✕</button></div>))}</div> : null}
      <label className="f" htmlFor="hr-note">备注 <span className="opt">医生交代、用药或其他情况</span></label>
      <textarea id="hr-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="想到什么写什么，不用分项目……" />
      <details className="more" open={dateOn}><summary onClick={(e) => { e.preventDefault(); const on = !dateOn; setDateOn(on); if (!on) setDate(""); }}>补就医日期<span className="hint" style={{ fontWeight: 500, marginLeft: 8 }}>可不填</span></summary>
        <div className="inner"><label className="f" htmlFor="hr-vd">哪一天去的</label><input id="hr-vd" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
          <p className="hint">不填：就医日期记为未知，不会当成今天已经去过。</p></div></details>
      <div className="actions"><button className="btn block" disabled={phase === "saving"} onClick={submit}>{phase === "saving" ? "保存中…" : err ? "重试保存" : "保存"}</button></div>
    </>
  );
}

/* ---------------- 已记录 ---------------- */
function History({ version, openId, setOpenId, onLost, say, onChanged }: { version: number; openId: string | null; setOpenId: (id: string | null) => void; onLost: () => void; say: (m: string) => void; onChanged: () => void }) {
  const [items, setItems] = useState<RecordView[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const load = useCallback(async (after?: string | null) => {
    const r = await api("GET", `entries?limit=20${after ? `&cursor=${encodeURIComponent(after)}` : ""}`);
    if (r.status === 401) { onLost(); return; }
    if (!r.ok) { setState("error"); return; }
    setItems((prev) => (after ? [...prev, ...r.json.items] : r.json.items)); setCursor(r.json.nextCursor); setState("ok");
  }, [onLost]);
  useEffect(() => { setState("loading"); load(null); }, [version, load]);
  return (
    <>
      <h2>已记录</h2><p className="hint">按记录时间排列。点开可以看历史，也可以更正；旧版本录入的记录完整保留，只能查看。</p>
      {state === "error" ? <div className="err" role="alert">没能读取记录，请稍后重试。 <button className="btn ghost" onClick={() => load(null)}>重试</button></div> : null}
      {state === "loading" ? <p className="hint">读取中…</p> : null}
      {state === "ok" && !items.length ? <div className="empty"><div className="big">🗂️</div><p>还没有记录。</p></div> : null}
      {items.map((r) => (
        <button key={r.id} className={`rec${r.kind === "legacy" ? " legacy" : ""}`} data-rec={r.id} onClick={() => setOpenId(r.id)} aria-label="查看这条记录">
          <Tags r={r} /><div className="txt"><Summary r={r} /></div><div className="when">{occurredLine(r)}</div></button>))}
      {cursor ? <div className="actions"><button className="btn sec" onClick={() => load(cursor)}>更多</button></div> : null}
      {openId ? <Sheet id={openId} onClose={() => setOpenId(null)} onLost={onLost} say={say} onChanged={() => { onChanged(); }} /> : null}
    </>
  );
}

const legacyRows = (r: RecordView): [string, string][] => {
  const c = (r.legacy ?? {}) as Record<string, unknown>; const rows: [string, string][] = [];
  const fmt = (v: unknown) => (typeof v === "object" && v !== null ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${x}`).join("，") : String(v));
  const L: [string, string][] = [["text", "内容"], ["dose", "剂量"], ["measure", "测量"], ["sleepQuality", "睡眠"], ["mood", "精神"], ["role", "类型"], ["occurredAt", "发生时间"], ["timeBasis", "时间依据"], ["speaker", "记录人"]];
  for (const [k, l] of L) if (c[k] !== undefined && c[k] !== null && c[k] !== "") rows.push([l, fmt(c[k])]);
  return rows;
};

interface Edit { text: string; sym: SymState; hospital: string; hospitalOther: string; dept: string; deptOther: string; note: string; changeTime: boolean; w: WhenState; visitDate: string }
const editFrom = (r: RecordView): Edit => ({ text: r.text ?? "", sym: symFrom(r.symptoms), hospital: r.hospital ?? "", hospitalOther: r.hospitalOther ?? "", dept: r.department ?? "", deptOther: r.departmentOther ?? "", note: r.note ?? "", changeTime: false, w: blankWhen(), visitDate: r.occurred.at ?? "" });
const editPayload = (r: RecordView, e: Edit, confirmUnusualTemp: boolean) => r.kind === "note"
  ? { text: e.text, symptoms: symPayload(e.sym), confirmUnusualTemp, ...(e.changeTime ? { when: whenPayload(e.w) } : {}) }
  : { hospital: e.hospital, hospitalOther: e.hospitalOther, department: e.dept, departmentOther: e.deptOther, note: e.note, ...(e.changeTime ? { visitDate: e.visitDate } : {}) };

function Sheet({ id, onClose, onLost, say, onChanged }: { id: string; onClose: () => void; onLost: () => void; say: (m: string) => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null); const [msg, setMsg] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null); const [reason, setReason] = useState("");
  const [reqId, setReqId] = useState(newId);
  const [conflict, setConflict] = useState<Detail | null>(null); const [needsConfirm, setNeedsConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => { const r = await api("GET", `entries/${encodeURIComponent(id)}`); if (r.status === 401) { onLost(); return; } if (r.ok) setD({ record: r.json.record, history: r.json.history }); else setMsg(r.json?.message ?? "读取失败。"); })(); }, [id, onLost]);
  const rec = d?.record;

  const send = async (path: string, body: Record<string, unknown>, okMsg: string) => {
    setBusy(true); setMsg("");
    const r = await api("POST", `entries/${encodeURIComponent(id)}/${path}`, body); setBusy(false);
    if (r.status === 401) { onLost(); return false; }
    if (r.ok) { setD({ record: r.json.record, history: r.json.history }); setEdit(null); setConflict(null); setReason(""); setReqId(newId()); setNeedsConfirm(false); onChanged(); say(okMsg); return true; }
    if (r.json?.code === "revision_conflict") { setConflict(r.json.current); return false; }
    if (r.json?.code === "temperature_needs_confirmation") { setNeedsConfirm(true); setMsg(r.json.message); return false; }
    setMsg(r.json?.message ?? "没有保存成功，你的改动还在。"); return false;
  };
  const save = (confirm = false) => send("corrections", { requestId: reqId, expectedRevision: rec!.revision, reason, edit: editPayload(rec!, edit!, confirm) }, "已更正，原来的内容留在历史里");
  const overwrite = async () => { // 用户明确选择“用我的草稿”：以当前修订号追加一次更正
    const cur = conflict!.record; setD(conflict); setConflict(null); setReqId(newId());
    setBusy(true); const r = await api("POST", `entries/${encodeURIComponent(id)}/corrections`, { requestId: newId(), expectedRevision: cur.revision, reason, edit: editPayload(cur, edit!, needsConfirm) }); setBusy(false);
    if (r.ok) { setD({ record: r.json.record, history: r.json.history }); setEdit(null); onChanged(); say("已用你的草稿更正，别人的改动仍在历史里"); } else setMsg(r.json?.message ?? "没有保存成功，你的草稿还在。");
  };
  const attribution = (action: "void" | "restore") => send("attribution", { requestId: newId(), expectedRevision: rec!.revision, action }, action === "void" ? "已撤销归属，历史仍在" : "已恢复归属");

  return (
    <div className="sheet-wrap" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={edit ? "更正" : "记录详情"}>
        <div className="grab" />
        {!rec ? <p className="hint">{msg || "读取中…"}</p> : edit ? (
          <>
            <h2>更正</h2><p className="hint">改的地方会写进历史，原来的内容不会丢。取消一个选项只表示“不记”，不会变成“没有”或“正常”。</p>
            {msg ? <div className="err" role="alert">{msg}{needsConfirm ? <div className="actions"><button className="btn" onClick={() => save(true)}>确认无误，保存</button></div> : null}</div> : null}
            {conflict ? <ConflictPanel current={conflict} draft={edit} busy={busy} onOverwrite={overwrite} onKeep={() => { setD(conflict); setConflict(null); setEdit(null); }} /> : null}
            {rec.kind === "note" ? (
              <>
                <label className="f" htmlFor="hr-etext">手记</label><textarea id="hr-etext" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
                <SymptomFields v={edit.sym} set={(sym) => { setEdit({ ...edit, sym }); setNeedsConfirm(false); }} />
                <button type="button" className="btn ghost" onClick={() => setEdit({ ...edit, changeTime: !edit.changeTime })}>{edit.changeTime ? "不改发生时间" : "改发生时间"}</button>
                {edit.changeTime ? <WhenPicker w={edit.w} set={(w) => setEdit({ ...edit, w })} label="发生在什么时候？" /> : null}
              </>
            ) : (
              <>
                <label className="f">医院</label><div className="chips" role="group" aria-label="医院">{HOSPITALS.map((x) => <Chip key={x} on={edit.hospital === x} onClick={() => setEdit({ ...edit, hospital: edit.hospital === x ? "" : x })}>{x}</Chip>)}</div>
                {edit.hospital === "其他" ? <><label className="f" htmlFor="hr-eho">医院名称</label><input id="hr-eho" type="text" value={edit.hospitalOther} onChange={(e) => setEdit({ ...edit, hospitalOther: e.target.value })} /></> : null}
                <label className="f">科室</label><div className="chips" role="group" aria-label="科室">{DEPARTMENTS.map((x) => <Chip key={x} on={edit.dept === x} onClick={() => setEdit({ ...edit, dept: edit.dept === x ? "" : x })}>{x}</Chip>)}</div>
                {edit.dept === "其他" ? <><label className="f" htmlFor="hr-edo">科室名称</label><input id="hr-edo" type="text" value={edit.deptOther} onChange={(e) => setEdit({ ...edit, deptOther: e.target.value })} /></> : null}
                <label className="f" htmlFor="hr-enote">备注</label><textarea id="hr-enote" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
                <button type="button" className="btn ghost" onClick={() => setEdit({ ...edit, changeTime: !edit.changeTime })}>{edit.changeTime ? "不改就医日期" : "改就医日期"}</button>
                {edit.changeTime ? <><label className="f" htmlFor="hr-evd">哪一天去的 <span className="opt">清空 = 未知</span></label><input id="hr-evd" type="date" max={today()} value={edit.visitDate} onChange={(e) => setEdit({ ...edit, visitDate: e.target.value })} /></> : null}
              </>
            )}
            <label className="f" htmlFor="hr-reason">理由 <span className="opt">可不填</span></label><input id="hr-reason" type="text" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="例如：看错了、医生后来说不一样" />
            <div className="actions"><button className="btn" disabled={busy} onClick={() => save(false)}>保存更正</button><button className="btn sec" onClick={() => { setEdit(null); setMsg(""); setConflict(null); }}>不改了</button></div>
          </>
        ) : (
          <>
            <Tags r={rec} /><p style={{ fontWeight: 600, margin: "8px 0" }}><Summary r={rec} /></p><p className="hint">{occurredLine(rec)}</p>
            {msg ? <div className="err" role="alert">{msg}</div> : null}
            {rec.kind === "visit" && rec.images?.length ? <><h3>报告图</h3><div className="thumbs">{rec.images.map((im) => (
              <a className="thumb" key={im.sha256} href={`/api/health-record/originals/${im.sha256}`} target="_blank" rel="noreferrer" aria-label={`查看原图：${im.name}`}>
                <img src={`/api/health-record/originals/${im.sha256}?thumb=1`} alt={`报告图：${im.name}`} /><div className="nm">{im.name}（点开看原图）</div></a>))}</div></> : null}
            {rec.kind === "legacy" ? <><h3>旧记录内容</h3><dl className="kv">{legacyRows(rec).map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></> : null}
            {rec.voided ? <div className="note">这条已撤销归属（记错了孩子）。内容和历史都还在，不计入张年。</div> : null}
            <h3>历史</h3>
            {d!.history.slice().reverse().map((h) => (
              <div className="hist" key={h.id}><div className="h">{h.kind === "created" ? `${mdt(h.at)} · ${h.author} · 创建` : `${mdt(h.at)} · ${h.author} · 更正${h.reason ? `（${h.reason}）` : ""}`}</div>
                {h.changes.map((c, i) => <div className="diff" key={i}><span>{FIELD_LABEL[c.field] ?? c.field}</span><span><s>{show(c.before)}</s> → <ins>{show(c.after)}</ins></span></div>)}</div>))}
            <div className="actions">
              {rec.editable ? <button className="btn" onClick={() => { setEdit(editFrom(rec)); setReqId(newId()); setMsg(""); }}>更正</button> : null}
              {rec.editable && !rec.voided ? <button className="btn sec" disabled={busy} onClick={() => attribution("void")}>这条记错孩子了</button> : null}
              {rec.editable && rec.voided ? <button className="btn sec" disabled={busy} onClick={() => attribution("restore")}>恢复归属</button> : null}
              <button className="btn sec" onClick={onClose}>关闭</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
const show = (v: unknown): string => (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) ? "未记录" : v === true ? "有" : v === "not_child" ? "已撤销归属" : v === "child" ? "归属张年" : Array.isArray(v) ? v.join("、") : typeof v === "object" ? Object.values(v as object).join(" ") : String(v));

function ConflictPanel({ current, draft, busy, onOverwrite, onKeep }: { current: Detail; draft: Edit; busy: boolean; onOverwrite: () => void; onKeep: () => void }) {
  const r = current.record;
  const cur = r.kind === "note" ? `${r.text ?? ""}${chips(r.symptoms).length ? `\n${chips(r.symptoms).join(" · ")}` : ""}` : `${other(r.hospital, r.hospitalOther)} · ${other(r.department, r.departmentOther)}\n${r.note ?? ""}`;
  const mine = r.kind === "note" ? `${draft.text}${chips({ ...(draft.sym.temp ? { temperature: { value: Number(draft.sym.temp), unit: "℃" as const } } : {}), ...(draft.sym.nose ? { nose: draft.sym.nose } : {}), ...(draft.sym.cough ? { cough: draft.sym.cough } : {}), ...(draft.sym.nasal ? { nasalVoice: true as const } : {}), ...(draft.sym.sleep.length ? { sleep: draft.sym.sleep } : {}) }).length ? `\n${chips({ ...(draft.sym.nose ? { nose: draft.sym.nose } : {}), ...(draft.sym.cough ? { cough: draft.sym.cough } : {}) }).join(" · ")}` : ""}` : `${other(draft.hospital, draft.hospitalOther)} · ${other(draft.dept, draft.deptOther)}\n${draft.note}`;
  return (
    <div className="note" role="alert" data-conflict="1"><b>这条记录刚刚被别人改过，你的改动还没有保存。</b>
      <div className="hint" style={{ marginTop: 6 }}>当前值（最新，已保存）</div><div className="cmpbox cur">{cur}</div>
      <div className="hint">你的草稿（未提交）</div><div className="cmpbox">{mine}</div>
      <div className="actions"><button className="btn" disabled={busy} onClick={onOverwrite}>用我的草稿再更正一次</button><button className="btn sec" onClick={onKeep}>先看当前值，不改了</button></div>
      <p className="hint">选“用我的草稿”会追加一次新的更正；对方的改动仍留在历史里，不会被抹掉。</p></div>
  );
}
