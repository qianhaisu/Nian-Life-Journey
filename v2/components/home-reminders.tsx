import Link from "next/link";
import { HabitShownReporter } from "@/components/habit-shown-reporter";

// 首页左栏下方那张轻便签：「这几天的提醒事项」（2026-09-14 用户：只写「这几天」读不出这块是什么）。2026-09-13 版式修复把它从一条通栏的色块收成一小块字——
// 没有背景、没有大圆角、没有阴影，也没有右侧那个独立的「查看详情」按钮；整条自己就是展开入口，
// 命中区域仍然 ≥44px，键盘可用（`<details>`/`<summary>` 原生行为）。
//
// 原来那张完整的「近期待办」清单没有删：它仍然是 components/upcoming-tasks.tsx，在别处照常用。
//
// 这里的规矩来自共同规格第 6 节，每一条都是「页面会说错的一句话」：
//
//   读不出来 ≠ 没有待办。数据轨说不可用（材料为空 / 没提取完 / 读失败）时，这一整块不渲染，
//   绝不写「全部完成」「暂无待办」。判断在 app/page.tsx，那里三种「没有」分得清清楚楚。
//
//   退场 ≠ 完成。首页只展示还有效的那几条；一条过期的临时采购是被移出首页，不是被划掉。
//   所以这里没有删除线：完成状态由数据轨给 statusText，页面不自己按文字关键词判断。
//
//   时间不猜。没有期限的写「时间待确认」，不生成一个日期。
//
//   详情里保留的是已认可的来源摘要：谁提的、什么语气、哪天记下的、那句经审核的话，以及回到
//   来源那一天的链接。技术元数据和未审核原文不出现。
export type HomeReminderSource = {
  // 「提出」「完成」「改期」「取消」——同一条事项的不同依据分行，不合成一句。
  kindLabel: string;
  roleText: string;
  // 未确认的来源人物照实写，并且不做成人名的样子（upcoming-tasks.tsx 里同一条规矩）。
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
  // 「9 月 15 日」「时间待确认」这类由数据轨给出的状态文字；页面不改写。
  whenText: string;
  whenDay?: string;
  ageText?: string;
  // 「待确认」「已改期」等状态词，没有就不显示。
  statusLabel?: string;
  note?: string;
  sources: HomeReminderSource[];
};

function SourceRow({ source }: { source: HomeReminderSource }) {
  return <li className="home-note-source">
    <p className="home-note-source-head">
      <span className="home-note-kind">{source.kindLabel}</span>
      <span className={source.roleUnconfirmed ? "home-note-role home-note-role--unconfirmed" : "home-note-role"}>{source.roleText}</span>
      <span>{source.toneLabel}</span>
      <span>记录于 <time dateTime={source.recordedOn}>{source.recordedOnLabel}</time></span>
    </p>
    <p className="home-note-summary">{source.summary}</p>
    {source.link ? <p className="home-note-link"><Link href={source.link.href}>{source.link.label} <span aria-hidden="true">↗</span></Link></p> : null}
  </li>;
}

// 一条便签：一行「事情 + 时间/必要状态」，整条可展开。展开层里才是来源、原始日期与状态。
function Note({ reminder, habitId }: { reminder: HomeReminder; habitId?: string }) {
  return <details className="home-note">
    {/* data-habit-id 只出现在默认位上、且只出现在习惯类事项上（id 由数据轨的 habitShownIds 给定）。
        折叠层里的那几条不带这个属性——「露出」数的是家人真的看见的那几天（§6.3）。 */}
    <summary data-habit-id={habitId}>
      {reminder.title}
      <span className="home-note-when">
        {" · "}
        {reminder.whenDay ? <time dateTime={reminder.whenDay}>{reminder.whenText}</time> : reminder.whenText}
        {reminder.ageText ? ` · ${reminder.ageText}` : null}
      </span>
      {reminder.statusLabel ? <span className="home-note-status">{" · "}{reminder.statusLabel}</span> : null}
    </summary>
    <div className="home-note-detail">
      {reminder.note ? <p>{reminder.note}</p> : null}
      {reminder.sources.length > 0 ? <ul className="home-note-sources">
        {reminder.sources.map((source) => <SourceRow key={`${reminder.id}-${source.kindLabel}-${source.recordedOn}`} source={source} />)}
      </ul> : null}
    </div>
  </details>;
}

export function HomeReminders({ reminders, more = [], habitIds = [] }: { reminders: HomeReminder[]; more?: HomeReminder[]; habitIds?: string[] }) {
  // 一条都没有 → 整块收起。这是「没有有效提醒」的呈现，不是「全部完成」的说法。
  if (reminders.length === 0 && more.length === 0) return null;
  // 默认一条，确有需要最多两条（共同规格 §6.6）。
  const shown = reminders.slice(0, 2);
  const habits = new Set(habitIds);
  // 实际画在默认位上的习惯类事项，才是可能被上报的那几条。
  const reportable = shown.map((reminder) => reminder.id).filter((id) => habits.has(id));
  return <section className="home-notes" aria-label="这几天的提醒事项">
    <p className="home-notes-label">这几天的提醒事项</p>
    {shown.map((reminder) => <Note key={reminder.id} reminder={reminder} habitId={habits.has(reminder.id) ? reminder.id : undefined} />)}
    {/* 超出两条的**有效**事项收在这里，默认布局不膨胀，但一条都不会因为放不下而消失（§6.6）。
        标题不写数字：家人读的页面上不出现计数式描述（原则三）。过期的不在这里——它们已经退场，
        不从折叠层再回到首页（页面侧的过滤在 app/page.tsx）。 */}
    {more.length > 0 ? <details className="home-notes-more">
      <summary>还记着的其他事</summary>
      <div>{more.map((reminder) => <Note key={reminder.id} reminder={reminder} />)}</div>
    </details> : null}
    {/* 上报由浏览器在「真的进了视口 + 页面在前台」之后发起，不在服务端渲染时记。 */}
    {reportable.length > 0 ? <HabitShownReporter ids={reportable} /> : null}
  </section>;
}
