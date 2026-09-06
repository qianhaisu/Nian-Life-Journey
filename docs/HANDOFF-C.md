# C 轨交接稿（覆盖写，每次收尾更新）

> 最后更新：2026-09-06 00:1x UTC · by Cowork（首次建档）
> 一个刚清空上下文的 Session 只读这一份就能接着干。长度保持 100 行以内。

---

## 1 · 我管什么

C 轨 = 性能 / 缓存轨。管渲染层的 ISR 静态化、`/api/media` 数据读取路径、健康检查探针。

**我拥有的文件**
```
app/page.tsx（revalidate 改动）
app/about/page.tsx（revalidate 改动）
app/memory/page.tsx（revalidate 改动）
app/memory/[year]/page.tsx（revalidate + generateStaticParams）
app/memory/[year]/[month]/page.tsx（revalidate + generateStaticParams）
app/api/media/[id]/route.ts（去 getStore，单条查询，长缓存头）
app/api/internal/revalidate/route.ts（主动刷新通道，Bearer token 鉴权）
app/api/health/route.ts（DB 连通性 + 计数探针）
docs/ORCHESTRATOR-INBOX-C.md
docs/STATUS-C.md
docs/HANDOFF-C.md（本文）
```

**不要碰**
```
v2/lib/organizer/**   v2/lib/db/**   v2/scripts/**
v2/.env.local
v2/components/**      v2/app/inbox/**
docs/ORCHESTRATOR-INBOX.md   docs/STATUS.md   docs/HANDOFF-A.md
docs/ORCHESTRATOR-INBOX-B.md docs/STATUS-B.md docs/HANDOFF-B.md
```

---

## 2 · 现在做到哪

**C-1 ~ C-4 全部验收通过（2026-09-05 15:56 UTC，Cowork 亲自复验）。**

| 任务 | 内容 | 状态 |
|---|---|---|
| C-1 | 公开页改 ISR（revalidate=300，删 force-dynamic） | ✅ commit bd63bb7 |
| C-2 | /api/media 去 getStore + 长缓存头 + ETag/304 | ✅ commit bd63bb7 |
| C-3 | /api/health 恢复（200 + DB 计数） | ✅ commit bd63bb7 |
| C-4 | generateStaticParams 让年/月页真正走 ISR | ✅ commit f455125 |

**Cowork 2026-09-06 独立复验结果**（库数字 + 浏览器，双重验证）：
- `/` HIT，age=26s；`/memory` STALE；`/memory/2026` STALE；`/memory/2026/08` STALE；`/about` STALE
- 手机 375px：首页显示 8 月真实事件（粥粥、ball、毕业庆典），月度回顾分点完整
- 桌面：51 张夸克图，内容无退化
- `/memory/2026/09`：2 个事件日期可见（粥粥、画画涂脸），页面正常渲染
- `/memory` 卡片：27 个月份引用，114 张夸克图
- `/about`：17 张夸克人像，内容完整

---

## 3 · 下一件事

**暂无 ready 任务。** C 轨这轮结案，入箱无新任务。

可以 /clear。如果 Cowork 派新任务会写进 `docs/ORCHESTRATOR-INBOX-C.md`。

已知的潜在后续工作（不主动做，等 Cowork 派单）：
- `/api/media?variant=web` 夸克大图仍需 5-7s（已绕开用 thumbnail，但 web 变体本身还没优化）
- R2 自定义域名直出（这轮明确不做）
- 未来新月份 generateStaticParams 自动覆盖（on-demand ISR 已接住，无需手动枚举）

---

## 4 · 不要再踩的坑

1. **ISR 页看到的可能是 5 分钟以内的缓存**：`x-vercel-cache: STALE` + `age` 大 = 看的是旧缓存，不是当前构建。判断改动是否生效要先看 CSS hash 有没有变，不要只看内容。
2. **本地 build ≠ 线上部署**：`npm run build` 显示 `● SSG` 只说明本地路由表变了；线上要看 Vercel 部署日志 + 实际请求的 `x-vercel-cache`。
3. **`generateStaticParams` 要从库查真实数据**：不要硬编码年份，未来月份靠 on-demand ISR 接住，不要提前枚举。
4. **`/api/media` 的 404 分支不能带长缓存头**：还没生成好的图被 CDN 钉死会永远 404，用 `no-store` 或短 max-age。
5. **`/inbox` 审阅台必须保持 `force-dynamic`**：它要看实时待审内容，不能缓存。
6. **`git add -A` 会混入 ~251 个 CRLF 假改动**——只 add 自己改过的文件。
7. **0 字节超过 30 秒的 `.git/objects/maintenance.lock` 是僵尸锁**，不挡 add/commit，可以忽略（那个锁用 index.lock，现在不存在）。

---

## 5 · 我不能单方面做的

- 改 organizer 判断逻辑、schema、照片筛选规则（B/A 轨领土）
- 改 `/inbox` 审阅台的缓存行为（审阅台必须实时）
- 引入登录、edge runtime、middleware 改造
- 改图片托管方案（R2 自定义域名这轮不做）
- 调用会产生费用的外部 API
- force push 或删除分支

---

=== C 轨已到收尾节点，可以 /clear ===
