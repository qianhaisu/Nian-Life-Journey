"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

// HEALTH-04：首页「每周提醒」里的健康提醒。首页本身继续走 ISR 缓存，HTML 里不含任何健康内容；
// 这里在浏览器端向受保护的接口要提醒（只含明确的预约），同源 Cookie 自动带上：
//   200 → 画出健康提醒（圆润红十字 + 「健康」）；
//   401 → 只画一个通用的登录入口，不透露有没有提醒、是什么；
//   404（功能没启用）或网络失败 → 什么都不画。
type Item = { id: string; date: string; title: string; place: string };
type State = { kind: "none" } | { kind: "login" } | { kind: "items"; items: Item[] };

export function HealthCross() {
  return <svg className="kind-cross" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13" /></svg>;
}

/** standalone: the weekly block itself is not drawn (its data is unavailable); wrap in our own small section, only when there is something to show. */
export function HomeHealthReminders({ standalone = false }: { standalone?: boolean }) {
  const [state, setState] = useState<State>({ kind: "none" });
  useEffect(() => {
    let alive = true;
    fetch("/api/health-record/reminders", { cache: "no-store", credentials: "same-origin" })
      .then(async (r) => {
        if (!alive) return;
        if (r.status === 401) setState({ kind: "login" });
        else if (r.ok) { const j = (await r.json()) as { items?: Item[] }; if (alive) setState({ kind: "items", items: Array.isArray(j.items) ? j.items : [] }); }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (state.kind === "none") return null;
  const wrap = (node: ReactNode) => (standalone ? <section className="weekly weekly--health-only" aria-label="健康提醒">{node}</section> : node);
  if (state.kind === "login") {
    return wrap(<p className="weekly-health-login"><span className="weekly-kind weekly-kind--health"><HealthCross />健康</span> <Link href="/health">登录后查看健康提醒</Link></p>);
  }
  if (!state.items.length) return null;
  return wrap(<ul className="weekly-list weekly-list--health" aria-label="健康提醒">
    {state.items.map((it) => <li className="weekly-item weekly-item--fact" key={it.id}>
      <div className="weekly-line"><p className="weekly-label">
        <span className="weekly-kind weekly-kind--health"><HealthCross />健康</span>
        <Link className="weekly-title" href="/health">{it.title}</Link>
        <span className="weekly-when">{" · "}<time dateTime={it.date}>{Number(it.date.slice(5, 7))}月{Number(it.date.slice(8, 10))}日</time>{it.place ? ` · ${it.place}` : ""}</span>
      </p></div>
    </li>)}
  </ul>);
}
