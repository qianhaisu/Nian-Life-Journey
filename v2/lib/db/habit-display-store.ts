// 习惯提醒的露出日记录（§6.3「最多两个不同自然日露出」）。
//
// 上限数的是**实际露出过的日子**。那是历史：算不出来，只能记。所以这里有两件事，一读一写，
// 而写的那一边有一条比表结构更重要的规矩：
//
//   **只有真正呈现在默认提醒位上的那几条才记。**
//
//   不记的：预取/预热（没有人看到）、验证脚本与核验脚本（它们在测量，不是在呈现）、
//   以及折叠在「展开全部」里没露脸的事项（`more` 里的东西不算露出）。
//   记错方向的代价很具体：一次预热就能把一条习惯提醒的两个配额用掉，家人一次都没看见它就再也
//   看不到它了。所以调用方必须显式说「这是一次真实呈现」，默认什么都不记。
//
// 去重按 (profile_id, item_id, 上海自然日) 唯一键做，插入 on conflict do nothing。
// 同一天刷新一百次只有一行——占的是「日」，不是「次」。
//
// 这张表只增不删：一条露出记录是发生过的事。
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./client";
import * as t from "./schema";
import { CANONICAL_PROFILE_ID } from "./config";
import { habitDisplayLogFrom, type HabitDisplayLog } from "@/lib/upcoming-freshness";

export type HabitDisplayDb = Pick<ReturnType<typeof getDb>, "select" | "insert">;

const dbFor = (options: { db?: HabitDisplayDb; env?: NodeJS.ProcessEnv }) => options.db ?? getDb(options.env);

/** Postgres 的 42P01：这张表还不存在（迁移没在这个库上跑过）。 */
const isMissingTable = (error: unknown): boolean => {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === "object" && (current as { code?: string }).code === "42P01") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type HabitDisplayOptions = {
  profileId?: string;
  env?: NodeJS.ProcessEnv;
  db?: HabitDisplayDb;
};

/**
 * 读出这些事项各自露出过的自然日。
 *
 * 只读给定的 itemIds，不整表扫——首页一次最多问几条。表不存在（迁移还没跑）时返回空，
 * **不抛**：上限因此不生效，而不生效的后果是「不误伤任何人」，比让首页 500 好。
 */
export async function readHabitDisplayDays(
  itemIds: readonly string[],
  options: HabitDisplayOptions = {},
): Promise<Map<string, string[]>> {
  const byItem = new Map<string, string[]>();
  if (itemIds.length === 0) return byItem;
  const profileId = options.profileId ?? CANONICAL_PROFILE_ID;
  let db: HabitDisplayDb;
  try { db = dbFor(options); }
  catch { return byItem; }
  try {
    const rows = await db.select({
      itemId: t.habitDisplayDays.itemId,
      shownDay: t.habitDisplayDays.shownDay,
    }).from(t.habitDisplayDays).where(and(
      eq(t.habitDisplayDays.profileId, profileId),
      inArray(t.habitDisplayDays.itemId, [...itemIds]),
    ));
    for (const row of rows) {
      const list = byItem.get(row.itemId) ?? [];
      if (!list.includes(row.shownDay)) list.push(row.shownDay);
      byItem.set(row.itemId, list);
    }
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  return byItem;
}

/** 首页用的日志：先读一次，再交给 `capHabitByShownDays`。 */
export async function habitDisplayLog(
  itemIds: readonly string[],
  options: HabitDisplayOptions = {},
): Promise<HabitDisplayLog> {
  return habitDisplayLogFrom(await readHabitDisplayDays(itemIds, options));
}

/**
 * 记下「这些事项今天真的露在默认提醒位上了」。
 *
 * `day` 必须是**上海自然日**（调用方从 `feed.clock.today` 拿，那就是 `productToday()` 的结果）。
 * 不在这里自己取 `new Date()`：那会在 UTC 日界附近记错一天，而这张表的唯一键就是那一天。
 *
 * 幂等：唯一键 + on conflict do nothing。同一天调多少次都只有一行，所以「刷新不重复计数」不是靠
 * 调用方自律，是靠数据库约束。
 *
 * 表不存在时静默跳过——迁移随统一发布执行，在那之前首页不该因为记不上一行日志而报错。
 */
export async function recordHabitShown(
  itemIds: readonly string[],
  day: string,
  options: HabitDisplayOptions = {},
): Promise<{ attempted: number; skipped?: string }> {
  const ids = [...new Set(itemIds)].filter((id) => typeof id === "string" && id.trim());
  if (ids.length === 0) return { attempted: 0 };
  if (!DAY.test(day)) return { attempted: 0, skipped: `不是一个自然日："${day}"` };
  const profileId = options.profileId ?? CANONICAL_PROFILE_ID;
  let db: HabitDisplayDb;
  try { db = dbFor(options); }
  catch (error) { return { attempted: 0, skipped: `没有数据库连接：${String((error as Error)?.message ?? error)}` }; }
  try {
    await db.insert(t.habitDisplayDays)
      .values(ids.map((itemId) => ({ profileId, itemId, shownDay: day })))
      .onConflictDoNothing();
    return { attempted: ids.length };
  } catch (error) {
    if (isMissingTable(error)) return { attempted: 0, skipped: "habit_display_days 还不存在（迁移未跑）" };
    throw error;
  }
}
