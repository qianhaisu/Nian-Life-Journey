"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { HabitShownReporter } from "@/components/habit-shown-reporter";
import { HomeHealthReminders } from "@/components/home-health-reminders";

// 首页第二部分：「每周提醒」（用户 2026-09-16 第 4 条：所有可见标题与可访问名称统一用这四个字，
// 不再出现「给爸爸妈妈的每周提醒」「这几天的提醒事项」这些旧名字）。
//
// 内容口径是「本周事项及仍需确认的未结束计划」，由 lib/home-reminder-window.ts 判定，
// 这个组件**不自己筛**——它只负责把数据轨给的那几条摆出来，以及记住家人在这台设备上勾了哪几条。
//
// ─────────────────────────────────────────────────────────────────────────────
// 勾选：存在服务端，本机存一份副本兜底
// ─────────────────────────────────────────────────────────────────────────────
//
// 2026-09-16 第 5 条最初只要求「当前浏览器本地保存」。2026-09-20 Teddy 报了实际后果：
// 「打勾之后结果没保存，过段时间重新打开又是没打勾的状态了。」——localStorage 在微信内置浏览器、
// iOS 的跨站跟踪限制、清缓存之后都会被清掉，换台设备更是从零开始。所以勾选改为写服务端
// （/api/upcoming/checks → upcoming_checks 表），本机那份降级成离线兜底：
//
//   · **服务端是准的**。挂载后拉一次（no-store，绕开首页 5 分钟的 ISR 缓存）。
//   · **先画后传**。点一下立刻变样子，请求在后台发；失败了把本机那份留着，下次进来再合并上去。
//   · **合并，不覆盖**。本机存的勾第一次上传时只会「补上」，绝不用一份空的本地状态去清空服务端——
//     一台刚清过缓存的手机不该把电脑上勾过的都抹掉。
//
// 几条容易写错的，逐条写死在代码里：
//
//   · **键用稳定的事项 id + 档案标识**，不是数组下标、不是标题文字。下标会在列表变化时串位，
//     标题会在数据轨改写文案时丢失勾选。
//   · **本地存储里只放 id**，不放标题、不放任何聊天原文（任务书：「不要把聊天原文写入本地存储」）。
//   · **首次加载不写库**。读是在 useEffect 里做的（SSR 没有 localStorage，直接读会 hydration 不一致），
//     而且**永远不会在挂载时写一次空状态**——那会把已有的勾选覆盖成全未选，正是任务书点名要避免的。
//   · localStorage 不可用（隐私模式、禁用站点数据）时整条链路静默降级：勾选仍然能点，只是不持久。
//
//   · 这份勾选是**家人手动勾的**，和微信记录推导出的 done / cancelled 是两回事，
//     两者在代码里从不互相写入。勾一条从不伪造「微信里确认完成」的证据（任务书原话）。
export type HomeReminderSource = {
  kindLabel: string;
  roleText: string;
  roleUnconfirmed?: boolean;
  toneLabel: string;
  recordedOn: string;
  recordedOnLabel: string;
  summary: string;
  link?: { href: string; label: string };
};

export type HomeReminder = {
  id: string;
  title: string;
  whenText: string;
  whenDay?: string;
  ageText?: string;
  /**
   * 这一条是不是「还要办的事」。true——原来的行为，画复选框，能勾能取消。
   * false——2026-09-17 第 5 条新加的「已完成的关键事项」：一句事实，不给复选框
   * （那个控件意味着「我确认这件事完成了」，而完成早已经由微信记录证实过）。
   */
  actionable: boolean;
  statusLabel?: string;
  note?: string;
  sources: HomeReminderSource[];
};

/** 存储键的前缀。带版本号，将来格式变了可以换一版而不误读旧值。 */
const STORAGE_PREFIX = "nianlife:weekly-checked:v1";

const storageKey = (scope: string) => `${STORAGE_PREFIX}:${scope}`;

/** 读已勾选的 id。任何异常都当作"没有勾过"，绝不因为存储坏了把页面打掉。 */
function readChecked(scope: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    // 只接受字符串数组。存进去的从来只有 id，读出别的形状就是坏数据，按空处理。
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

function writeChecked(scope: string, ids: Set<string>): void {
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify([...ids]));
  } catch {
    // 存不下就只在这一次会话里生效。不提示、不报错——这不是家人需要处理的事。
  }
}

function SourceRow({ source }: { source: HomeReminderSource }) {
  return <li className="weekly-source">
    <p className="weekly-source-head">
      <span className="weekly-source-kind">{source.kindLabel}</span>
      <span className={source.roleUnconfirmed ? "weekly-source-role weekly-source-role--unconfirmed" : "weekly-source-role"}>{source.roleText}</span>
      <span>{source.toneLabel}</span>
      <span>记录于 <time dateTime={source.recordedOn}>{source.recordedOnLabel}</time></span>
    </p>
    <p className="weekly-source-summary">{source.summary}</p>
    {source.link ? <p className="weekly-source-link"><Link href={source.link.href}>{source.link.label} <span aria-hidden="true">↗</span></Link></p> : null}
  </li>;
}

/** 「查看来源」折叠层。actionable / 事实两种行共用同一份，抽出来避免两处各写一份走偏。 */
function DetailDisclosure({ reminder }: { reminder: HomeReminder }) {
  if (!reminder.note && reminder.sources.length === 0) return null;
  return <details className="weekly-detail">
    <summary>查看来源</summary>
    <div>
      {reminder.note ? <p className="weekly-note">{reminder.note}</p> : null}
      {reminder.sources.length > 0 ? <ul className="weekly-sources">
        {reminder.sources.map((source) => <SourceRow key={`${reminder.id}-${source.kindLabel}-${source.recordedOn}`} source={source} />)}
      </ul> : null}
    </div>
  </details>;
}

/**
 * 一条提醒。
 *
 * 结构上刻意分成**两个互不重叠的交互**（任务书第 5 条：「点击复选框或事项标签切换状态；
 * 查看来源使用独立交互，不能同时触发勾选」）：
 *
 *   1. `<input type="checkbox">` + `<label for>` —— 勾选。用原生控件而不是 div+onClick，
 *      键盘（空格）、读屏（"复选框 已勾选"）、移动端辅助功能全部免费拿到且行为正确。
 *   2. `<details>` —— 查看来源。它是 label 的**兄弟**，不在 label 里面，所以点它不会连带勾选。
 *
 * `reminder.actionable === false`（2026-09-17 第 5 条：已完成的关键事项）时**不画复选框**——
 * 那是一句事实，不是一件要办的事；见 HomeReminder.actionable 的注释。
 */
function Row({ reminder, checked, onToggle, habitId }: {
  reminder: HomeReminder;
  checked: boolean;
  onToggle: (id: string) => void;
  habitId?: string;
}) {
  const inputId = `weekly-${reminder.id}`;
  // HEALTH-04：提醒区区分「生活 / 健康」。这一轨是微信里的待办，统一标「生活」；健康提醒由 HomeHealthReminders 单独给出。
  const label = <>
    <span className="weekly-kind weekly-kind--life">生活</span>
    <span className="weekly-title">{reminder.title}</span>
    <span className="weekly-when">
      {" · "}
      {reminder.whenDay ? <time dateTime={reminder.whenDay}>{reminder.whenText}</time> : reminder.whenText}
      {reminder.ageText ? ` · ${reminder.ageText}` : null}
    </span>
    {reminder.statusLabel ? <span className="weekly-status">{" · "}{reminder.statusLabel}</span> : null}
  </>;

  if (!reminder.actionable) {
    return <li className="weekly-item weekly-item--fact">
      <div className="weekly-line">
        <span className="weekly-fact-mark" aria-hidden="true">✓</span>
        <p className="weekly-label">{label}</p>
      </div>
      <DetailDisclosure reminder={reminder} />
    </li>;
  }

  return <li className={checked ? "weekly-item is-checked" : "weekly-item"}>
    <div className="weekly-line">
      <input
        id={inputId}
        type="checkbox"
        className="weekly-check"
        checked={checked}
        onChange={() => onToggle(reminder.id)}
        data-habit-id={habitId}
      />
      <label className="weekly-label" htmlFor={inputId}>{label}</label>
    </div>
    <DetailDisclosure reminder={reminder} />
  </li>;
}

/**
 * 「每周提醒」整块。
 *
 * **标题总是画出来**，即使这一周一条都没有——任务书：「确实没有事项时，『每周提醒』标题下面留白。」
 * 留白是一句真话（这一周没人在微信里提起要办的事），不是一块空卡片，也不写「全部完成」。
 *
 * 但「真的没有」和「读不出来」是两回事：读不出来时 **app/page.tsx 根本不渲染这个组件**，
 * 因为那种情况下连"这一周没有事"都不能说（lib/home-feed.ts 的三种 unavailable）。
 */
/** 「9 月 8 日」——不带年份，footer 是给自己在读的一句小字，不需要每次都报年份。 */
function shortDate(day: string): string {
  return `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;
}

export function HomeReminders({ reminders, more = [], habitIds = [], storageScope, rangeStart, rangeEnd }: {
  reminders: HomeReminder[];
  more?: HomeReminder[];
  habitIds?: string[];
  /** 档案标识，进存储键，避免不同档案/环境的勾选互相串（任务书第 5 条）。 */
  storageScope: string;
  /**
   * 「每周提醒」看的这一段窗口，开始和结束日期（ISO，含两端）。
   * 2026-09-17 第 5 条：「每周提醒最下方用小字斜体写上开始结束日期」。
   * 用的是 lib/home-reminder-window.ts 的 windowStart()——和实际筛选逻辑同一个函数算出来的，
   * 不是页面自己重新推一遍规则，两边不会走出两套账。
   */
  rangeStart: string;
  rangeEnd: string;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  /**
   * 挂载之后家人自己点过的那几条，以及点成了什么。
   *
   * 为什么需要它：挂载时要向服务端读一次准确状态，而那次读取可能在家人点了之后才回来。直接
   * `setChecked(服务端结果)` 会把刚点的那一下抹掉——手机上就是「点了一下又弹回去」。
   * 2026-09-20 在生产上实测到了这一幕（私有站因为响应快没看见）。
   * 所以服务端结果回来时，要把家人自己点过的这几条再盖回去：本人此刻的意图优先于一份出发时
   * 就已经过时的快照。
   */
  const myToggles = useRef<Map<string, boolean>>(new Map());
  // 挂载后才读：SSR 没有 localStorage，初次渲染必须和服务端一致，否则 hydration 不匹配。
  // 顺序是「先画本机存的（瞬间），再用服务端的覆盖（准的）」——离线或接口挂了也还是老样子能用。
  // 这里**只读不写本机**——挂载时写一次会把已有勾选覆盖成空。
  useEffect(() => {
    const local = readChecked(storageScope);
    if (local.size) setChecked(local);
    let alive = true;
    (async () => {
      try {
        // 本机存过的勾先并上去（只补不删），再以服务端的结果为准。
        const res = local.size
          ? await fetch("/api/upcoming/checks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ merge: [...local] }) })
          : await fetch("/api/upcoming/checks", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { ids?: unknown };
        if (!alive || !Array.isArray(body.ids)) return;
        const server = new Set(body.ids.filter((id): id is string => typeof id === "string"));
        // 家人在这次读取往返期间点过的，以他点的为准（见 myToggles 的注释）。
        for (const [id, want] of myToggles.current) { if (want) server.add(id); else server.delete(id); }
        setChecked(server);
        writeChecked(storageScope, server);
      } catch {
        // 离线、接口 503：保持本机那份，不清空、不报错。下次进来再同步。
      }
    })();
    return () => { alive = false; };
  }, [storageScope]);

  function toggle(id: string) {
    setChecked((was) => {
      const next = new Set(was);
      const nowChecked = !next.has(id);
      if (nowChecked) next.add(id); else next.delete(id);
      myToggles.current.set(id, nowChecked);
      writeChecked(storageScope, next);
      // 先画后传：勾的反馈必须是即时的，网络慢不该让复选框卡住。传失败也不回滚——本机这份还在，
      // 下次打开会作为待合并的勾再交一次。
      void fetch("/api/upcoming/checks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, checked: nowChecked, title: titleOf(id) }),
        keepalive: true,
      }).catch(() => {});
      return next;
    });
  }

  // 打勾时一并把当时的标题交上去，纯排查用（见 schema.ts upcomingChecks.titleAtCheck）。
  function titleOf(id: string): string | undefined {
    return [...reminders, ...more].find((reminder) => reminder.id === id)?.title;
  }

  // Keep every supplied item visible. Re-sort after saved checks load and each toggle;
  // equal groups retain the feed's existing order, and facts remain below open tasks.
  const shown = [...reminders, ...more].sort((a, b) =>
    Number(!a.actionable || checked.has(a.id)) - Number(!b.actionable || checked.has(b.id)),
  );
  const habits = new Set(habitIds);
  const reportable = shown.map((reminder) => reminder.id).filter((id) => habits.has(id));

  return <section className="weekly" aria-labelledby="weekly-heading">
    <h2 className="weekly-heading" id="weekly-heading">每周提醒</h2>
    {shown.length > 0 ? <ul className="weekly-list">
      {shown.map((reminder) => (
        <Row
          key={reminder.id}
          reminder={reminder}
          checked={checked.has(reminder.id)}
          onToggle={toggle}
          habitId={habits.has(reminder.id) ? reminder.id : undefined}
        />
      ))}
    </ul> : null}
    <HomeHealthReminders />
    {reportable.length > 0 ? <HabitShownReporter ids={reportable} /> : null}
    {/* 开始/结束日期，小字斜体（2026-09-17 第 5 条）。标题总画、这里也总画——留白本身也该说清楚
        「看的是哪一段时间」，不只是有内容时才交代依据。 */}
    <p className="weekly-range">
      <time dateTime={rangeStart}>{shortDate(rangeStart)}</time>
      {" — "}
      <time dateTime={rangeEnd}>{shortDate(rangeEnd)}</time>
    </p>
  </section>;
}
