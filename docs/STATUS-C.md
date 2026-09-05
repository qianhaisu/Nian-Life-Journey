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

