import Link from "next/link";
import Image from "next/image";
import { HomeMemory } from "@/components/home-memory";
import { HomeReminders, type HomeReminder as HomeReminderView, type HomeReminderSource } from "@/components/home-reminders";
import { MODALITY_LABEL, SOURCE_KIND_LABEL, roleText, type SourceKind } from "@/components/upcoming-tasks";
import { readHomeFeed, HOME_REMINDER_LABEL, type HomeFeed, type HomeReminder, type HomeReminderState } from "@/lib/home-feed";
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { selectHomeMemory } from "@/lib/home-memory";
import { HOME_QUIET_STATES } from "@/lib/home-reminder-display";
import { CANONICAL_PROFILE_ID } from "@/lib/db/config";
import { renderOnDemand } from "@/lib/render-on-demand";
import { formatDay, formatMonth } from "@/lib/time-signature";
import "./home.css";

// 首页（2026-09-16 改版）。整页只有两件事：
//
//   一、最近怎么样，张年 —— 一段真实的回忆，静音预览，点开沉浸播放。
//   二、每周提醒        —— 过去 7 天微信里提到、仍需办理的事。
//
// 旧首页的其他模块（回忆浮现、换张照片、近况、月份入口……）退出首页，**内容一条没删**：
// 月份与全部记忆在顶部导航的「记忆」里，完整待办清单仍是 components/upcoming-tasks.tsx，
// 回忆浮现的 lib/home-recall.ts 与组件都保留着，只是首页不再渲染它。
//
// 读取笔数和改版前一样：一次记忆化的档案读 + 待办的几次小查询。selectHomeMemory 只吃已经读好的
// archive，**没有新增任何数据库调用**（CLAUDE.md 渲染路径那条 $87 出站流量的规矩）。

export default async function HomePage() {
  await renderOnDemand();
  const archive = await loadFamilyArchiveOnDemand();
  const feed = await readHomeFeed({ archive });
  const { memory, absence } = selectHomeMemory(archive);

  return <div className="home-v2">
    <div className="home-sheet">
      {/* 这一页的 h1 是这句问候，不是照片上的题签：页面回答的问题是「最近怎么样」，
          那段回忆是答案的一部分（原则一）。题签因此降成 h2，标题层级和阅读顺序一致。 */}
      <h1 className="home-greeting">最近怎么样，<span className="keep-whole">张年</span></h1>
      {memory
        ? <HomeMemory memory={memory} mood={memory.mood} />
        : <MemoryFallback feed={feed} reason={absence?.reason} />}
      <Reminders feed={feed} />
    </div>
  </div>;
}

// 没有合格回忆时的降级：**用已有的真实封面或真实文字**，不画空框、不写「暂无」
// （任务书五：「没有任何合格组时，使用已有真实封面或真实文字降级」）。
// 这里复用 home-feed 已经算好的主故事——它自己带日期、当时年龄和去处，一个字都不是生成的。
function MemoryFallback({ feed, reason }: { feed: HomeFeed; reason?: string }) {
  const lead = feed.lead;
  if (!lead) {
    return <p className="home-nothing">
      {feed.leadAbsence?.kind === "empty_material" ? "还没有一段整理好的记忆可以放在这里。" : "档案还是空的。等时间再走一会儿。"}
    </p>;
  }
  const photo = lead.photo;
  return <section className="home-memory home-memory--single" aria-label="最近的一段生活" data-fallback-reason={reason}>
    {photo
      ? <Link className="memory-single-photo" href={lead.story.href} aria-label={`读这张照片的那一天：${lead.story.title}`}>
        <Image
          src={photo.media.src}
          alt={photo.media.alt}
          width={photo.media.width || 4}
          height={photo.media.height || 3}
          sizes="(max-width: 899px) 96vw, 820px"
          priority
          unoptimized
        />
      </Link>
      : null}
    <p className="memory-caption-line">
      <time dateTime={lead.story.day}>{lead.story.dateLabel}</time>
      {lead.story.ageLabel ? <span> · 当时 {lead.story.ageLabel}</span> : null}
    </p>
    <h2 className="memory-title">{lead.story.title}</h2>
    <p className="memory-read"><Link href={lead.story.href}>读读这一天 <span aria-hidden="true">↗</span></Link></p>
  </section>;
}

// 还算「本周仍需办理」的三种状态。过期、完成、取消、被替代都不在这里——它们没有被删，
// 库里那一行一个字没动，只是不占首页这块地方。
const LIVE_REMINDER_STATES = new Set<HomeReminderState>(["active", "needs_confirmation", "tentative"]);

/**
 * 「每周提醒」。
 *
 * **标题什么时候画、什么时候不画，是这一段唯一重要的判断：**
 *
 *   ready / clear —— 我们真的读完了这 7 天。哪怕一条都没有，标题照画，下面留白
 *                    （任务书六：「确实没有事项时，『每周提醒』标题下面留白」）。
 *                    留白是一句真话，不补育儿建议、不写「全部完成」、不放空卡。
 *   unavailable   —— 读不出来 / 没提取完 / 材料为空。**整块不画**：这种情况下连
 *                    「这一周没有事」都不能说，画一个空标题就是把未知说成了没有。
 */
function Reminders({ feed }: { feed: HomeFeed }) {
  const { reminders } = feed;
  if (reminders.status === "unavailable") return null;
  const shown = reminders.status === "ready" ? reminders.shown : [];
  const more = reminders.status === "ready"
    ? reminders.more.filter((reminder) => LIVE_REMINDER_STATES.has(reminder.state))
    : [];
  return <HomeReminders
    reminders={shown.map(toReminderView)}
    more={more.map(toReminderView)}
    habitIds={reminders.status === "ready" ? reminders.habitShownIds : []}
    storageScope={CANONICAL_PROFILE_ID}
  />;
}

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
// 「准备带去」不等于「已经带到了」，所以这四种依据永远不合并成一句。
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

// 证据链入口（原则八）。标签必须跟着 `evidenceKind` 走：一个写着「看那一天」的月份链接，
// 读的人点进去核对不到这一条。
function evidenceLink(reminder: HomeReminder): { href: string; label: string } | undefined {
  if (!reminder.evidenceHref) return undefined;
  if (reminder.evidenceKind === "event") return { href: reminder.evidenceHref, label: "看那一天" };
  if (reminder.evidenceKind === "month") {
    const [, , year, month] = reminder.evidenceHref.split("/");
    return { href: reminder.evidenceHref, label: year && month ? `翻到 ${formatMonth(`${year}-${month}`)}` : "翻到那个月" };
  }
  return undefined;
}
