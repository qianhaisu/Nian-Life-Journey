import Link from "next/link";
import { HomeLead, type HomeLeadSlide } from "@/components/home-lead";
import { HomeRecall } from "@/components/home-recall";
import { HomeReminders, type HomeReminder as HomeReminderView, type HomeReminderSource } from "@/components/home-reminders";
import { MODALITY_LABEL, SOURCE_KIND_LABEL, roleText, type SourceKind } from "@/components/upcoming-tasks";
import { readHomeFeed, HOME_REMINDER_LABEL, type HomeFeed, type HomeReminder, type HomeReminderState } from "@/lib/home-feed";
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { selectHomeRecall } from "@/lib/home-recall";
import { HOME_QUIET_STATES } from "@/lib/home-reminder-display";
import { renderOnDemand } from "@/lib/render-on-demand";
import { formatDay, formatMonth } from "@/lib/time-signature";
import "./home.css";

// No `export const revalidate` here on purpose: this page is rendered on demand
// (lib/render-on-demand.ts), so there is no Next route cache for a revalidate window to
// govern — leaving the export would state a caching promise the route no longer makes. The
// same 300s lives one layer down, on the archive read itself
// (ON_DEMAND_ARCHIVE_TTL_MS in lib/family-archive.ts).

// 首页（2026-09-13 定稿）。一屏回答一个问题：最近怎么样，张年。
//
// 这一版把首页收敛成几件事（2026-09-15 起不再显示今天与今天的年龄）——一张照片和它所属的那一段真实生活 →
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
//
// 标题强调（2026-09-14）不再是这里按 eventId 逐篇写死的表：lib/title-emphasis.ts 的小词组规则
// 对任何标题都适用，components/home-lead.tsx 负责画出来。

export default async function HomePage() {
  // Never prerender this page from the build's mock store — see lib/render-on-demand.ts.
  await renderOnDemand();
  // 读取笔数和今天的首页基本一样：一次记忆化的档案读（下面显式拿一次、传给 readHomeFeed 复用，
  // 「回忆浮现」用同一份 chapters，不再多读一次）+ 待办的三次小查询（+ 来源摘要的两次），
  // 没有新增整表查询、没有 getStore()/getOrganizerStore()（CLAUDE.md 渲染路径那条）。
  const archive = await loadFamilyArchiveOnDemand();
  const feed = await readHomeFeed({ archive });
  const { clock, lead, photoCandidates } = feed;

  // 「换张照片」的切换单位是 (故事, 照片) 对：候选自带自己的故事，所以换图必然连带换标题、
  // 日期、当时年龄、「读读这一天」和点照片的去处，页面不可能只换 img（契约 HomePhotoCandidate）。
  // 当期选中的那一张排在最前，其余按契约给的顺序跟在后面。
  // 只有真正参与本期轮换的候选（当期那张，或带 cooldown 的池内候选）才成为可以翻到的照片。
  // 契约里还带着本期未生效、连拍被挡下的候选（带原因，供审计），它们不该出现在「换张照片」里。
  const rotating = photoCandidates.filter((candidate) => candidate.chosen || candidate.cooldown);
  // A1：story 自己的日子/当时年龄跟着 eventId/href/title/excerpt 一起传下去——lib/home-feed.ts 的
  // HomeStoryRef 本来就带这三个字段，之前这里没往下传，题签旁边就没有自己的日期可显示。
  const storyOf = (story: { eventId: string; href: string; title: string; excerpt?: string; day: string; dateLabel: string; ageLabel?: string }) =>
    ({ eventId: story.eventId, href: story.href, title: story.title, excerpt: story.excerpt, day: story.day, dateLabel: story.dateLabel, ageLabel: story.ageLabel });
  const slides: HomeLeadSlide[] = rotating.length > 0
    ? [...rotating].sort((a, b) => Number(b.chosen) - Number(a.chosen)).map((candidate) => ({
      key: candidate.key,
      story: storyOf(candidate.story),
      photo: {
        media: candidate.photo.media,
        day: candidate.photo.day,
        dayLabel: candidate.photo.dateLabel,
        ageLabel: candidate.photo.ageLabel,
      },
    }))
    // 有故事但没有一张通过审核的配图（photoAbsence 说明是哪一种「没有」）：只留真实文字。
    // 不画空照片框、不借别的故事的照片，也不写一句「暂无照片」（§5.7、原则三）。
    : lead
      ? [{ key: lead.story.eventId, story: storyOf(lead.story) }]
      : [];

  // 2026-09-15 用户：首页不再显示「今天的日期 · 现在几岁」这一行。日期和年龄只跟着内容走——
  // 题签下面那段故事自己的日子与当时年龄照常显示。`clock.today` 仍用于回忆浮现的选择。

  // D3：回忆浮现。跟首页正在讲的这段故事共用同一份 archive，不重复整表读；三档关系一个都不成立
  // 就是 undefined，HomeRecall 什么都不画——不是"没找到就换一条随便的"。
  const recall = selectHomeRecall(archive.chapters, clock.today, archive.birthDay, lead?.story.eventId);

  return <div className="home-v2">
    <div className="home-sheet">
      {/* 一张大照片在右，题签和便签在左。DOM 顺序就是窄屏的阅读顺序：照片 → 日期 → 题签 → 便签。 */}
      <div className="home-spread">
        {/* 这一版首页不再露出第二条「近况」入口（版式卡一·5）：recentFact 仍在契约里，
            对应记录在记忆页和事件页照常可达，只是不占首页这块地方。
            便签作为左栏的一部分传给 HomeLead：左栏必须是一个 grid 单元，否则高照片会把它撑散。 */}
        {slides.length > 0
          ? <HomeLead slides={slides} notes={<Reminders feed={feed} />} />
          : <div className="home-aside">
            <div className="home-headline">
              <p className="home-nothing">{feed.leadAbsence?.kind === "empty_material" ? "还没有一段整理好的记忆可以放在这里。" : "档案还是空的。等时间再走一会儿。"}</p>
            </div>
            <Reminders feed={feed} />
          </div>}
      </div>
      {/* D3：一句安静的话，不是又一块卡片——跟首页原有的"一张照片、一句题签、一处提醒"平级，
          不挤进 home-spread 的居中计算里（PAGE-0915-HOME-BALANCE 的左栏整体居中不受影响）。 */}
      <HomeRecall recall={recall} />
    </div>
  </div>;
}

// 还算「近期提醒」的三种状态。过期、已完成、已取消、已被替代都不属于这里——它们没有被删，
// 库里那一行一个字没动，只是不再占住首页这块地方（共同规格 §6.1「退场不等于完成」）。
const LIVE_REMINDER_STATES = new Set<HomeReminderState>(["active", "needs_confirmation", "tentative"]);

// 没有有效提醒就整块不画。三种「没有」都走到这里，但理由各不相同，一句都不许混着说：
//   unavailable —— 读不出来 / 没提取完 / 材料为空。**绝不是**「没有待办」，更不是「全部完成」。
//   clear —— 真的读完了整个窗口、真的一条都没有。这是真话，但它是一句给不出任何东西的话，
//            首页不留这块（Teddy 2026-09-13：无有效提醒时隐藏整个模块）。要核对读到哪天，
//            完整清单仍然是 components/upcoming-tasks.tsx。
//   ready 但 shown 为空 —— 有事项，但没有一条还有效。同样不画，不画成「全部完成」。
function Reminders({ feed }: { feed: HomeFeed }) {
  const { reminders } = feed;
  if (reminders.status !== "ready") return null;
  // 折叠里放的是**还有效**的那些，不是 more 的全部：more 里也装着过期和已完成的，把它们放进
  // 「近期提醒」的折叠层，等于让刚退场的陈旧采购从另一个门回到首页。
  const more = reminders.more.filter((reminder) => LIVE_REMINDER_STATES.has(reminder.state));
  if (reminders.shown.length === 0 && more.length === 0) return null;
  // 露出上报（§6.3 的「最多两个不同自然日」数的是**真被看见的那几天**）：这里只把数据轨算好的
  // `habitShownIds` 传下去，**不在这次请求里记账**。记账的时机是浏览器里那块提醒进了视口、
  // 且页面在前台（components/habit-shown-reporter.tsx）。
  //
  // 数据轨的接线文档给的是在 SSR 里调 `reportHabitShown(feed)`，这里**故意没有那么做**：
  // 一次 GET 不等于一次露出。预热、健康检查、截图脚本都会发 GET，而配额只有两天——
  // 记错一次，这条提醒家人一次都没看见就再也看不到它了。判断哪几条是习惯类仍然是数据轨的事，
  // 页面一条都不自己筛。
  return <HomeReminders
    reminders={reminders.shown.map(toReminderView)}
    more={more.map(toReminderView)}
    habitIds={reminders.habitShownIds}
  />;
}

// 契约项 → 展示用的几行字。状态文案取 HOME_REMINDER_LABEL，页面不自拟；「要做的」是默认含义，
// 不重复印在一条本来就摆在「近期提醒」下面的事项上。HOME_QUIET_STATES 见 lib/home-reminder-display.ts
// （单独放一个 lib 文件，因为这个文件顶部 import "./home.css"，直接从这里导出会让测试连带把一份
// CSS 当 JS 解析）。
function toReminderView(reminder: HomeReminder): HomeReminderView {
  const when = reminder.item.when;
  return {
    id: reminder.id,
    title: reminder.title,
    whenText: reminder.deadlineLabel,
    whenDay: when.kind === "day" ? when.day : undefined,
    statusLabel: HOME_QUIET_STATES.has(reminder.state) ? undefined : HOME_REMINDER_LABEL[reminder.state],
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
  const link = evidenceLink(reminder);
  return notes.flatMap(({ kind, note }) => note ? [{
    kindLabel: SOURCE_KIND_LABEL[kind],
    roleText: roleText(note.role),
    roleUnconfirmed: note.role.kind === "unconfirmed",
    toneLabel: MODALITY_LABEL[note.modality],
    recordedOn: note.onDay,
    recordedOnLabel: formatDay(note.onDay),
    summary: note.summary,
    link,
  }] : []);
}

// 证据链入口（原则八）。**标签必须跟着 `evidenceKind` 走**：1.1.0 之前这里一律写「看那一天」，
// 而生产上 18 条待办的证据其实只有一个日期、没有 eventId，链接落到的是整张月页——一个写着
// 「看那一天」的月份链接，读的人点进去核对不到这一条。数据轨 2026-09-13 验收原则八时点了那三个
// 链接才发现（grep 查不出来：字段在、类型对、测试也过）。
function evidenceLink(reminder: HomeReminder): { href: string; label: string } | undefined {
  if (!reminder.evidenceHref) return undefined;
  if (reminder.evidenceKind === "event") return { href: reminder.evidenceHref, label: "看那一天" };
  if (reminder.evidenceKind === "month") {
    // "/memory/2026/08" → 「翻到 2026 年 8 月」，和 upcoming-tasks.tsx 里的说法一致。
    const [, , year, month] = reminder.evidenceHref.split("/");
    return { href: reminder.evidenceHref, label: year && month ? `翻到 ${formatMonth(`${year}-${month}`)}` : "翻到那个月" };
  }
  return undefined;
}
