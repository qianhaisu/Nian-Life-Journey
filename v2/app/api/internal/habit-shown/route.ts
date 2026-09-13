import { reportHabitDisplay } from "@/lib/home-feed";

// 习惯提醒的露出上报（§6.3「最多两个不同自然日露出」）。
//
// 这条路由只做两件事：**校验请求格式**，然后把判断和写入整个交给数据轨的
// `reportHabitDisplay({ claimedItemIds })`（home-feed/1.5.0）。
//
// 页面这一侧不再自己判「哪几条算数」，也不直接写库：那条规则（此刻真的在默认位上、且本身是
// 习惯类）在数据轨，页面重判一次，两边迟早分叉，而分叉的后果是把不该计数的条目记进配额。
// 日期也不由调用方给——服务端用自己的时钟，跨日界的旧 feed 会被整次拒掉。
//
// 浏览器说的话只能**收窄**：`claimedItemIds` 传进去之后，服务端仍然按自己算出来的可计数集合
// 取交集，浏览器加不进一条记录。
//
// 为什么记录的时机在浏览器、不在 SSR：一次 GET 不等于一次露出。预热、健康检查、截图脚本都会
// 发 GET，而配额只有两个自然日——记错一次，家人一次都没看见这条提醒就再也看不到它了。
// 真正触发这个请求的条件是「那块提醒进了可见视口 + 页面在前台」，见
// components/habit-shown-reporter.tsx；折叠在「还记着的其他事」里的一条都不会上报。
//
// 没有 token：调用者就是打开首页的家人。最坏情况也只是把他打开首页时本来就会记的那一行提前
// 写一次，而且唯一键按自然日去重（lib/db/habit-display-store.ts）。
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const raw = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(raw)) return Response.json({ recorded: [], skipped: "请求体里没有 ids 数组" }, { status: 400 });
  // 格式校验到此为止：非空字符串、去重、最多 8 条（默认位最多两条，8 是给未来留的余量）。
  const asked = [...new Set(raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0))].slice(0, 8);
  if (asked.length === 0) return Response.json({ recorded: [], skipped: "ids 里没有一条可用的事项" }, { status: 400 });

  const report = await reportHabitDisplay({ claimedItemIds: asked });
  // 一行可核对的记录：哪天、记了哪几条、拒了哪几条。id 是库里的主键，不是家人的原话。
  console.log(`[habit-shown] day=${report.day} recorded=${report.recorded.join(",") || "-"} rejected=${report.rejected.map((item) => item.id).join(",") || "-"}${report.skipped ? ` skipped=${report.skipped}` : ""}`);
  return Response.json(report);
}
