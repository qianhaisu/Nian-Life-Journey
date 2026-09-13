import Link from "next/link";
import { HabitShownReporter } from "@/components/habit-shown-reporter";

// 首页的紧凑提醒。2026-09-13 的新版首页把原来那张完整的「近期待办」清单收成一条——默认一条，
// 最多两条，展开才看到依据。原清单没有删：它仍然是 components/upcoming-tasks.tsx，在别处照常用。
//
// 这里的规矩来自共同规格第 6 节，每一条都是「页面会说错的一句话」：
//
//   读不出来 ≠ 没有待办。数据轨说不可用（材料为空 / 没提取完 / 读失败）时，这一整块不渲染，
//   绝不写「全部完成」「暂无待办」。UpcomingTasks 里同一条规矩，同样的理由。
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
  // 「待确认」「已改期」等徽标，没有就不显示。
  statusLabel?: string;
  note?: string;
  sources: HomeReminderSource[];
};

function SourceRow({ source }: { source: HomeReminderSource }) {
  return <li className="home-reminder-source">
    <p className="home-reminder-source-head">
      <span className="home-reminder-kind">{source.kindLabel}</span>
      <span className={source.roleUnconfirmed ? "home-reminder-role home-reminder-role--unconfirmed" : "home-reminder-role"}>{source.roleText}</span>
      <span>{source.toneLabel}</span>
      <span>记录于 <time dateTime={source.recordedOn}>{source.recordedOnLabel}</time></span>
    </p>
    <p className="home-reminder-source-summary">{source.summary}</p>
    {source.link ? <p className="home-reminder-source-link"><Link href={source.link.href}>{source.link.label} <span aria-hidden="true">↗</span></Link></p> : null}
  </li>;
}

function Reminder({ reminder, label, habitId }: { reminder: HomeReminder; label?: string; habitId?: string }) {
  return <details className="home-reminder">
    {/* data-habit-id 只出现在默认位上、且只出现在习惯类事项上（id 由数据轨的 habitShownIds 给定）。
        折叠层里的那几条不带这个属性——「露出」数的是家人真的看见的那几天（§6.3）。 */}
    <summary className="home-reminder-bar" data-habit-id={habitId}>
      <span className="home-reminder-copy">
        {label ? <span className="home-reminder-label">{label}</span> : null}
        <span className="home-reminder-title">{reminder.title}</span>
        <span className="home-reminder-when">
          {reminder.whenDay ? <time dateTime={reminder.whenDay}>{reminder.whenText}</time> : reminder.whenText}
          {reminder.ageText ? <span> · {reminder.ageText}</span> : null}
        </span>
        {reminder.statusLabel ? <span className="home-reminder-status">{reminder.statusLabel}</span> : null}
      </span>
      <span className="home-reminder-toggle">查看详情</span>
    </summary>
    <div className="home-reminder-detail">
      {reminder.note ? <p>{reminder.note}</p> : null}
      {reminder.sources.length > 0 ? <ul className="home-reminder-sources">
        {reminder.sources.map((source) => <SourceRow key={`${reminder.id}-${source.kindLabel}-${source.recordedOn}`} source={source} />)}
      </ul> : null}
    </div>
  </details>;
}

export function HomeReminders({ reminders, more = [], habitIds = [] }: { reminders: HomeReminder[]; more?: HomeReminder[]; habitIds?: string[] }) {
  // 一条都没有 → 整块收起。这是「没有有效提醒」的呈现，不是「全部完成」的说法。
  if (reminders.length === 0 && more.length === 0) return null;
  // 默认重点一条，最多两条（共同规格 §6.6）。第二条起同样带自己的展开详情。
  const shown = reminders.slice(0, 2);
  const habits = new Set(habitIds);
  // 实际画在默认位上的习惯类事项，才是可能被上报的那几条。
  const reportable = shown.map((reminder) => reminder.id).filter((id) => habits.has(id));
  return <section className="home-reminders" aria-label="近期提醒">
    {shown.map((reminder, index) => <Reminder key={reminder.id} reminder={reminder} label={index === 0 ? "近期提醒" : undefined} habitId={habits.has(reminder.id) ? reminder.id : undefined} />)}
    {/* 上报由浏览器在「真的进了视口 + 页面在前台」之后发起，不在服务端渲染时记。 */}
    {reportable.length > 0 ? <HabitShownReporter ids={reportable} /> : null}
    {/* 超出两条的**有效**事项收在这里，默认布局不膨胀，但一条都不会因为放不下而消失（§6.6）。
        标题不写数字：家人读的页面上不出现计数式描述（原则三）。过期的不在这里——它们已经退场，
        不从折叠层再回到首页（页面侧的过滤在 app/page.tsx）。 */}
    {more.length > 0 ? <details className="home-reminder-more">
      <summary>还记着的其他事</summary>
      <div>{more.map((reminder) => <Reminder key={reminder.id} reminder={reminder} />)}</div>
    </details> : null}
  </section>;
}
