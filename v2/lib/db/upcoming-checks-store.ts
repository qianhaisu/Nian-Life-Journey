import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { CANONICAL_PROFILE_ID } from "@/lib/db/config";

// 首页「每周提醒」上家人打的勾，存在服务端（表的由来见 schema.ts 的 upcomingChecks 注释）。
//
// 这一层只碰 upcoming_checks 这一张表：读一个 id 集合、加一行、删一行。它**永远不会**去改
// upcoming_items.status——打勾是家人的一句话，不是微信里的证据，两者在库里必须分开（
// lib/db/upcoming-store.ts 第 2 条：没有证据就不许有删除线）。

export type UpcomingCheckOptions = { profileId?: string; db?: ReturnType<typeof getDb> };

/** 这个档案下所有被打勾的事项 id。读不到就返回空集合——页面画成「都没勾」，不报错。 */
export async function readUpcomingChecks(options: UpcomingCheckOptions = {}): Promise<Set<string>> {
  const db = options.db ?? getDb();
  const profileId = options.profileId ?? CANONICAL_PROFILE_ID;
  const rows = await db
    .select({ itemId: t.upcomingChecks.itemId })
    .from(t.upcomingChecks)
    .where(eq(t.upcomingChecks.profileId, profileId));
  return new Set(rows.map((row) => row.itemId));
}

/**
 * 打勾 / 取消打勾。取消就是删掉那一行。
 *
 * 幂等：同一条重复打勾只会有一行（唯一键 profile+item），重复取消也不报错。
 */
export async function setUpcomingCheck(
  itemId: string,
  checked: boolean,
  options: UpcomingCheckOptions & { title?: string } = {},
): Promise<{ itemId: string; checked: boolean }> {
  const db = options.db ?? getDb();
  const profileId = options.profileId ?? CANONICAL_PROFILE_ID;
  if (checked) {
    await db
      .insert(t.upcomingChecks)
      .values({ profileId, itemId, titleAtCheck: options.title ?? null })
      .onConflictDoNothing({ target: [t.upcomingChecks.profileId, t.upcomingChecks.itemId] });
  } else {
    await db
      .delete(t.upcomingChecks)
      .where(and(eq(t.upcomingChecks.profileId, profileId), eq(t.upcomingChecks.itemId, itemId)));
  }
  return { itemId, checked };
}

/**
 * 一次交上来的一整份勾选状态（浏览器本地存过的那份，第一次登陆服务端时用）。
 *
 * 合并而不是覆盖：只补上服务端还没有的勾，绝不因为某台设备的本地存储是空的就把已有的勾删掉。
 * 一台清过缓存的手机同步上来时，不该把电脑上勾过的都抹掉。
 */
export async function mergeUpcomingChecks(
  itemIds: readonly string[],
  options: UpcomingCheckOptions = {},
): Promise<{ added: string[] }> {
  const db = options.db ?? getDb();
  const profileId = options.profileId ?? CANONICAL_PROFILE_ID;
  const ids = [...new Set(itemIds.filter((id) => typeof id === "string" && id.trim()))].slice(0, 200);
  if (ids.length === 0) return { added: [] };
  const existing = new Set(
    (await db
      .select({ itemId: t.upcomingChecks.itemId })
      .from(t.upcomingChecks)
      .where(and(eq(t.upcomingChecks.profileId, profileId), inArray(t.upcomingChecks.itemId, ids)))
    ).map((row) => row.itemId),
  );
  const added = ids.filter((id) => !existing.has(id));
  if (added.length) {
    await db
      .insert(t.upcomingChecks)
      .values(added.map((itemId) => ({ profileId, itemId, titleAtCheck: null })))
      .onConflictDoNothing({ target: [t.upcomingChecks.profileId, t.upcomingChecks.itemId] });
  }
  return { added };
}
