import { mergeUpcomingChecks, readUpcomingChecks, setUpcomingCheck } from "@/lib/db/upcoming-checks-store";

// 首页「每周提醒」的勾选。
//
// GET  → { ids: string[] }            这个档案下已打勾的事项
// POST → { id, checked, title? }      打勾/取消；或 { merge: string[] } 把本机存过的勾并上来
//
// 为什么不走 SSR 顺带带下来：首页是 ISR，5 分钟一渲染。勾完刷新若还读到缓存里的旧状态，
// 家人看到的就是「又没保存」。这条路由不缓存，页面挂载后单独取一次。
//
// 没有 token：能打开首页的就是家人（当前阶段不做登录，见 CLAUDE.md「当前产品优先级」）。
// 它能改的也只有 upcoming_checks 一张表——既不能改事项内容，也不能改 status。
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ids = await readUpcomingChecks();
    return Response.json({ ids: [...ids] }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[upcoming-checks] 读失败", error);
    return Response.json({ ids: [], error: "read-failed" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { id?: unknown; checked?: unknown; title?: unknown; merge?: unknown }
    | null;
  if (!body) return Response.json({ error: "请求体不是 JSON" }, { status: 400 });

  try {
    if (Array.isArray(body.merge)) {
      const result = await mergeUpcomingChecks(body.merge.filter((id): id is string => typeof id === "string"));
      const ids = await readUpcomingChecks();
      return Response.json({ ids: [...ids], added: result.added }, { headers: { "cache-control": "no-store" } });
    }
    if (typeof body.id !== "string" || !body.id.trim() || typeof body.checked !== "boolean") {
      return Response.json({ error: "需要 { id: string, checked: boolean }" }, { status: 400 });
    }
    const title = typeof body.title === "string" ? body.title.slice(0, 200) : undefined;
    await setUpcomingCheck(body.id, body.checked, { title });
    return Response.json({ id: body.id, checked: body.checked }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[upcoming-checks] 写失败", error);
    return Response.json({ error: "write-failed" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
