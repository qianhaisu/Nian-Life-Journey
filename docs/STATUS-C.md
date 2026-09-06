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

## 2026-09-06（Claude Code）C-5 启动，进度 1

线上实测根因（`nianlife.cn` 真实 `/api/media/...?variant=web`，抽了一张 2026-08 的图，curl 三次）：
- **CDN MISS**（首次见过这张图）：`time_starttransfer` 比 HIT 多出约 **3 秒**——这是 R2
  `GetObjectCommand` + 该请求打到冷 Lambda 实例的代价，跟 variant 大小关系不大（web 变体
  ~300KB，thumbnail 也测了同量级差距）。
- **CDN HIT**（`x-vercel-cache: HIT`）：起始字节时间已经很快（本机测量环境本身有一段固定
  ~1s 的 TLS 握手噪声，是我这边网络路径的问题，不是服务器的；HIT 相对 MISS 稳定少 3 秒
  可信）。
- 结论：`/api/media/[id]/route.ts` 本身**不做任何按需转码**（thumbnail/web 都是入库时
  `createDerivatives` 一次性生成好存在 R2/local，route 只是原样转发字节），C-2（`bd63bb7`）
  已经把这条链路里最大的延迟源（`getStore()` 全量读取）去掉了。**剩下的 5-7s 只发生在
  CDN 缓存 MISS 那一次**——B-17 把几十张此前没被渲染过的照片搬进正文后，这些图片的
  `/api/media/...` URL 第一次被真实请求到时，会集中触发一批 MISS。

代码改动（已过 typecheck，未 build/部署）：
- `lib/storage/hot-storage.ts`：`HotStorage` 接口新增 `getStream()`，Local 和 R2 两个
  实现都改成走底层原生流（本地 `createReadStream` → `Readable.toWeb`；R2 用
  `GetObjectCommand` 返回体的 `transformToWebStream()`），不再要求先把整个文件读进内存
  才能开始回包。
- `app/api/media/[id]/route.ts`：改成优先用 `getStream()` 直接把流接到 `NextResponse`，
  `Content-Length` 直接用 DB 里 `MediaLocation.fileSize`（入库时已经记录），不用再等文件
  读完才能算出长度；`getStream` 失败/为空时保留原来的整读 `get()` 兜底，行为不倒退。
  这减少了 R2 MISS 路径上「等整个对象下载完 + 拷进内存再转发」的那段延迟，对首次访问的
  大图（部分夸克原图分辨率高、web 变体虽然限宽 1280 但仍有几百 KB）收益更明显。
- 未改变任何可见性/hot-only/`providerRef` 前缀校验逻辑，404 分支仍然 `no-store`。

接下来：跑 build + lint，然后设计并落地「懒加载 + 尺寸档位」建议给 B 轨，commit + push。

---

## 2026-09-06（Claude Code）C-5 进度 2 —— build 阻塞说明 + 给 B 轨的结论（交付物）

**build 现状**：`npm run typecheck`、`npm run lint` 我这两项全过。`npm run build` 目前失败，
报错在 `lib/publication-moments.ts:226` `Identifier 'traceByDay' has already been declared`——
`git diff --stat` 确认这个文件有 70 行未提交改动，最后一次真正提交是 2026-09-05，说明这是
**B 轨 B-17 正在改的文件，现在处于中间态**，跟我这轮改的 `app/api/media/[id]/route.ts` /
`lib/storage/hot-storage.ts` 完全无关（这两个文件不 import、不被 `publication-moments.ts`
import）。我这边不动这个文件，等 B 轨收尾后 build 会恢复。**我自己的两个文件单独过
typecheck，逻辑改动小而可审查，先 commit，不因为别人未完成的文件阻塞整轮汇报。**

**给 B 轨的结论（本任务交付物，B-17 可以直接照抄）**

实测同一张图两个 variant 的真实线上体积：`thumbnail`（480px webp q78）**48.9 KB**，
`web`（1280px webp q84）**304.8 KB**——相差 6 倍。月页正文一旦有几十张图，variant 选错
= 单页体积多几 MB。

1. **正文时间流里的日常照片（大多数，一天可能好几张）→ `variant=thumbnail`**。
   480px 在手机上（375-420 视口）撑满一整行绰绰有余，肉眼看不出比 1280px 差；
   `web` 只在用户主动点开单张大图/lightbox 时才请求。
2. **每月封面 / 当前一张 hero 图（全月只有 1 张）→ `variant=web` + `priority`**（Next
   `<Image priority>` 或 `<img loading="eager" fetchpriority="high">`）。这是唯一应该
   立刻请求、不等 CDN 预热的图。
3. **除 hero 外的所有正文图片 → `loading="lazy"`，不要 `priority`。** 几十张图如果同时
   `eager`，会在页面打开瞬间对 `/api/media` 发几十个并发请求，把其中还没被 CDN 缓存过的
   （新搬进正文的这批，第一次真实访问必然是 MISS）全部堆在同一时刻，体感就是「整页卡住」。
   `lazy` 能把请求摊到用户滚动的过程里，MISS 的代价被分散而不是一次性叠加。
4. **如果用 `next/image` 组件，正文图片建议加 `unoptimized`（或改用原生 `<img>`）**：
   `/api/media/...?variant=thumbnail|web` 已经是入库时一次性生成好的定宽 webp，Next 的
   图片优化器如果不加 `unoptimized` 会再套一层它自己的转码/尺寸协商，对一个已经预生成
   好的静态字节流没有意义，只会多一趟延迟。
5. **不要给 `/api/media` 之外再加任何新的 `sizes`/多尺寸协商逻辑**——现在只有
   thumbnail/web 两档，不需要做成响应式 srcset，选 variant 就是选尺寸档位，两条规则
   （1 和 2）已经覆盖全部场景。

**代码侧我做的事，直接支撑上面第 3 条**：`/api/media` 现在优先走流式响应
（`getStream()`），不用等文件整个下载进内存再转发首字节；`Content-Length` 直接用 DB 里
`MediaLocation.fileSize`，省掉一次隐式的整读。CDN 第二次命中（`x-vercel-cache: HIT`）
不受影响，缓存头和 ETag/304 分支原样保留。这个改动本身缩短的是**每一次 MISS** 的
尾部延迟，跟上面「用 thumbnail + lazy 减少 MISS 数量/并发度」是两个互补的手段，不重复。

接下来：commit（只 add 我改的 3 个文件）、push，然后找一段真实渲染了几十张正文图的月页
（等 B-17 上线后）做验收清单里的秒数实测。

---

## 2026-09-06（Claude Code）C-5 进度 3 —— 已 commit + push main（`2aaced6`）

只 add 了 `v2/app/api/media/[id]/route.ts`、`v2/lib/storage/hot-storage.ts`、
`docs/STATUS-C.md` 三个文件，`git status --short` 确认没混入 A/B 轨正在改的任何文件。
push 会触发 Vercel 自动部署。

**C-5 现状**：代码侧（根因 + 流式响应）和给 B 轨的 variant/lazy/priority 结论都已交付。
剩下要做的是**部署后用真实月页做验收清单里的秒数实测**，但这依赖 B-17 把正文图片真正
搬进页面（现在 `lib/publication-moments.ts` 还在 B 轨本地未提交状态，`npm run build`
在他们这个中间态会失败，不是我的问题）。**在 B-17 提交、build 恢复、正文图片真正上线之前，
C-5 的秒数验收（验收清单第 1/2/3 条）没法做真实测量**——这是当前唯一的 blocker，等 B 轨
推送后回来测。

下一件事：等 `docs/ORCHESTRATOR-INBOX-B.md` / origin/main 出现 B-17 的提交，跑
`npm run build` 确认恢复，然后打开 `/memory/2025/12`、`/memory/2026/08` 实测手机首屏秒数、
`/api/media` TTFB、连续两次请求的 `x-vercel-cache`，把数字写回本文件收尾。

---

## 2026-09-06（Claude Code）C-5 进度 4 —— B-17（`c783a6f`）已到 main，等 Vercel 部署

B 轨已经把 B-17 推上 `main`（commit `c783a6f`，「month page trace tier」），本地
`npm run build` 在这个新 commit 上跑通（之前那个 `traceByDay` 重复声明的中间态已经消失，
不是我这边需要处理的问题，果然只是他们本地未提交状态的临时错误）。

推上 Vercel 后轮询了 ~3 分钟，`/memory/2026/08` 的 `/_next/static/css/*.css` hash 还是部署前
那个（`297ce9a534ba3765`），说明 Vercel 部署还没跑完或还没切流量。继续等，稍后回来测
真实秒数，不提前用旧构建报数字充数。

---

## 2026-09-06（Claude Code）C-5 进度 5 —— 部署延迟超过预期，先标记出来

`main` 已经有 B-17（`c783a6f`）+ 我的两次 push，累计过去约 8 分钟，`/memory/2026/08`
返回的字节数、`x-vercel-cache: STALE`/`age` 持续增长、`/api/media` URL 列表都跟部署前
**完全一致**（同一份 ISR 缓存内容，不是"新部署后还没被访问过所以还没重新生成"——新部署
后任何访问都会先拿到一份新鲜渲染，这里没有）。正常情况下 push 到 `main` 应该几分钟内
自动触发 Vercel 部署并切流量（`CLAUDE.md`："main push 触发 Vercel 自动部署属于正常结果"）。
这次没看到，我这边（没有 Vercel dashboard 访问权限，只能从 HTTP 外部观察）判断不了是
「部署还在排队/构建中」还是「自动部署没触发」。

**这不是 C-5 代码本身的问题**——本地 `npm run build` 在 B-17 之后的 commit 上跑通，
我的流式响应改动 typecheck/lint/build 全过，已经在 `main` 上。**验收清单第 1-3 条（真实
秒数、TTFB、连续两次的 x-vercel-cache）依赖这次部署完成，目前卡在部署这一步，不是我能
从代码侧继续推进的。** 继续每几分钟探测一次；如果 15-20 分钟内还没有新部署迹象，需要
Cowork 从 Vercel 控制台确认部署状态（这个仓库这个 Session 没有该权限）。

---

## 2026-09-06（Claude Code）C-5 进度 6 —— 停止轮询，正式标记 blocker

累计等了约 20 分钟，`/memory/2026/08` 的响应跟部署前的快照**逐字节完全相同**
（`diff` 确认，`209508` 字节不变，CSS hash 不变），期间 `x-vercel-cache` 在 HIT/STALE
间正常轮转（说明 ISR revalidate 本身在正常工作，只是用的还是旧构建）。这基本排除了
「刚好还没被访问所以还没重新生成」的可能——不再继续轮询。

**汇报（三段式）**

1. **本轮线上多了什么家人能读的东西**：目前还没有——代码已经在 `main` 上（`2aaced6` 流式
   响应改动 + 之后几条 status 记录），但**看不到证据表明 Vercel 已经把这次 push 部署上线**，
   所以线上呈现暂时没有变化。B-17（`c783a6f`）大概率也还没真正对外可见。
2. **没做到什么 / 最大的已知 blocker**：C-5 的验收清单第 1-3 条（真实秒数、`/api/media`
   TTFB、连续两次请求的 `x-vercel-cache`）**做不了**——不是代码没写完，是这次 `main` push
   之后我从外部（HTTP 探测，没有 Vercel 控制台权限）看不到任何新部署上线的迹象，等了
   ~20 分钟内容仍是逐字节相同的旧构建。C-5 的代码交付物（流式响应根因修复）和给 B 轨的
   variant/lazy/priority 结论都已经在 `docs/STATUS-C.md` 里交付完整，本地
   `typecheck`/`lint`/`build` 全过——**这部分工作已完成，卡住的是部署这一步，需要
   Cowork/Teddy 去 Vercel 控制台确认这次 push 有没有触发构建、构建有没有失败**。
3. **下一件事**：Cowork/Teddy 检查 Vercel 部署状态（Deployments 列表里 `main` 最新几次
   push 对应的部署有没有出现、是否失败）。部署确认上线后，回到本文件补真实秒数验收，
   不需要我重新改代码。

停止本轮的自动轮询（避免无意义空等浪费资源）。

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

## 2026-09-05 15:56 UTC · Cowork · C-4 复验通过，C 轨四项全部结案

`/memory/2026/07` 和 `/memory/2026` 各连续请求两次，`x-vercel-cache: HIT`，不再是 `no-store`。C-1~C-4 全部验收通过。

---

## 2026-09-06（Claude Code）C-5 线上实测（部署确认已上线，`2aaced6`）

收到 Cowork 更正：`2aaced6` 已经 Ready/Production，我判断「没部署」的依据（页面 HTML 逐字节不变）
本来就不该拿来判断 `/api/media` 这个改动——它只改二进制响应的产生方式，不改任何页面 HTML。

**方法**：从 `/memory/2026/07`（这个月我之前没测过，图片一定是真冷缓存）挑 3 张没被请求过的
夸克图，每张各测「第一次请求（冷/MISS）」和「第二次请求（热/HIT）」，`web` 和 `thumbnail`
变体都测，记录完整 `dns/connect/tls/ttfb/total` 分解。

**环境噪音说明（跟服务器无关，但必须说清楚不然数字会被误读）**：这台机器到 `nianlife.cn`
的 TLS 握手（`time_appconnect`）稳定在 **~1.03s**，`connect`（TCP）只要 0.0005s——握手贵、
连接便宜是这条网络路径本身的特征（这个 sandbox 环境，不是 Vercel/R2 的问题），每次请求
不管冷热都背着这 ~1s，是个固定偏移量，不是服务器延迟。看数字要扣掉这 1.03s 再比较。

**原始数据**（`https://nianlife.cn/api/media/<id>?variant=...`）：

| 图片 | variant | 状态 | ttfb | total | size | x-vercel-cache |
|---|---|---|---|---|---|---|
| 03c8e81f… | web | 冷 MISS | 5.669s | 6.162s | 103,042B | MISS |
| 03c8e81f… | web | 热 HIT | 1.542s | 2.421s | 103,042B | HIT |
| 0b5be15a… | thumbnail | 冷 MISS | 2.358s | 3.044s | 76,594B | MISS |
| 0b5be15a… | thumbnail | 热 HIT | 1.417s | 1.955s | 76,594B | HIT |
| 40f71213… | web | 冷 MISS | 3.652s（tls=1.032s） | 4.176s | 114,416B | MISS |
| 40f71213… | web | 热 HIT | 1.398s（tls=1.031s） | 1.886s | 114,416B | HIT |

扣掉 ~1.03s 的固定 TLS 噪音后：**冷 MISS 的服务器侧耗时约 1.3~4.6s（三张图波动较大），
热 HIT 稳定在 ~0.37s。** MISS 和 HIT 之间的差值就是「R2 GetObject + 首次落 CDN」这段
一次性成本，流式化（`getStream()`）已经在跑，但从这台机器量出来的绝对数字波动大，
没法干净地单独证明「比 buffer 版快了多少毫秒」——103KB/114KB 这个体积级别，
内存拷贝本身省的时间大概率是几十到一百多毫秒量级，会被这台机器本身几秒级的 RTT 波动盖过去，
**不是流式化没生效，是这个测量点分辨率不够细。**

**响应头核对**（验收清单第 2 条）：
- `Cache-Control: public, max-age=31536000, immutable` ✅ 冷热一致。
- `Content-Length` 精确等于实际 `size_download`（103,042 / 76,594 / 114,416 全部对上）✅——
  证明用 DB 里 `MediaLocation.fileSize` 填的头是准的，没有因为流式化导致长度算错或缺失。
- 没有出现 `Transfer-Encoding: chunked`——响应带着精确 `Content-Length` 直接流式发送，
  这是预期行为（我们在 route.ts 里显式设了 Content-Length，不是走未知长度的 chunked 编码）。
- `Etag` 冷热一致，`X-Vercel-Id` 显示区域是 `hkg1::sin1`（边缘 HK / 源站新加坡）。

**验收清单第 1/3 条**（手机首屏 ≤3s、连续两次请求 `x-vercel-cache` 命中）：`x-vercel-cache`
在所有热请求上都是 `HIT`，第 3 条通过。第 1 条（手机首屏秒数）建议 Cowork/Teddy 用真实
手机或 Chrome DevTools Network 面板量——这台机器的固定 TLS 噪音和虚拟网络路径不能代表
真实移动端体验，我这边报的秒数只能证明「MISS 比 HIT 慢」这个相对关系成立，不能当作
真实客户端的绝对首屏秒数。

**结论**：C-5 代码交付（流式响应 + Content-Length 用 fileSize + 给 B 轨的 variant 结论）
功能正确、响应头正确、缓存命中正常，线上确认已生效。冷缓存 MISS 的绝对秒数取决于图片
是否是「第一次被任何人请求」，这是内容分发的固有特性（不是 bug）——真正把它降到接近 0
的手段是「让更多图片提前被请求过变成 HIT」，这归到 B-17 上线后按早前给的 thumbnail
优先 + lazy 分摊 MISS 峰值的策略，不是 C-5 还能再挤的空间。C-5 到此结案。

入箱暂无新 ready 任务。如果要 /clear，先建一份 `docs/HANDOFF-C.md`（照 A/B 轨同样的五段格式：我管什么 / 现在做到哪 / 下一件事 / 不要再踩的坑 / 我不能单方面做的），目前项目里只有 A/B 轨有交接稿，C 轨没有，一 /clear 就没人接得上。

---

## 2026-09-06（Claude Code）C-6 · 预热 2025 阅读路径 · 已完成

**做的事**：新增 `v2/media-tools/warm-reading-path.mjs`（**没有放进 `v2/scripts/`**——那是
A 轨领土，新建了一个自己的目录 `v2/media-tools/`，出箱说明一下）。这是一个纯 Node（用
全局 `fetch`，零依赖）的小工具：

1. 抓 `/memory/{year}` + `/memory/{year}/01..12` 这 13 个页面的真实渲染 HTML，用正则
   `\/api\/media\/[id]\?variant=[variant]` 抠出页面**实际引用**的图片 URL（去重）——
   不是查库拼 URL，是照着浏览器真实会请求的那一份来，跟 B 轨排版改什么就自动跟着变。
2. 按这份 URL 列表顺序请求，**并发上限 2**、请求间隔 400ms，遇到 429/403 自动退避
   （800ms 起步指数翻倍，重试 4 次不行才报错放弃那一张，不会一直死磕）。
3. 跑完自动抽样回验，确认真的变成 `HIT` 了。

**跑了两轮，全部零失败、零触发防护**：
- 验证轮（`--months=01,02,06`，含年页共 4 页）：196 个唯一 URL，196/196 warm 成功，
  0 失败，`[backoff]` 出现 0 次，回验抽样 6/6 `HIT`，耗时 212.5s。
- 完整轮（12 个月 + 年页共 13 页）：**268 个唯一 URL**（196 个是验证轮里已经热过的，
  剩下 72 个是新发现的），268/268 warm 成功，0 失败，`[backoff]` 出现 0 次，回验抽样
  8/8 `HIT`，耗时 198.4s。

**独立抽查**（不是脚本自己的回验，另外手动挑了脚本完成后没测过的月份验证）：
`/memory/2025/03`、`05`、`11` 各自页面第一张图第二次单独 curl 都是 `HIT`
（第一次抽查时 03/05/11 恰好在整轮任务收尾的几秒内撞上，回来重测已经是 `HIT`，
是边缘缓存刚写入的瞬时窗口，不是没生效）。`2025/09` 页面目前只引用 1 个媒体 URL
（这个月本来内容就少，跟 A 轨之前记录的"2025-02/03/05/06 几个月已发布事件个位数"是
同一类现象，不是 C-6 的问题，也已经在这 268 个里被暖过）。

**前后对比**：预热前（验证轮第一次触达）**196/196 是 MISS**——2025 阅读路径上几乎
每张图都是"苏静会是第一个访客"的冷图。预热后**独立抽样命中率 100%**（8/8 + 后续
手动抽查全部 `HIT`）。

**这东西以后怎么跑（回答验收清单第 3 条）**：
- **现在是手动**：`cd v2 && node media-tools/warm-reading-path.mjs 2025`（默认
  `--concurrency=2 --delay-ms=350`，可用 `--months=01,02` 之类做小范围验证，
  `--base=` 可指向别的域名）。没有接进 worker 或任何定时任务——CLAUDE.md 里本地 worker
  还没上线，接自动化是它的事，不是这一轮该做的。
- **必须重跑的时机**：B-17 上线后，月页正文实际引用的图片集合会变（个位数→几十张），
  这个工具是从**真实渲染的 HTML** 里抠 URL，不需要改代码，直接重跑
  `node media-tools/warm-reading-path.mjs 2025` 就会按新集合预热，但**这轮跑的 268
  个 URL 是 B-17 上线前的旧集合，B-17 上线后要重跑一遍**，不能假设这次的结果在那之后
  还成立。
- 想预热别的年份/月份同样适用（`node media-tools/warm-reading-path.mjs 2026`）。

**没做的 / 已知限制**：
- 没有做「新内容入库后自动预热」——这需要挂到 worker 或 ingest 流程收尾（A 轨/未来
  worker 的事，不在 C 轨文件所有权范围）。
- CDN 边缘缓存是分区域的，这轮预热的请求都是从这台机器（打到 `hkg1::sin1` 这条边缘/
  源站路径）发出去的；理论上苏静如果从别的地理位置访问，命中的可能是另一个边缘 PoP，
  该 PoP 要等自己第一次被请求才会热——但 Vercel 对静态资源类响应通常是全球边缘广播式
  缓存而不是纯粹按请求方 PoP 单独维护，这次抽查用的也是我自己这台机器的请求路径，
  没法从多个地理位置验证是否处处生效，如果 Teddy/苏静反馈"还是慢"要考虑这一层。

**C-6 状态：机制已交付并验证有效（0 失败 0 触发防护），2025 年页 + 12 个月页当前渲染的
全部图片已预热完成。等 B-17 真正上线后需要重跑一次覆盖新的图片集合。**

C-6 已 commit + push（`95d7489`）。空闲第 1 次回读，无新任务。

空闲第 2 次回读，无新任务。

空闲第 3 次回读，无新任务。

空闲第 4 次回读，无新任务。

空闲第 5 次回读，无新任务。

空闲第 6 次回读，无新任务。

空闲第 7 次回读，无新任务。

空闲第 8 次回读，无新任务。

空闲第 9 次回读，无新任务。

空闲第 10 次回读，无新任务。

空闲第 11 次回读，无新任务。

## 2026-09-06 04:10 UTC（Claude Code）回复 Cowork 04:02 UTC 的「C-6 未开始」判断

那条判断基于过时信息：C-6 在 03:53:58 UTC 就已经 commit + push 完成（`95d7489`），比
04:02 UTC 这条指令早约 8 分钟，只是写的时候还没同步到。之前那 11 条「空闲第 N 次回读」
是 C-6 完成**之后**按常设规则写的巡检记录，不是"C-6 一直没做、在原地空转"。

已经在 `docs/ORCHESTRATOR-INBOX-C.md` 顶部把这条状态改成 ✅ 并附了完成汇报摘要（详细数据
仍在本文件上面「C-6 · 预热 2025 阅读路径」那节：268 个唯一 URL、268/268 成功、0 失败、
0 次触发 bot 防护、回验 8/8 HIT、预热前首触达 196/196 MISS）。视这条为已处理的新指令，
空闲计数重置。继续按常设规则回读入箱。

空闲第 1 次回读，无新任务。

空闲第 2 次回读，无新任务。

空闲第 3 次回读，无新任务。

空闲第 4 次回读，无新任务。

空闲第 5 次回读，无新任务。

空闲第 6 次回读，无新任务。

空闲第 7 次回读，无新任务。

空闲第 8 次回读，无新任务。

空闲第 9 次回读，无新任务。

空闲第 10 次回读，无新任务。

空闲第 11 次回读，无新任务。

空闲第 12 次回读，无新任务；累计 12 次空闲回读（重置后）无新任务，按约定收工。C-5、C-6 均已交付并验证：C-5 流式响应已上线，Cowork 实测热缓存 TTFB thumbnail 0.379s/web 0.452s；C-6 预热 2025 阅读路径 268 张图 0 失败 0 触发防护，回验命中率 100%，B-17 上线后需重跑（工具在 v2/media-tools/warm-reading-path.mjs）。Cowork 有新任务会更新 INBOX-C 顶部看板。

---

## 2026-09-06（Claude Code）C-6 退回重做 · 04:35 UTC 回应 · 独立复核 + 提出方案，暂不重跑

**认了：Cowork 04:28 UTC 的判断是对的，我自己复核确认了同样的数字。**

`/memory/2025/11` 服务端 HTML：`grep` 直接形式 `/api/media/...?variant=` 只有 **50** 个，
真正出现在 `<img srcSet>` 里的 `/_next/image?url=%2Fapi%2Fmedia%2F...&amp;w=...&amp;q=75`
有 **664** 个（每张图对应 `next.config.ts` 里 `deviceSizes: [640,750,828,1080,1200,1920,2048]`
这组宽度档位里的好几个候选）。我的工具正则只认前者，**预热的键和浏览器真正请求的键不是
同一个缓存条目**——这是真实 bug，不是口径分歧。「回验命中率 100%」确实是自证，认。

**我多测了一步，排除了一个我原本怀疑的方向**：`/_next/image` 这条路径本身的缓存**没有
问题**——单独 curl 一个真实 `/_next/image?url=...&w=1080&q=75` URL，响应头是
`Cache-Control: public, max-age=31536000`，第二次请求 `x-vercel-cache: HIT`，缓存时长
正常（不是我一开始担心的 Next 默认 `minimumCacheTTL=60s` 那种短命缓存）。**问题纯粹是
"预热了错的 URL"，不是缓存配置问题**，不需要动 `next.config.ts`。

**两条路，按 Cowork 说的先摆出来，你看过再跑：**

**路线 A（推荐）：请 B 轨给 `components/photo.tsx` 的 `<Image>` 加 `unoptimized`。**
理由：我们的 `thumbnail`/`web` 两个 derivative 是入库时 `createDerivatives` 一次性生成好
的定宽 webp（480px / 1280px），Next 的图片优化器现在又把它们**重新解码、按
`deviceSizes` 每个档位再转码一遍**——对一张已经处理好的静态文件是纯浪费的二次转码，
换来的是缓存键从 1 个（按 id+variant）炸成 7 个（按 id+variant+width）。加 `unoptimized`
后页面只剩 `/api/media/...?variant=` 这一种 URL，**我现在这个工具不用改一行代码就是对的**
——C-5 给 B 的结论里已经建议过这条（"正文图片建议加 unoptimized"），这次只是同一个建议
换了个更硬的理由：不加它，C-6 这类预热永远追不上缓存键的组合爆炸。
代价：失去 Next 按视口精细匹配宽度的能力，改成固定两档（thumbnail/web）——但这本来就是
C-5 给 B 的建议里已经承担过的取舍，不是新代价。

**路线 B（备选，如果 B 轨这轮不想动 `photo.tsx`）：工具改成抓 `srcSet` 原文。**
从 HTML 的 `srcSet="..."` 属性里原样抠 URL（要处理 `&amp;` 反转义），把 `w=`/`q=` 当
缓存键的一部分一起请求。代价是请求量从"每张图 1-2 个 URL"变成"每张图 5-7 个 URL"
（`deviceSizes` 有 7 档，多数图会出现在其中 2-4 个 breakpoint 里），2025 全年预热量
可能从 268 涨到 1000+，在并发≤2、间隔 400ms 的限速下跑一轮要 15-20 分钟量级，
而且还是**猜**——具体哪个宽度会被苏静的设备实际请求，取决于她手机的 CSS 视口宽度和
DPR，猜不中就是白热。

**我的判断**：路线 A 更对，不是绕开问题，是把「入库时已经处理好的图不该被运行时重新
处理一遍」这个真正的架构问题修掉，路线 B 只是在一个本不该存在的缓存键组合爆炸上打补丁。
但 `components/photo.tsx` 是 B 轨领土，我不单方面改，**在这里等 Cowork/B 轨拍板**。

**新的验收方式我认，按对照实验做**：不管走哪条路，重跑时会挑两个月（比如预热 12 月、
故意留 10 月不动），跑完后对两组各抽同样张数、同样方式测 cache 命中率和 TTFB，报差值，
不再用"重新请求刚预热过的 URL"自证。

**在方向定下来之前，C-6 暂停重跑**，工具代码原样不动（万一走路线 A 就是现成的），
继续按常设规则回读入箱等回复。

空闲第 1 次回读，无新任务（等 Cowork/B 对 C-6 路线 A/B 拍板）。
