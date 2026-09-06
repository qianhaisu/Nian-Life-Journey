# INBOX-C — C 轨（性能 / 缓存）任务队列

Cowork 写这里，Claude Code 读这里并执行，进度和汇报写回 `docs/STATUS-C.md`。
Teddy 不在中间转述。

## ⏱ 常设规则

**每 5 分钟往 `docs/STATUS-C.md` 追加一段中间进度**（做了什么 / 卡在哪 / 有无报错）。
沉默 5 分钟 = Cowork 判定进程死亡。宁可写「还在跑，无新进展」。

## 🔒 三轨并行（2026-09-06 更新——上一版写的「仓库独占」已作废）

今天 A / B / C 三条轨**同时在跑**，靠文件所有权分区，不是独占。
**你只动 `app/api/media/**`、图片交付链路和缓存头。** B 轨今天在改 `v2/components/**` 和
`app/**/page.tsx` 的排版，A 轨在改 `v2/lib/**` 和 `v2/scripts/**`——那些今天一行都别碰。
commit 只 `git add` 自己改的文件。

---

# 🔴 现在做什么（这块永远在最顶上，Cowork 每次派单更新这里）

> ### ⏱ 常设规则（2026-09-06 加）：每 5 分钟回读一次本文件顶部
>
> 你已经有「每 5 分钟往 STATUS 写中间进度」的规矩。**在同一个节拍上，先 `head -60` 本文件**，
> 看顶部有没有新的带 UTC 时间戳的指令块。**有新指令 → 先处理指令，再回原任务。**
>
> 原因：Cowork 在云端，跟你之间**没有推送通道**，改仓库文件是它唯一能叫到你的方式。
> 你不回读，指令就永远送不到。今天已经真实发生过一次：Cowork 02:15 写的更正，
> B 轨到 03:00 才通过 Teddy 转达才知道，中间白等了 45 分钟部署。
> **越是在等待 / 轮询 / 卡住的时候越要回读**——那正是它最可能在叫你换方向的时刻。


## ✅ 2026-09-06 03:00 UTC · 更正：你的部署也上线了，是验证方法用错了

**我上一条让你「别等部署」的前提是错的，更正一下。** Teddy 给了 Vercel Deployments 截图：
你的 `2aaced6`（perf(media): stream /api/media response）**状态 Ready、Production、8m11s 构建完成**，
47 分钟前就上线了。没有失败、没有卡住。

**你判断「没部署」的依据是「production 内容跟 push 前逐字节相同」——这个判据对你这个改动不成立。**
C-5 改的是 `/api/media/[id]` 的**响应流式化**（`HotStorage.getStream()`），
它不改任何页面 HTML。页面字节相同是**预期结果**，不是没部署的证据。

**你现在直接做线上验收**（东西早就在线上了）：

1. `/api/media/<某张夸克图>?variant=web` 和 `?variant=thumbnail` 各测 TTFB 和总耗时，
   **冷缓存（第一次请求某张图）和热缓存各测一遍**——你自己诊断的根因就是 CDN MISS 惩罚，
   验收要能看出流式化把冷路径的首字节时间压下来了。
2. 响应头确认 `Content-Length`（你用 DB 里的 fileSize 填的）、缓存头、以及是否还有
   `Transfer-Encoding: chunked` 之类的差异。
3. 数字写进 `docs/STATUS-C.md`，跟你 push 前的基线对比。

C-5 的另一半交付（给 B 轨的 variant/尺寸结论）我已经验收过了，写得很清楚，thumbnail 48.9KB
vs web 304.8KB 这个实测对比很有用。

---

## 🛑 2026-09-06 02:45 UTC · 部署没落地不是你的问题，改本地验证

你在 `69f85bc` 里写「production verification blocked on Vercel deploy not landing」——
我从云端独立实测确认了：线上三个月页跑的还是旧构建（B-17 和你的改动都没上线），
Vercel 侧我够不到，已上报 Teddy 去看控制台。**别空等。**

**你现在做这两件：**

1. **本地验证 C-5**：`npm run build && npm run start`，本地实测
   `/memory/2025/12`、`/memory/2026/08` 的首屏秒数和 `/api/media/...` 的 TTFB。
   本地数字不能替代线上验收，但能证明改动本身有效；线上数字等部署恢复后我来实测。
2. **把 B 轨要的结论先交付**——这是 C-5 的交付物之一，**不依赖部署**：
   在 `docs/STATUS-C.md` 写清楚月页正文图片该用哪个 variant、哪些尺寸档位、要不要 priority。
   B 轨正在本地做 B-17 的验证，**它现在就需要这条结论**，不要等线上验完再写。

---

**更新于 2026-09-06 01:50 UTC（Cowork）· P2 开工 · 现在做 C-5：图片交付性能**

C-1~C-4 全部结案。**今天进 P2**，主题一句话：**让苏静能把 2025 年从头翻到尾**。
今天三条轨并行：A-6（痕迹层数据）· B-17（月章节三层排版）· **C-5（本文，图片交付性能）**。

**只看下面的 `## C-5`。**

---

## C-5 · 图片交付性能：为 B-17 的图文交错铺路 — status: **ready，现在做**

**为什么现在做（这是今天唯一的跨轨硬依赖）**

B 轨今天做 B-17：把月章节改成图文交错，**照片从折叠档案搬进正文时间流**。
做完之后每个月页正文的图片数量会从个位数涨到几十张——2025-12 这个月有 359 张照片，
2026-08 有 664 张。现在的图片链路撑不住这个量：你自己在 `docs/HANDOFF-C.md` 里记着
「`/api/media?variant=web` 夸克大图仍需 5-7s（已绕开用 thumbnail，但 web 变体本身还没优化）」。

**B-17 上线前 C-5 必须落地**，否则 B 一上线就是慢页面，验收会直接退回。

**目标**

让一个正文里有几十张照片的月页，在手机上仍然能顺畅翻。三件事：

1. **`variant=web` 5-7s 的根因解决**（转码 / 缓存 / 尺寸档位，怎么做你判断）。
2. **正文图片加载策略**：首屏之外懒加载、合理的尺寸档位与 `sizes`，
   不要一次性打几十个大请求把连接池和 CDN 打满。
3. **给 B 轨一个能直接照抄的结论**，写进 `docs/STATUS-C.md`：
   **月页正文图片该用哪个 variant、哪些尺寸档位、要不要 priority**。B-17 会照着这条结论调。
   这条结论是本任务的交付物之一，不是附带说明。

**硬边界**

1. 只动 `app/api/media/**`、图片交付链路、缓存头、以及必要的图片工具函数。
   **不碰 `v2/components/**`、`app/**/page.tsx`**（B 轨今天在改，会撞车）。
2. 不改照片筛选规则（`isPortraitOfZhangnian` 等）、不改 organizer、不改 schema。
3. `/inbox` 审阅台保持 `force-dynamic`。
4. 不换图片托管方案（R2 自定义域名这轮仍然不做）。
5. 404 分支不能带长缓存头（还没生成好的图被 CDN 钉死会永远 404）。
6. 上线前 typecheck / build 通过；`git add` 只加自己的文件。

**验收（Cowork 实测线上，通不过退回）**

1. `/memory/2025/12` 与 `/memory/2026/08`：手机首屏 **≤3 秒**（P1-5 定的标准）。
2. 正文里任意一张图片 `/api/media/...` **TTFB < 1s**，响应头带长缓存（`public`、长 `max-age`）。
3. 连续两次请求月页，`x-vercel-cache` 命中，不退回 `no-store`。
4. `docs/STATUS-C.md` 里给出 B 轨可直接照抄的 variant / 尺寸 / 懒加载结论。

**不可接受**

- 为了变快把画质降到肉眼能看出来。
- 只报「本地很快」——验收看线上响应头和真实秒数。
- 越界改 B 轨的排版文件或 A 轨的管线文件。

---

## ⛏ 2026-09-05 15:37 UTC（Cowork）· 解锁：你等的那把锁不存在，直接干

你报告「在等另一个 session 的 git lock」。我刚在仓库里实查（15:36 UTC）：

```
find .git -maxdepth 2 -name "*.lock"
→ .git/objects/maintenance.lock   size=0   mtime=Sat Sep 5 02:00:55
```

**只有这一个，0 字节，13 个半小时前的，是 git 后台 maintenance 留下的僵尸锁，不是任何 session 持有的。**
而且它锁的是 `objects/` 的后台维护，**不挡 `git add` / `git commit`**——那两个用的是 `.git/index.lock`，
现在**不存在**。我用 `GIT_INDEX_FILE=$HOME/.git-index-tmp git read-tree HEAD` 实测通过，仓库没有被锁死。

**你现在可以直接 `git add` 你自己的文件并提交。** 不用等通知，没有人会来通知你。

如果 `git add` 真的报 `Unable to create '.../.git/index.lock': File exists`：
1. 先 `git status` 看一眼那个锁的大小和时间；
2. **0 字节且超过 30 秒**的 index.lock 是僵尸锁，删掉它再继续（这条写在 CLAUDE.md 里）；
3. 别的轨确实在提交时，等 30 秒重试即可，不要停下来等人叫你。

**仓库现状（15:36 UTC）**：`origin/main` = 本地 `main` = `3e98ada`（B 轨刚推的 B-16）。
你的 `bd63bb7` 在它下面，已经在 origin 上。所以**提交前先 `git pull --rebase`**，
再 `git add` 你自己的文件（`app/memory/[year]/page.tsx`、`app/memory/[year]/[month]/page.tsx`、
`docs/STATUS-C.md`、`docs/ORCHESTRATOR-INBOX-C.md`），**绝不 `git add -A`**（仓库里 .github/ 下有约 250 个
CRLF 噪音文件，加进去会污染提交）。

**顺便**：B 轨刚在 `3e98ada` 改了 `components/photo.tsx`（给 Photo 加了显式的 fit 模式）。
它没碰你那两个月页/年页文件，rebase 不应该冲突。真冲突了就在 STATUS-C.md 写清楚冲哪，别硬解。

---

# 🔴 现在做什么

**更新于 2026-09-05 15:56 UTC（Cowork）· C-1~C-4 全部验收通过，C 轨这轮结案**

`/memory/2026/07` 和 `/memory/2026` 复验通过，连续两次请求都是 `x-vercel-cache: HIT`。
四项全部完成，入箱暂无新 ready 任务。**不用再空转找事做。**
如果要 /clear，先建一份 `docs/HANDOFF-C.md`（照 A/B 轨五段格式），现在没有，一清就没人接得上。

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
