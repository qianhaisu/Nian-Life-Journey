# STATUS-C — C 轨（性能/缓存）汇报出箱

> Claude Code 写这里，Cowork 读这里。每 5 分钟一条中间进度。

## 2026-09-05 15:xx（Claude Code）启动

读完 INBOX-C。开始 C-1（ISR）+ C-2（/api/media 去 getStore）+ C-3（/api/health）。
先探查相关文件结构，未动代码。

## 2026-09-05 15:xx（Claude Code）进度 1

已完成代码改动（尚未 typecheck/build/部署）：
- C-1：5 个公开页 `force-dynamic` → `revalidate = 300`（`app/page.tsx`、`app/about/page.tsx`、
  `app/memory/page.tsx`、`app/memory/[year]/page.tsx`、`app/memory/[year]/[month]/page.tsx`）。
  排查过 cookies()/headers()/connection()/unstable_noStore()/no-store fetch，这几个页面和它们读取
  的 lib 里都没有，不用额外拆。`app/inbox/page.tsx` 保持 force-dynamic 未动。
- C-2：新增 `Repository.getMediaForDelivery(id)`（postgres 三次按 id/mediaAssetId 精确查询，
  json 走已加载的 store），`/api/media/[id]` 改用它替换 `getStore()`；长缓存头
  `public, max-age=31536000, s-maxage=31536000, immutable` + ETag/If-None-Match 304；404 分支
  `no-store`；hot-only / 安全约束原样保留。
接下来：C-3 `/api/health`、revalidate 接口，然后 typecheck + build。

## 2026-09-05 15:xx（Claude Code）进度 2

C-3 完成：新增 `app/api/health/route.ts`（DB 连通性 + raw_sources/media 计数，`no-store`）、
`app/api/internal/revalidate/route.ts`（同款 INGESTION_TOKEN 鉴权，接收 `{paths: string[]}` 调
`revalidatePath`）。`npm run typecheck` 通过，无错误。接下来跑 `npm run build`。

## 2026-09-05 15:xx（Claude Code）进度 3

`npm run build` 和 `npm run lint` 都通过。已 commit + push main（bd63bb7）。

**一个需要 Cowork 部署后亲自复验的点**：`/memory/[year]` 和 `/memory/[year]/[month]` 没有
`generateStaticParams`，本地 `next build` 的路由表把它们标成纯 `ƒ Dynamic`（没有 Revalidate/
Expire 列），跟 `/`、`/about`、`/memory` 这三个能在构建期就确定的静态路由不一样。这两个页面
本身没有 `cookies()/headers()/searchParams`/`force-dynamic`，理论上符合 Vercel 对「无
generateStaticParams 的动态 segment + revalidate」走 on-demand ISR 的机制（首次访问生成后按
`revalidate=300` 缓存），但我在本地 `next build` 里看不到这一点被验证——只有部署到 Vercel 后
看真实响应头才能确认。**请 Cowork 按验收清单第 1 条实测 `/memory/2026/07` 两次请求的
`x-vercel-cache`**，如果第二次仍是 MISS/no-store，说明这两个动态 segment 页面需要补
`generateStaticParams`（枚举已有年/月）才能真正 ISR，我会再补一版。

---

## 汇报（三段式）

1. **线上多了什么**：5 个公开页从「每次访客每次点击都重新查库渲染」改成 ISR
   （`revalidate=300`），`/`、`/about`、`/memory` 本地构建已确认能在构建期确定为可缓存路由；
   `/api/media/[id]` 不再每张图片都跑一次 `getStore()` 全量读取，改成按 id 精确查询 + 一年期
   公共缓存 + ETag/304，这是本轮实测最大延迟来源（原文档写的首图 ~5.9s 的主因）；新增
   `/api/health`（DB 连通性探针）和 `/api/internal/revalidate`（内容更新后主动失效缓存的通道，
   本地 worker 上线后可用）。
2. **没做到什么**：没有在真实线上环境实测 TTFB 秒数和 `x-vercel-cache` 头（这个 session 没有
   触发/等待 Vercel 部署并访问生产域名的通道）——验收清单里的秒数和响应头数字需要 Cowork 部署后
   亲自测。`/memory/[year]` 和 `/memory/[year]/[month]` 是否真正吃到 CDN 缓存尚未验证，见上面
   「需要复验的点」。内容语义（照片数量、事件条数、月度回顾、人像 portrait）一行未动，只动了
   `dynamic`/`revalidate` 导出和 `/api/media` 的数据读取路径，逻辑分支（可见性、hot-only、
   providerRef 前缀校验）原样保留。
3. **下一件事**：等 Cowork 部署验收；如果 `/memory/[year]/[month]` 第二次访问仍非
   HIT/STALE/PRERENDER，回来补 `generateStaticParams`。


---

## 2026-09-05 15:27 UTC（Cowork）· 验收结果：3/4 通过，1 项需要补丁

### ✅ 通过

| 检查 | 结果 |
|---|---|
| `/` 第2次 | `x-vercel-cache: HIT`，TTFB 0.44s |
| `/memory` 第2次 | `HIT`，TTFB 0.25s |
| `/about` 第2次 | `HIT`，TTFB 0.29s |
| `/api/media/...` 第2次 | `HIT`，`public, max-age=31536000, immutable`，TTFB 0.45s（原来 5.9s） |
| `/api/media/...` 304 | `If-None-Match` 命中返回 304 ✅ |
| `/api/health` | 200，`{"ok":true,"db":"connected","rawSourceCount":46742,"mediaCount":9356,"latencyMs":456}` |
| 内容对比 | 首页三段完整；`/about` portrait 照片正常；`/memory/2026/07` 19 个事件+684张照片档案完整，无退化 |

### ❌ 未通过：`/memory/[year]` 和 `/memory/[year]/[month]` 仍然完全动态

这正是你自己在「进度 3」里标注的存疑点，实测确认命中了：

```
/memory/2026     → private, no-store, MISS, TTFB 5.5-6.0s（两次都一样）
/memory/2026/07  → private, no-store, MISS, TTFB 4.2-5.9s（两次都一样）
```

`revalidate=300` 没生效，两次请求都还是走完整动态渲染。这两个恰恰是**家人实际会打开的页面**（打开某个月看照片），
不是次要页面——按 CLAUDE.md 里"苏静能不能在手机上流畅翻月页"的验收标准，这一项没修等于全白修。

## C-4 · 补 generateStaticParams，让月/年页真正走 ISR

- 在 `app/memory/[year]/page.tsx` 加 `generateStaticParams`，枚举已有年份（从 monthly_snapshots 或
  life_events 的年份去重，不要硬编码年份列表）。
- 在 `app/memory/[year]/[month]/page.tsx` 同样加 `generateStaticParams`，枚举已有的「年+月」组合。
- 两个文件保留已有 `revalidate = 300`。
- 新出现的年/月（比如下个月）在没有被 `generateStaticParams` 枚举到之前，Next 仍会走
  on-demand ISR（首次访问生成，之后缓存）——确认这条路径不报错，不要求提前枚举未来月份。
- 验收同上一轮：`/memory/2026/07` 连续两次请求，第二次必须是 `HIT/STALE/PRERENDER`，不能是 `no-store`。
- 顺手确认：`/memory/2026`（存在数据的年份）同样要通过。
- typecheck + build 通过后 push，写汇报到本文件，等 Cowork 复验。

其余三项（`/`、`/memory`、`/about`、`/api/media`、`/api/health`）已验收通过，不用再动。

## 2026-09-05 15:xx（Claude Code）C-4 完成

新增 `Repository.listArchiveMonths()`（postgres：按 profile 查 life_events.occurredAt +
daily_traces.occurredAt + media.takenAt 三列取月份去重；json：同逻辑跑在已加载的 store 上），
仅用于 build 时的 `generateStaticParams`，不在任何请求路径上。
`app/memory/[year]/page.tsx` 和 `app/memory/[year]/[month]/page.tsx` 分别加了
`generateStaticParams`（年份去重 / 年+月组合），`revalidate = 300` 保留不动。

本地 `npm run build` 验证：路由表里
`/memory/[year]` 和 `/memory/[year]/[month]` 从上一轮的纯 `ƒ Dynamic` 变成
`● SSG`，并且实际枚举出了真实数据：

```
● /memory/[year]                revalidate 5m  expire 1y
  └ /memory/2026
● /memory/[year]/[month]         revalidate 5m  expire 1y
  ├ /memory/2026/07
  └ /memory/2026/08
```

typecheck / lint / build 全部通过。未来新出现的年/月不在这个列表里时按设计走 on-demand ISR
（首次访问生成后缓存），不需要也没有硬编码年份。

即将 commit + push（只包含本轮改动的文件，不动其他 track 正在改的 docs/*.md）。
