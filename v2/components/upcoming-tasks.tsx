import Link from "next/link";
import { ageOn, formatDay, formatMonth } from "@/lib/time-signature";
import { UPCOMING_VISIBLE, type UpcomingEvidence, type UpcomingFeed, type UpcomingItem, type UpcomingWhen } from "@/lib/upcoming";

// 近期待办 on the front page: what the family has to do next, under how he has been lately and
// above the day's story. The contract, and the reasons the states are what they are, live in
// lib/upcoming.ts; this file only lays them out.
//
// Three presentation decisions worth naming, because each one is a rule rather than a taste:
//
//   THE LINE THROUGH A FINISHED ITEM IS A CLAIM. `<del>` is used for `done` only, and lib/upcoming
//   .ts will not hand this component a `done` without evidence behind it. A cancelled item is NOT
//   struck through — 「改期、取消与完成区分显示」 — it keeps its text and says 已取消, because a trip
//   nobody took is not a thing that got done.
//
//   A DATE ALWAYS READS TWICE (原则二). 「明天 · 9 月 13 日 · 到时 1 岁 8 个月」: the near-term word
//   is computed from the archive's own today against the item's resolved day, the absolute date is
//   always printed beside it so nothing is ambiguous, and the age uses 到时 for a day still ahead and
//   当时 for one already past. An item whose day nobody could pin says 时间待确认 and nothing else —
//   never a guessed date (Teddy, 2026-09-12).
//
//   NOTHING IS DROPPED TO FIT. Four items show; the rest sit behind 展开全部 in the same list
//   markup, so a long week is complete on the page rather than truncated by a design number.
function WhenLabel({ when, today, birthDay }: { when: UpcomingWhen; today: string; birthDay?: string }) {
  if (when.kind === "unconfirmed") return <span className="upcoming-when upcoming-when--unset">时间待确认</span>;
  if (when.kind === "window") {
    return <span className="upcoming-when">
      <time dateTime={when.fromDay}>{formatDay(when.fromDay)}</time>
      <span aria-hidden="true"> — </span>
      <time dateTime={when.toDay}>{formatDay(when.toDay)}</time>
    </span>;
  }
  const age = ageOn(birthDay, when.day);
  // Only the two days a family actually says out loud get a word; everything else is its date.
  // Computed from `today` (lib/time-truth.ts productToday, the family's calendar), never guessed.
  const nearTerm = when.day === today ? "今天" : when.day === nextDay(today) ? "明天" : undefined;
  return <span className="upcoming-when">
    {nearTerm ? <strong className="upcoming-near">{nearTerm}</strong> : null}
    <time dateTime={when.day}>{formatDay(when.day)}</time>
    {age ? <span className="upcoming-age">{when.day >= today ? "到时" : "当时"} {age}</span> : null}
  </span>;
}

function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

// 依据：说了这件事的那一天，写出来，并且链接的名字就是它要去的地方。
//
// 2026-09-13 验收记的两条：那个链接是 38×40，够不到一个拇指；而它写着「看来源」，去的却是整张
// 月页，读的人没办法核对到这一条。现在日期直接印在页面上（`evidence.day` 本来就到得了页面，
// 只是从没被显示过），链接改叫它真正打开的那个月，并且撑到 44×44。
//
// 还差什么、差在哪一层：`upcoming_items` 里每一行都有 `who_asked`（老师／爸爸／妈妈）和
// `when_basis`（「消息发于 X，说了『明天』」），但 `toUpcomingItem()` 的页面投影把它们丢掉了，
// 而那个投影是数据轨的文件。要让家人看到「谁说的、凭哪句」，需要数据轨在投影里加两样：
// `evidence.who`（角色词，不是姓名）和一句**经人工审过的**来源摘要。页面这边不自己去读原始
// 聊天，也不改任何审核状态。
function EvidenceLine({ evidence, label }: { evidence?: UpcomingEvidence; label: string }) {
  if (!evidence) return null;
  const href = evidence.eventId ? `/events/${evidence.eventId}` : evidence.day ? `/memory/${evidence.day.slice(0, 4)}/${evidence.day.slice(5, 7)}` : undefined;
  if (!href) return null;
  const linkLabel = evidence.eventId ? "看那一天" : evidence.day ? `翻到 ${formatMonth(evidence.day.slice(0, 7))}` : "";
  return <span className="upcoming-evidence">
    <span className="upcoming-basis">{label}{evidence.day ? <> <time dateTime={evidence.day}>{formatDay(evidence.day)}</time></> : null}</span>
    <Link className="text-link upcoming-source" href={href}>{linkLabel}</Link>
  </span>;
}

const STATUS_LABEL: Record<UpcomingItem["status"], string | undefined> = {
  open: undefined, tentative: "待定", done: "已完成", rescheduled: "改期", cancelled: "已取消",
};

function Item({ item, today, birthDay }: { item: UpcomingItem; today: string; birthDay?: string }) {
  const label = STATUS_LABEL[item.status];
  return <li className={`upcoming-item upcoming-item--${item.status}`}>
    <WhenLabel when={item.when} today={today} birthDay={birthDay} />
    <p className="upcoming-title serif">
      {item.status === "done" ? <del>{item.title}</del> : item.title}
      {label ? <span className={`upcoming-badge upcoming-badge--${item.status}`}>{label}</span> : null}
    </p>
    {item.note ? <p className="upcoming-note">{item.note}</p> : null}
    {item.statusNote ? <p className="upcoming-status-note">{item.statusNote}</p> : null}
    <p className="upcoming-meta">
      <EvidenceLine evidence={item.evidence} label="来源" />
      {/* The evidence for the CHANGE is a second, separate line: the message that proves a thing
          was done is not the message that asked for it. */}
      {item.statusEvidence ? <EvidenceLine evidence={item.statusEvidence} label={item.status === "done" ? "完成于" : "后续"} /> : null}
    </p>
  </li>;
}

export function UpcomingTasks({ feed, today, birthDay }: { feed: UpcomingFeed; today: string; birthDay?: string }) {
  // An unavailable feed renders NOTHING — not an empty state, not 「暂无待办」. See lib/upcoming.ts:
  // a missing table, a failed read, a half-covered run and a queue waiting on a reviewer are all
  // states in which the page cannot prove anything about the family's week, so it says nothing.
  if (feed.status === "unavailable") return null;
  // The one case it can prove: a run that read its whole window, nothing in it, nothing pending
  // review. It says which period that was, because 「没有待办」 without a period is not checkable.
  if (feed.status === "clear") {
    return <section className="home-upcoming reading-wrap" aria-labelledby="upcoming-title">
      <h2 id="upcoming-title" className="section-mark">近期待办</h2>
      <p className="upcoming-clear">{feed.readToDay ? `${formatDay(feed.windowFrom)} 到 ${formatDay(feed.readToDay)}，没有要记着的事。` : "没有要记着的事。"}</p>
    </section>;
  }
  const visible = feed.items.slice(0, UPCOMING_VISIBLE);
  const rest = feed.items.slice(UPCOMING_VISIBLE);
  return <section className="home-upcoming reading-wrap" aria-labelledby="upcoming-title">
    <h2 id="upcoming-title" className="section-mark">近期待办</h2>
    <ul className="upcoming-list">{visible.map((item) => <Item key={item.id} item={item} today={today} birthDay={birthDay} />)}</ul>
    {rest.length > 0 ? <details className="upcoming-more">
      <summary>展开全部</summary>
      <ul className="upcoming-list">{rest.map((item) => <Item key={item.id} item={item} today={today} birthDay={birthDay} />)}</ul>
    </details> : null}
  </section>;
}
