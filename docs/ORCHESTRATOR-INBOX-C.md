# INBOX-C — C 轨（性能 / 缓存）任务队列

Cowork 写这里，Claude Code 读这里并执行，进度和汇报写回 `docs/STATUS-C.md`。
Teddy 不在中间转述。

## ⏱ 常设规则

**每 5 分钟往 `docs/STATUS-C.md` 追加一段中间进度**（做了什么 / 卡在哪 / 有无报错）。
沉默 5 分钟 = Cowork 判定进程死亡。宁可写「还在跑，无新进展」。

## 🔒 仓库独占

A 轨（P1-2b）与 B 轨（B-15-fix）均已收工。**本轮仓库写操作只有 C 轨一个 session**，
P1-6 真机验收推迟到 C 轨部署完成之后，避免 git 争用。

---

# 🔴 现在做什么

**更新于 2026-09-05 15:10 UTC（Cowork）· C 轨启动：ISR + 媒体缓存**

## 背景（已实测，不用重新考据）

区域已经归位（`x-vercel-id: iad1::sin1::…`，函数在新加坡，和 Neon 同区），但线上依然很慢：

| 实测 | 现状 |
|---|---|
| 首页 TTFB | 12.7s（冷）/ ~4s（热） |
| /memory TTFB | 4.4s |
| 首图 `/api/media` | ~5.9s |
| 所有页面响应头 | `cache-control: private, no-cache, no-store` + `x-vercel-cache: MISS` |
| `/api/health` | 404 |

根因**不是**图片多、动画重、bundle 大，是两条：

1. `app/page.tsx`、`app/about/page.tsx`、`app/memory/page.tsx`、`app/memory/[year]/page.tsx`、
   `app/memory/[year]/[month]/page.tsx` 全部 `export const dynamic = "force-dynamic"`
   → 每个访客每次点击都重新启函数、连 Neon、查库、渲染。
2. `app/api/media/[id]/route.ts` **每张图片都调用 `getStore()`**（全量读取层），
   然后才去 R2 取一个文件；且只返回 `Cache-Control: private, max-age=60`
   → 每张照片都跑一遍数据库全量读取，且 CDN 完全缓存不了。第 2 条是首图 6 秒的主因，比缓存头更严重。

---

## C-1 · 公开阅读页改 ISR

**目标**：公开页第二次访问由 CDN 直接给，不再每次进函数查库。

- 删除这 5 个文件的 `export const dynamic = "force-dynamic"`，改成 `export const revalidate = 300`：
  `app/page.tsx` / `app/about/page.tsx` / `app/memory/page.tsx` /
  `app/memory/[year]/page.tsx` / `app/memory/[year]/[month]/page.tsx`
- **`app/inbox/page.tsx`（审阅台）保持 `force-dynamic` 不动**——它要看实时待审内容。
- 排查并清掉公共读取路径上的隐性动态源：`cookies()`、`headers()`、`connection()`、
  `unstable_noStore()`、`fetch(..., { cache: "no-store" })`。如果读取层里有，
  在**页面能静态化的前提下**移除；移不动的写进 STATUS-C.md 说明原因，不要硬拆。
- 提供一条主动刷新通道：`app/api/internal/revalidate/route.ts`，
  用现有 internal 路由同款的 secret 校验（照 `app/api/internal/` 下已有写法，不要自创鉴权），
  接收 path 列表调用 `revalidatePath`。本地 worker / organizer 写完可以打这个接口，
  这样 5 分钟窗口不会让家人看到旧内容。

## C-2 · `/api/media/[id]` 去 getStore + 长缓存（本轮收益最大的一刀）

- 把 `getStore()` 全量读取换成**按 id 的单条查询**：只取这一个 media 及其
  `media_locations` 对应 variant 的记录（一次 SQL，走已有 drizzle 客户端，不要新开连接池）。
  可见性判断（`visibility === "private"` 返回 404）、
  「只允许 hot 且非 original 且 providerRef 以 media/ 开头」这些安全约束**一条都不能少**。
- 响应头改成：`Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable`。
  URL 是 `/api/media/<id>?variant=<v>`，id 与 variant 决定内容，内容不会变，可以长缓存。
- 加 `ETag`（用 mediaAssetId+variant 或已有 sha 前缀）并支持 `If-None-Match` 返回 304，成本很低。
- 404 分支不要带长缓存头（用 `no-store` 或短 max-age），否则「还没生成好」的图会被 CDN 钉死。

## C-3 · 恢复 `/api/health`

线上 404。恢复一个最小健康检查：返回 DB 连通性 + 关键表计数或 ok 标记，`no-store`。
这是 Cowork 后续巡检用的探针。

---

## 硬边界

- 不改数据库 schema，不改 organizer / worthiness / 判官逻辑，不动展示语义。
- 不改照片筛选规则（`isPortraitOfZhangnian`、quark-only 等 B 轨刚定的东西一行不碰）。
- 不引入登录、middleware、edge runtime 改造，不换图片托管方案（R2 自定义域名这一步这轮不做）。
- 不做 bundle 分析、字体调优、动画删减——这轮不解决这些。
- 生产部署前跑 `npm run typecheck`（或 build）通过再 push。

## 验收（Cowork 会亲自复验，通不过就退回）

1. 部署后，对 `/`、`/memory`、`/memory/2026/07`、`/about` 各请求两次：
   第二次必须 `x-vercel-cache: HIT | STALE | PRERENDER`，**不能再出现 `no-store`**。
2. 复用访问 TTFB：首页、/memory、/about **< 1s**。
3. 首图 `/api/media/...` TTFB **< 1s**，响应头含 `public` 且 `max-age` 为一年。
4. `/api/health` 返回 200。
5. **内容不许退化**：Cowork 会用浏览器实际打开首页、/memory、2026-07 月页、/about，
   照片数量、事件条数、月度回顾分点、人像 portrait 必须和现在一致。
   缓存改造把内容改少了 = 不合格。

## 不可接受

- 把 `/inbox` 审阅台也缓存掉。
- 为了让页面静态化而减少查询内容、少显示照片或事件。
- 只改缓存头、不动 `/api/media` 里的 `getStore()`（那样图片还是 5 秒）。
- 报告「测试通过 / 本地很快」当作完成——验收看线上响应头和真实秒数。

## 完成后

写正式汇报到 `docs/STATUS-C.md`，三段式：
1. 线上多了什么（附自己实测的 header 和秒数）
2. 没做到什么
3. 下一件事

然后停下等 Cowork 验收，不要顺手开始别的任务。
