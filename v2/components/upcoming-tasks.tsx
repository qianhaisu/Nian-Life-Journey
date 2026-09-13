import Link from "next/link";
import { ageOn, formatDay, formatMonth } from "@/lib/time-signature";
import { groupUpcoming, splitUpcomingGroups, type UpcomingEvidence, type UpcomingFeed, type UpcomingGroup, type UpcomingItem, type UpcomingSources, type UpcomingWhen } from "@/lib/upcoming";
import type { UpcomingModality, UpcomingProvenance, UpcomingSourceNote, UpcomingSourceRole } from "@/lib/upcoming-provenance";

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
//   NOTHING IS DROPPED TO FIT. Four items show, chosen by the group order in lib/upcoming.ts
//   (今天和之后 → 时间待确认 → 待定的计划 → 过了日子还没完成 → 已经完成 → 已经取消); the rest sit
//   behind 展开全部 in the same markup, each part carrying its own group headings, so a group split
//   by the fold is named on both sides and all seventeen stay reachable.
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
function evidenceLink(evidence?: UpcomingEvidence): { href: string; label: string } | undefined {
  if (evidence?.eventId) return { href: `/events/${evidence.eventId}`, label: "看那一天" };
  if (evidence?.day) return { href: `/memory/${evidence.day.slice(0, 4)}/${evidence.day.slice(5, 7)}`, label: `翻到 ${formatMonth(evidence.day.slice(0, 7))}` };
  return undefined;
}

// The bare link, used for a change nobody has written a summary for yet. The label is deliberately
// 后续 and not 完成于: `statusEvidence.day` is the day somebody SAID the thing had happened, and on
// 2026-09-10 that sentence was 「已经带他看过咳嗽」 — a retelling that never says which day the visit
// was. 「完成于 9 月 10 日」 would have put a date on a hospital visit the archive cannot date.
function EvidenceLine({ evidence, label }: { evidence?: UpcomingEvidence; label: string }) {
  const link = evidenceLink(evidence);
  if (!evidence || !link) return null;
  return <span className="upcoming-evidence">
    <span className="upcoming-basis">{label}{evidence.day ? <> <time dateTime={evidence.day}>{formatDay(evidence.day)}</time></> : null}</span>
    <Link className="text-link upcoming-source" href={link.href}>{link.label}</Link>
  </span>;
}

// 来源摘要 — who raised this, in what tone, on what day, and separately what became of it.
//
// FOUR RULES, each one a sentence the page would otherwise get wrong (lib/upcoming-provenance.ts):
//
//   角色只有三种. A name is never guessed. `unconfirmed` prints 「来源人物未确认」 as itself — the
//   whole reason that variant exists is that the alternative is putting a sentence in the mouth of
//   someone who did not say it.
//
//   语气必须留下. 「要带去看医生吗」 is a question, 「下周想出去玩」 is a plan, 「老师说他没哭」 is
//   somebody relaying somebody else. Dropping the tone turns a discussion into a settled fact, so
//   the tone word is printed beside the role rather than left to be inferred from the summary.
//
//   `onDay` 是「哪天说的」，不是「哪天发生的」. It renders as 记录于 and nothing else. The day the
//   thing itself happened is `happenedOn`, which the data track leaves out whenever the source does
//   not say — and a missing `happenedOn` prints NOTHING. It is never filled in from `onDay`.
//
//   提出与完成分开. 「准备带去」 does not prove 「已经带到了」, so each kind of note is its own row
//   with its own label, its own day and its own link.
const MODALITY_LABEL: Record<UpcomingModality, string> = {
  statement: "说起", question: "问起", plan: "打算", condition: "有条件", relayed: "转述",
};

type SourceKind = "raised" | "completed" | "rescheduled" | "cancelled";
const SOURCE_KIND_LABEL: Record<SourceKind, string> = { raised: "提出", completed: "完成", rescheduled: "改期", cancelled: "取消" };
// Only printed when `happenedOn` is actually there. Each kind names what that day IS, so the date
// is attached to the event it dates rather than to the sentence that mentioned it.
const HAPPENED_LABEL: Record<SourceKind, string> = { raised: "实际发生于", completed: "实际完成于", rescheduled: "实际改到", cancelled: "实际取消于" };

function roleText(role: UpcomingSourceRole): string {
  if (role.kind === "family_member") return role.role;
  if (role.kind === "record_check") return role.label;
  return "来源人物未确认";
}

function sourceRowsOf(item: UpcomingItem, provenance?: UpcomingProvenance): { kind: SourceKind; note: UpcomingSourceNote; evidence?: UpcomingEvidence }[] {
  if (provenance?.reviewState !== "approved") return [];
  // 提出依据 hangs off the item's own evidence; every kind of CHANGE hangs off the change evidence.
  // They are different messages and they must never be swapped: that swap is exactly how a todo
  // that was only ever asked about comes to look like one that was carried out.
  const rows: { kind: SourceKind; note?: UpcomingSourceNote; evidence?: UpcomingEvidence }[] = [
    { kind: "raised", note: provenance.raised, evidence: item.evidence },
    { kind: "completed", note: provenance.completed, evidence: item.statusEvidence },
    { kind: "rescheduled", note: provenance.rescheduled, evidence: item.statusEvidence },
    { kind: "cancelled", note: provenance.cancelled, evidence: item.statusEvidence },
  ];
  return rows.filter((row): row is { kind: SourceKind; note: UpcomingSourceNote; evidence?: UpcomingEvidence } => Boolean(row.note));
}

function SourceRow({ kind, note, evidence }: { kind: SourceKind; note: UpcomingSourceNote; evidence?: UpcomingEvidence }) {
  const link = evidenceLink(evidence);
  return <li className={`upcoming-source-row upcoming-source-row--${kind}`}>
    <p className="upcoming-source-head">
      <span className="upcoming-source-kind">{SOURCE_KIND_LABEL[kind]}</span>
      <span className={`upcoming-source-role${note.role.kind === "unconfirmed" ? " upcoming-source-role--unconfirmed" : ""}`}>{roleText(note.role)}</span>
      <span className="upcoming-source-tone">{MODALITY_LABEL[note.modality]}</span>
      <span className="upcoming-source-day">记录于 <time dateTime={note.onDay}>{formatDay(note.onDay)}</time></span>
      {/* No `happenedOn`, no date. The sentence below says what the source said; it does not get a
          day the source never gave it. */}
      {note.happenedOn ? <span className="upcoming-source-happened">{HAPPENED_LABEL[kind]} <time dateTime={note.happenedOn}>{formatDay(note.happenedOn)}</time></span> : null}
    </p>
    <p className="upcoming-source-summary serif">{note.summary}</p>
    {link ? <p className="upcoming-source-check"><Link className="text-link upcoming-source" href={link.href}>{link.label}</Link></p> : null}
  </li>;
}

const STATUS_LABEL: Record<UpcomingItem["status"], string | undefined> = {
  open: undefined, tentative: "待定", done: "已完成", rescheduled: "改期", cancelled: "已取消",
};

// `hideWhen` 只在「时间待确认」那一组为真：那一组的组名已经把这句说了一遍，每条再写一次
// 「时间待确认」，读起来就是同一句话连着出现四遍（2026-09-13 部署后在 390px 上读出来的）。
// 其余每一组的日期都各不相同，照常显示。
function Item({ item, today, birthDay, hideWhen = false, sources }: { item: UpcomingItem; today: string; birthDay?: string; hideWhen?: boolean; sources?: UpcomingSources }) {
  const label = STATUS_LABEL[item.status];
  const provenance = sources?.status === "ready" ? sources.byItem.get(item.id) : undefined;
  const rows = sourceRowsOf(item, provenance);
  // A row carries its own date and its own link, so the bare 来源 line is only drawn where no
  // approved summary covers that evidence — never alongside one, which would print the same day
  // twice under two different names.
  const covered = new Set(rows.map((row) => row.kind));
  const bareEvidence = [
    covered.has("raised") ? null : <EvidenceLine key="raised" evidence={item.evidence} label="来源" />,
    // The evidence for the CHANGE is a second, separate line: the message that proves a thing was
    // done is not the message that asked for it.
    item.statusEvidence && !["completed", "rescheduled", "cancelled"].some((kind) => covered.has(kind as SourceKind))
      ? <EvidenceLine key="change" evidence={item.statusEvidence} label="后续" /> : null,
  ].filter(Boolean);
  return <li className={`upcoming-item upcoming-item--${item.status}`}>
    {hideWhen ? null : <WhenLabel when={item.when} today={today} birthDay={birthDay} />}
    <p className="upcoming-title serif">
      {item.status === "done" ? <del>{item.title}</del> : item.title}
      {label ? <span className={`upcoming-badge upcoming-badge--${item.status}`}>{label}</span> : null}
    </p>
    {item.note ? <p className="upcoming-note">{item.note}</p> : null}
    {item.statusNote ? <p className="upcoming-status-note">{item.statusNote}</p> : null}
    {bareEvidence.length > 0 ? <p className="upcoming-meta">{bareEvidence}</p> : null}
    {rows.length > 0 ? <ul className="upcoming-sources">{rows.map((row) => <SourceRow key={row.kind} {...row} />)}</ul> : null}
    {/* 「待审核」 and 「没有来源」 are different sentences and only one of them is ever true. A read
        that FAILED says neither — see the section-level line in UpcomingTasks. */}
    {provenance?.reviewState === "pending_review" ? <p className="upcoming-source-pending">来源摘要待审核</p> : null}
  </li>;
}

export function UpcomingTasks({ feed, today, birthDay, sources }: { feed: UpcomingFeed; today: string; birthDay?: string; sources?: UpcomingSources }) {
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
  const { head, rest } = splitUpcomingGroups(groupUpcoming(feed.items, today));
  const restCount = rest.reduce((total, group) => total + group.items.length, 0);
  const Groups = ({ groups }: { groups: UpcomingGroup[] }) => <>{groups.map((group) => <section className={`upcoming-group upcoming-group--${group.key}`} key={group.key}>
    <h3 className="upcoming-group-title">{group.label}</h3>
    <ul className="upcoming-list">{group.items.map((item) => <Item key={item.id} item={item} today={today} birthDay={birthDay} hideWhen={group.key === "undated"} sources={sources} />)}</ul>
  </section>)}</>;
  return <section className="home-upcoming reading-wrap" aria-labelledby="upcoming-title">
    <h2 id="upcoming-title" className="section-mark">近期待办</h2>
    {/* A failed source read is said once, here, in its own words. Per item it would have to choose
        between 「待审核」 and 「没有来源」, and both would be false. The todos themselves are a
        separate read and stay on the page: what is lost is the provenance, not the week. */}
    {sources?.status === "unreadable" ? <p className="upcoming-sources-unreadable">来源摘要这次没有读出来——不是这几条事项缺依据，也不是还在等人审核。</p> : null}
    <Groups groups={head} />
    {restCount > 0 ? <details className="upcoming-more">
      <summary>展开全部</summary>
      <Groups groups={rest} />
    </details> : null}
  </section>;
}
