// 首页第一部分「最近怎么样，张年」的那一段回忆（2026-09-16）。
//
// 一段回忆 = **同一天**的一组照片 + 这一天自己已发布的标题。不是把不同故事的封面串起来，
// 也不是把一张照片反复裁切当成多张（用户 2026-09-16 明确点名的两种做法）。
//
// ─────────────────────────────────────────────────────────────────────────────
// 不新增任何数据库读取
// ─────────────────────────────────────────────────────────────────────────────
//
// 全部材料来自 `loadFamilyArchiveOnDemand()` 已经读好的那一份档案：
//   · `archive.chapters[].months[].photoDays` —— 每一天的照片（已过 family-visible + 可投递）
//   · `archive.chapters[].months[].memories`  —— 这一天已发布的记忆（标题、链接、当时年龄）
//   · `archive.privilege`                     —— 哪些照片有来源担保
// 没有 getStore()、没有 getOrganizerStore()、没有 raw_sources.text、没有整表查询
// （CLAUDE.md 渲染路径那条 $87 出站流量的规矩）。
//
// ─────────────────────────────────────────────────────────────────────────────
// 门槛一格没放宽：和「这个月的照片」是同一套闸门
// ─────────────────────────────────────────────────────────────────────────────
//
// 一张照片能进这段回忆，条件和它能进月末相册完全一样，逐条对齐
// lib/publication-moments.ts 里 `albumPhotosByDay` 的做法：
//   1. `isPrivileged` —— 来源可信（家庭相册原图，或 Teddy 确认过的那几个微信群），
//      或有人开过这个文件并记下画面里是这个孩子（media_subject_check）；
//   2. `thumbnailSized` —— 画得出来，不是 20×20 的表情碎片；
//   3. `photographsFirst` —— 屏幕形状的截图排到后面（只影响次序，不影响资格）。
//
// **这里没有新增一条授权，也没有放宽一条。** 同一批照片今天已经在 /memory 的月末相册里，
// 家人点得到；这一段做的是把其中**一天**的照片换一种读法，不是把没授权的东西搬上首页。
//
// ─────────────────────────────────────────────────────────────────────────────
// 连拍折叠：57 张 ≠ 57 个瞬间
// ─────────────────────────────────────────────────────────────────────────────
//
// 2026-09-16 对着生产相册接口实测：2026-09-08 那天「78 张照片」，按 90 秒分组只有 **9 组**。
// 原因是同一次快门在库里常常存了 2–4 行（原图 3120×4160 + 缩放版 1280×1706，takenAt 一模一样）。
// 不折叠就会连着放四张几乎一样的画面，那正是用户说的「把一张照片反复裁切当作多张」。
//
// 折叠用的是 lib/publication-moments.ts 已有的 `burstGroups`（90 秒），不另写一套——
// 月末相册的折叠也是它，两处对「什么算同一个瞬间」的理解必须是同一个。
//
// ─────────────────────────────────────────────────────────────────────────────
// 配文：一个字都不编
// ─────────────────────────────────────────────────────────────────────────────
//
// 配文只用**这一天已发布记忆的标题原文**，原样搬过来，不改写、不拼接、不生成。
// 没有标题的一天根本不会被选中（见 `qualifies`），所以不存在"配文缺了要补一句"的情况。
// 不虚构对白、心理、关系或成长结论（产品原则 + 用户 2026-09-16 的原话）。
import type { FamilyArchive } from "@/lib/family-archive";
import type { EditorialMemory, MediaRef, MonthChapter } from "@/lib/memory-chapters";
import { burstGroups, isPrivileged, type MediaPrivilege } from "@/lib/publication-moments";
import { heroSized, thumbnailSized } from "@/lib/media/hero";
import { photographsFirst } from "@/lib/media/presentation";
import { moodFor, type MemoryMood } from "@/lib/home-memory-mood";

/** 一段回忆至少要几个**不同的瞬间**才算数。低于这个数就不是一段回忆，是几张零散的照片。 */
export const MEMORY_MIN_SLIDES = 6;
/** 上限。再多就超过一分钟，也超出用户给的 6–12 张参考范围。 */
export const MEMORY_MAX_SLIDES = 12;
/** 每张停留多久（秒）。用户给的参考是 4–6 秒。 */
export const SLIDE_SECONDS = 5;
/** 交叉淡化时长（毫秒）。用户给的参考是 0.6–0.9 秒。 */
export const CROSSFADE_MS = 800;

export type HomeMemorySlide = {
  /** React key 与切换用的稳定标识。 */
  key: string;
  media: MediaRef;
  /**
   * 这一张出现时要不要压一行字。**只可能是这一天已发布记忆的标题原文**，
   * 绝大多数 slide 是 undefined——用户要的是「少量配文在适当节点出现」，不是每张都有字。
   */
  caption?: string;
};

export type HomeMemory = {
  day: string;
  /** "2026 年 9 月 8 日" */
  dateLabel: string;
  /** 「当时 1 岁 8 个月」里的那截；不知道出生日期时没有，不猜（原则二）。 */
  ageLabel?: string;
  /** 这一天已发布记忆的标题原文，作为这段回忆的名字。不是生成的。 */
  title: string;
  /** 读这一天的去处（站内既有路由）。 */
  href: string;
  slides: HomeMemorySlide[];
  /** 折叠前这一天真实的照片张数，只用于审计与 reason，**不显示给家人**（原则三：不出现计数式描述）。 */
  photoCount: number;
  durationSeconds: number;
  /**
   * 配哪一首曲子。在这里算而不是在页面里算，理由是它要和 `reason` 一起被审计：
   * 判定依据（照片节奏 + 已发布标题原文）都在这一层手上，页面拿不到也不该拿。
   */
  mood: MemoryMood;
  /** 为什么是这首曲子。见 lib/home-memory-mood.ts。不显示给家人。 */
  moodReason: string;
  /** 为什么是这一天、用了哪个窗口、折叠掉多少。供 STATUS 取证，不显示。 */
  reason: string;
};

/**
 * 没有合格回忆时的明确状态。页面据此**保留上一次的真实内容或降级到真实封面**，
 * 绝不画空框、绝不写「暂无」（原则三、原则六）。
 */
export type HomeMemoryAbsence = {
  kind: "empty_archive" | "no_qualified_day";
  reason: string;
};

/** 一天里能用的照片：和月末相册同一套闸门，次序也一致。 */
function usablePhotos(photos: readonly MediaRef[], privilege: MediaPrivilege): MediaRef[] {
  const vouched = photos.filter((item) => isPrivileged(item, privilege));
  return photographsFirst(vouched.filter(thumbnailSized));
}

/**
 * 每组连拍出一张代表：优先大图，退而求其次能画出来的，最后兜底组里第一张。
 *
 * 兜底到 `group[0]` 是故意的，和 `burstLeads` 同一个理由：相册层的承诺是每一组都留下一个入口，
 * 一组全是小图时整组消失会让那个瞬间从这一天里凭空少掉。
 */
function representatives(photos: readonly MediaRef[]): MediaRef[] {
  return burstGroups([...photos]).map((group) => group.find(heroSized) ?? group.find(thumbnailSized) ?? group[0]);
}

/**
 * 多于上限时怎么取：**沿着这一天均匀取**，不是砍掉后半天。
 *
 * 砍前 12 个会让一段"回忆"停在中午——2026-09-14 那天从早上 8 点拍到晚上 10 点，取前 12 组只到下午。
 * 均匀取保证开头、中段、结尾都在，这一天的弧线才完整（用户：「开头交代场景，中段变化，结尾自然停住」）。
 */
function spread<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]);
}

/** 这一天已发布的记忆，按 signature.day 精确匹配。 */
function memoriesOn(month: MonthChapter, day: string): EditorialMemory[] {
  return month.memories.filter((memory) => memory.signature.day === day);
}

/**
 * 把标题放到哪几张上。
 *
 * 至多两句，放在大约三分之一和三分之二处——开头那张不压字（先让人看见照片，
 * 这是「媒体在前」那条），结尾那张也不压字（自然停住，不要用一句话收尾）。
 */
function captionAt(slideCount: number, titles: readonly string[]): Map<number, string> {
  const spots = new Map<number, string>();
  if (slideCount < 3 || titles.length === 0) return spots;
  const positions = [Math.floor(slideCount / 3), Math.floor((slideCount * 2) / 3)];
  titles.slice(0, 2).forEach((title, index) => {
    const at = positions[index];
    if (at !== undefined && at > 0 && at < slideCount - 1 && !spots.has(at)) spots.set(at, title);
  });
  return spots;
}

/**
 * 选出首页要放的那一段回忆。
 *
 * 选法：**从最近的一天往回找，第一个合格的就是它。** 没有轮换、没有取模、没有随机。
 *
 * 为什么不做期次轮换（首页照片那边有 EDITION_HOURS 的六小时期次）：用户 2026-09-16 明确说
 * 「质量优先，不强制每日更新，也不机械沿用旧的每 6 小时轮换」。确定性的"最近一个合格日"天然稳定——
 * 它只在**真的多出一天合格材料**时才变，这正是「有意义的新增材料才替换当期」。
 */
export function selectHomeMemory(archive: FamilyArchive): { memory?: HomeMemory; absence?: HomeMemoryAbsence } {
  const { chapters, privilege, birthDay } = archive;
  const today = archive.time.today;
  let scannedDays = 0;

  for (const year of chapters) {
    for (const month of year.months) {
      // photoDays 本来就是新到旧；跨月时 chapters 也是新到旧，所以整体就是时间倒序。
      for (const photoDay of month.photoDays) {
        if (photoDay.day > today) continue; // 未来日期的行永远进不了首页
        scannedDays += 1;
        const published = memoriesOn(month, photoDay.day);
        // 没有已发布记忆的一天不做回忆：这段东西要有真名字和可追溯的去处（原则八），
        // 而未发布的故事本来就不在 chapters 里，家人也点不进去。
        if (published.length === 0) continue;

        const usable = usablePhotos(photoDay.photos, privilege);
        const reps = representatives(usable);
        if (reps.length < MEMORY_MIN_SLIDES) continue;

        const picked = spread(reps, MEMORY_MAX_SLIDES);
        const titles = published.map((memory) => memory.title);
        const captions = captionAt(picked.length, titles);
        const lead = published[0];
        // 配乐依据：这一天的照片节奏（拍摄时刻，元数据）+ 已发布标题原文。不看画面内容。
        const hours = photoDay.photos
          .map((item) => (item.takenAt ? Number(item.takenAt.slice(11, 13)) : Number.NaN))
          .filter((hour) => Number.isFinite(hour));
        const mood = moodFor({
          slides: picked.length,
          photos: photoDay.photos.length,
          firstHour: hours.length > 0 ? Math.min(...hours) : 12,
          lastHour: hours.length > 0 ? Math.max(...hours) : 12,
          titles,
        });
        return {
          memory: {
            day: photoDay.day,
            dateLabel: photoDay.dateLabel,
            // 照片自己那一天的年龄，来自 PhotoDay（groupPhotoDays 用 birthDay 算好的）。
            ageLabel: photoDay.ageLabel ?? lead.signature.ageLabel,
            title: lead.title,
            href: `/events/${lead.id}`,
            slides: picked.map((media, index) => ({
              key: `${photoDay.day}|${media.id}`,
              media,
              caption: captions.get(index),
            })),
            photoCount: photoDay.photos.length,
            durationSeconds: picked.length * SLIDE_SECONDS,
            mood: mood.mood,
            moodReason: mood.reason,
            reason: `最近一个合格日（往回找了 ${scannedDays} 天）；`
              + `这一天 ${photoDay.photos.length} 张，过闸门后 ${usable.length} 张，`
              + `按 90 秒连拍折叠成 ${reps.length} 个瞬间，取 ${picked.length} 张`
              + `${reps.length > picked.length ? "（沿全天均匀取，不截断后半天）" : ""}；`
              + `标题取自当天已发布记忆「${lead.title}」`,
          },
        };
      }
    }
  }

  if (scannedDays === 0) {
    return { absence: { kind: "empty_archive", reason: "档案里还没有一天带照片的记录" } };
  }
  return {
    absence: {
      kind: "no_qualified_day",
      reason: `往回看了 ${scannedDays} 天，没有一天同时满足「有已发布记忆」和「折叠后至少 ${MEMORY_MIN_SLIDES} 个不同瞬间」`,
    },
  };
}

/** 播放器与静音预览共用的时间轴常量，导出给组件，避免两处各写一份。 */
export const MEMORY_TIMING = { slideSeconds: SLIDE_SECONDS, crossfadeMs: CROSSFADE_MS } as const;
