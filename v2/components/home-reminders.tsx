"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HabitShownReporter } from "@/components/habit-shown-reporter";

// 首页第二部分：「每周提醒」（用户 2026-09-16 第 4 条：所有可见标题与可访问名称统一用这四个字，
// 不再出现「给爸爸妈妈的每周提醒」「这几天的提醒事项」这些旧名字）。
//
// 内容口径是「过去 7 天微信里提到的、仍需办理的事」，由 lib/home-reminder-window.ts 判定，
// 这个组件**不自己筛**——它只负责把数据轨给的那几条摆出来，以及记住家人在这台设备上勾了哪几条。
//
// ─────────────────────────────────────────────────────────────────────────────
// 勾选：只存在这台设备上，而且只存 id
// ─────────────────────────────────────────────────────────────────────────────
//
// 用户 2026-09-16 第 5 条要求真正可操作的复选框，并且明确了本轮的保存范围：
// 「当前浏览器本地保存，刷新和重新打开后仍保留；不承诺跨设备同步。」
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
  const label = <>
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
  // 挂载后才读：SSR 没有 localStorage，初次渲染必须和服务端一致，否则 hydration 不匹配。
  // 这里**只读不写**——挂载时写一次会把已有勾选覆盖成空。
  useEffect(() => { setChecked(readChecked(storageScope)); }, [storageScope]);

  function toggle(id: string) {
    setChecked((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id); else next.add(id);
      writeChecked(storageScope, next);
      return next;
    });
  }

  const shown = reminders.slice(0, 2);
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
    {/* 超出默认位的**本周**事项收在这里，一条都不会因为放不下而消失。标题不写数字（原则三）。 */}
    {more.length > 0 ? <details className="weekly-more">
      <summary>本周还记着的其他事</summary>
      <ul className="weekly-list">
        {more.map((reminder) => (
          <Row key={reminder.id} reminder={reminder} checked={checked.has(reminder.id)} onToggle={toggle} />
        ))}
      </ul>
    </details> : null}
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
