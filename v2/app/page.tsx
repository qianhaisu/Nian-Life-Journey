import { HomeLead, type HomeLeadSlide } from "@/components/home-lead";
import { HomeReminders, type HomeReminder as HomeReminderView, type HomeReminderSource } from "@/components/home-reminders";
import { MODALITY_LABEL, SOURCE_KIND_LABEL, roleText, type SourceKind } from "@/components/upcoming-tasks";
import { readHomeFeed, HOME_REMINDER_LABEL, type HomeFeed, type HomeReminder } from "@/lib/home-feed";
import { renderOnDemand } from "@/lib/render-on-demand";
import { formatDay } from "@/lib/time-signature";
import "./home.css";

// No `export const revalidate` here on purpose: this page is rendered on demand
// (lib/render-on-demand.ts), so there is no Next route cache for a revalidate window to
// govern — leaving the export would state a caching promise the route no longer makes. The
// same 300s lives one layer down, on the archive read itself
// (ON_DEMAND_ARCHIVE_TTL_MS in lib/family-archive.ts).

// 首页（2026-09-13 定稿）。一屏回答一个问题：最近怎么样，张年。
//
// 这一版把首页收敛成四件事——今天与今天的年龄 → 一张照片和它所属的那一段真实生活 →
// 至多一条不重复的近况 → 默认一条、最多两条还有效的提醒。它替掉的是同一个页面上并排的七个模块
// （近况概览、上月回顾、完整待办清单、抽到的一天、同日其他条目、最近照片组、忽然想起、底部月份
// 入口），那些内容一条都没有删，只是各回各的页面：月份与全部记忆在顶部的「记忆」里，
// 回顾在月页里，完整待办清单仍然是 components/upcoming-tasks.tsx。
//
// 用户 2026-09-13 明确追加的一条：**删掉最底部的月份与「全部记忆」链接**——它们和顶部导航的
// 「记忆」是同一个入口，在一页里出现两次。所以这个文件里不再有 .home-entries 那一块。
//
// 页面自己不做任何领域判断：选哪张照片、哪段故事、哪条提醒还有效、退场还是完成，全部由
// lib/home-feed.ts 决定（数据轨 2026-09-13 冻结的 home-feed/1.0.0）。这里只负责把它摆出来，
// 以及把三种「没有」摆成三种不同的样子：没有合格照片就只留文字，没有故事就说这一句话，
// 提醒读不出来就整块不画——绝不写成「全部完成」。
export default async function HomePage() {
  // Never prerender this page from the build's mock store — see lib/render-on-demand.ts.
  await renderOnDemand();
  // 读取笔数和今天的首页完全一样：一次记忆化的档案读 + 待办的三次小查询（+ 来源摘要的两次），
  // 没有新增整表查询、没有 getStore()/getOrganizerStore()（CLAUDE.md 渲染路径那条）。
  const feed = await readHomeFeed();
  const { clock, lead, photoCandidates, recentFact } = feed;

  // 「换张照片」的切换单位是 (故事, 照片) 对：候选自带自己的故事，所以换图必然连带换标题、
  // 日期、当时年龄和「读读这一天」的去处，页面不可能只换 img（契约 HomePhotoCandidate）。
  // 当期选中的那一张排在最前，其余按契约给的顺序跟在后面。
  const slides: HomeLeadSlide[] = photoCandidates.length > 0
    ? [...photoCandidates].sort((a, b) => Number(b.chosen) - Number(a.chosen)).map((candidate) => ({
      key: candidate.key,
      story: { eventId: candidate.story.eventId, href: candidate.story.href, title: candidate.story.title, excerpt: candidate.story.excerpt },
      photo: {
        media: candidate.photo.media,
        day: candidate.photo.day,
        dayLabel: candidate.photo.dateLabel,
        ageLabel: candidate.photo.ageLabel,
        // 查看器里一次只翻这一张：候选之间属于不同的故事，把它们串成一卷会读成「这一天的一组照片」，
        // 而它们不是。同一段生活里的其他照片仍然在那一天的页面上。
        siblings: [candidate.photo.media],
      },
    }))
    // 有故事但没有一张通过审核的配图（photoAbsence 说明是哪一种「没有」）：只留真实文字。
    // 不画空照片框、不借别的故事的照片，也不写一句「暂无照片」（§5.7、原则三）。
    : lead
      ? [{ key: lead.story.eventId, story: { eventId: lead.story.eventId, href: lead.story.href, title: lead.story.title, excerpt: lead.story.excerpt } }]
      : [];

  return <div className="home-v2">
    <div className="home-sheet">
      {/* 现在的张年：档案自己的今天，和他今天几岁。这两个时钟都不随下面抽到哪一天而变（原则二）。 */}
      <section className="home-intro" aria-label="现在的张年">
        <div>
          <p className="home-today"><time dateTime={clock.today}>{clock.todayLabel}</time></p>
          <h1>最近怎么样，<span className="home-name">张年。</span></h1>
        </div>
        {/* 出生日期未知时不猜年龄，这一行直接不出现。 */}
        {clock.ageToday ? <p className="home-current-age">现在 <strong>{clock.ageToday}</strong></p> : null}
      </section>

      {slides.length > 0
        ? <HomeLead
          slides={slides}
          recent={recentFact ? {
            eventId: recentFact.eventId,
            href: recentFact.href,
            title: recentFact.title,
            day: recentFact.day,
            dayLabel: recentFact.dateLabel,
            ageLabel: recentFact.ageLabel,
          } : undefined}
        />
        : <p className="home-nothing">{feed.leadAbsence?.kind === "empty_material" ? "还没有一段整理好的记忆可以放在这里。" : "档案还是空的。等时间再走一会儿。"}</p>}

      <Reminders feed={feed} />
    </div>
  </div>;
}

// 三种状态，三种不同的样子。把它们写成同一句话，就是 CLAUDE.md 里反复点名的那种假话。
function Reminders({ feed }: { feed: HomeFeed }) {
  const { reminders } = feed;
  // 读不出来 / 没提取完 / 材料为空：整块不画。不是「没有待办」，更不是「全部完成」。
  if (reminders.status === "unavailable") return null;
  // 真的读完了整个窗口、真的什么都没有——把读到哪天印出来，这句话才是可核对的。
  if (reminders.status === "clear") {
    return <p className="home-nothing">
      {reminders.readToDay
        ? `${formatDay(reminders.windowFrom)} 到 ${formatDay(reminders.readToDay)}，没有要记着的事。`
        : "没有要记着的事。"}
    </p>;
  }
  return <HomeReminders reminders={reminders.shown.map(toReminderView)} />;
}

// 契约项 → 展示用的几行字。状态文案取 HOME_REMINDER_LABEL，页面不自拟；「要做的」是默认含义，
// 不重复印在一条本来就摆在「近期提醒」下面的事项上。
function toReminderView(reminder: HomeReminder): HomeReminderView {
  const when = reminder.item.when;
  return {
    id: reminder.id,
    title: reminder.title,
    whenText: reminder.deadlineLabel,
    whenDay: when.kind === "day" ? when.day : undefined,
    statusLabel: reminder.state === "active" ? undefined : HOME_REMINDER_LABEL[reminder.state],
    note: reminder.detail,
    sources: provenanceRows(reminder),
  };
}

// 来源摘要：提出 / 完成 / 改期 / 取消 各自一行，各自带自己的语气、记录时间和去处。
// 「准备带去」不等于「已经带到了」，所以这四种依据永远不合并成一句（upcoming-tasks.tsx 同一条规矩）。
// 只有经过审核的来源才出现在页面上；未审核的一个字都不显示。
function provenanceRows(reminder: HomeReminder): HomeReminderSource[] {
  const provenance = reminder.provenance;
  if (provenance?.reviewState !== "approved") return [];
  const notes: { kind: SourceKind; note: NonNullable<typeof provenance.raised> | undefined }[] = [
    { kind: "raised", note: provenance.raised },
    { kind: "completed", note: provenance.completed },
    { kind: "rescheduled", note: provenance.rescheduled },
    { kind: "cancelled", note: provenance.cancelled },
  ];
  return notes.flatMap(({ kind, note }) => note ? [{
    kindLabel: SOURCE_KIND_LABEL[kind],
    roleText: roleText(note.role),
    roleUnconfirmed: note.role.kind === "unconfirmed",
    toneLabel: MODALITY_LABEL[note.modality],
    recordedOn: note.onDay,
    recordedOnLabel: formatDay(note.onDay),
    summary: note.summary,
    // 证据链入口：回到说这件事的那一天（原则八）。没有可指的事件时不画一个去不了的链接。
    link: reminder.evidenceHref ? { href: reminder.evidenceHref, label: "看那一天" } : undefined,
  }] : []);
}
