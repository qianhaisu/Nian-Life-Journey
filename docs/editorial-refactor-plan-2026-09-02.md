# Nianlife 编辑式重构 · Implementation Plan（2026-09-02）

依据：[`nianlife-product-aesthetic-ia-audit-2026-09-02.md`](nianlife-product-aesthetic-ia-audit-2026-09-02.md)。本文件是实施级计划，不重复审查论证。

## Phase 0 · Reality Check（2026-09-02，`origin/main` = `a149cf6`）

- 工作区干净，单一 worktree 在 `main`，与 `origin/main` 一致。存在一个不属于本任务的 stash（`wip: pre-organizer-branch-switch`），不动。
- 线上 V2 已部署在根路径（`next.config.ts` 无 `basePath`；`CLAUDE.md` 中 `basePath: "/v2"` 的描述已过时）。`nianlife.cn` 与 `www.nianlife.cn` 均 200，无互跳、无 canonical；`/robots.txt` 404；`/inbox`、`/capture` 公开可达；404 为 Next 英文默认页；所有页面 `<title>` 相同。
- 线上数据形态（只读观察 `/memory` HTML）：3 段 LifeEvent + 33 条 DailyTrace；约 1000 条 Media，其中 925 条 alt 为 `WeChat image`，绝大多数是竖图（1080×1920 / 1280×1708 / 1180×2556）；`/memory` 一次向客户端 Timeline 组件下发全部 media（HTML 约 1 MB）。
- 本地默认 `REPOSITORY_BACKEND=json`，内容为 mock 种子（12 事件 / 3 痕迹 / 42 媒体，全部横图）。本地不能代表线上，验证必须补 fixture。
- 代码层已核实的缺陷（存在才修）：
  - `RecentMemoryCanvas` / `Timeline` / 详情页用 `occurredAt.slice(5).replace("-", ".")` 直接切数据库字符串 → 线上出现 `08.11 00:00:00+00`。
  - 详情页日期出现两次（section-mark 与 detail-meta）；空的同行的人/地点仍渲染；`tags` 渲染 `family`；evidence-summary 计数条默认展开；逐条聊天默认展开；「继续翻看下一段生活」实际回到列表。
  - `EventHeroImage` / `.detail-lead-image` 与首页 canvas 固定 `object-fit: cover` + 横向容器，竖图被裁。
  - `about/page.tsx` 整页 import `lib/mock-data`（年龄、身高体重硬编码，`回到那一天` 指向 mock 事件 id → 404）。
  - `memory/page.tsx`、`year`、`month` 引用的 `.stream-month-divider`、`.memory-years`、`.year-months`、`.year-month-row` 在 `globals.css` 中没有任何样式（未样式化的原生列表）。
  - `archive/page.tsx` 硬编码 `redirect("/memory/2026")`。
  - 首页「一年前的今天」无条件渲染；首页/记忆页空态含上传 CTA；`RecentMemoryCanvas` 6 秒自动轮播。
  - 年鉴星标只在客户端 state。
  - 移动端底栏 4 列 + 中央凸起 `+`。
  - `MonthlyFocusGoals` 出现在首页。
  - Capture 页「最近留下」区块用 `events.slice(4, 7)`，数据少时为空壳。
  - 无 `app/not-found.tsx`、`app/robots.ts`、`metadataBase`、canonical、域名跳转。
- 基线验证：typecheck / lint / test 结果见提交前记录（Phase 0 启动时后台运行）。

## Phase 1 · Plan

### A. 产品改动（按页面）

| 页面 | 现在 | 目标 |
| --- | --- | --- |
| 全站导航 | 首页 / 记忆 / 关于张年 / ＋留下点什么；移动端 4 列含中央 `+` | 首页 / 记忆 / 张年，桌面与移动均三项等权；Capture 退出一级导航（route 与能力保留） |
| 首页 | 4 段轮播 canvas；growth 三条；月度关注目标；「这个月」+ 固定「一年前的今天」 | 「最近怎么样，张年。」→ 一段最近的记忆（一张按原比例的主图 / 标题 / ≤80 字 / 时间签名）+ 1–2 个弱切换入口；「最近长大的一点」只出现一个可信变化；「这个月」= 月份 + 当时年龄 + 3–5 张代表照片 + 摘要 + 1–3 个记忆入口；删除「一年前的今天」、月度目标、轮播、上传 CTA |
| 记忆 | 三 Tab；分类按钮行；LifeEvent 与 DailyTrace 同权平铺；星标 | 年份锚点（年份 + 当时年龄跨度）→ 月份章节（月份 + 年龄）→ 该月记忆（主角）→ 底部折叠「这个月还有 N 天留下了生活痕迹」；默认只展开最近的若干月，其余月份以章节目录形式列出并链到月页；删除筛选行、Tab、星标、每条解释文案 |
| 年 | 计数 + 未样式化月份列表 | 年度章节：年份、该年年龄跨度、每月一段（月份 + 年龄 + 代表照片 + 记忆标题），计数降为一行元数据 |
| 月 | 大数字计数 + 标题列表 | 月份章节：月份 + 当时年龄 + 摘要 + 照片序列（来自该月记忆的主图）+ 记忆列表 + 折叠的普通日子；关注目标保留在月页底部 |
| 详情 | 日期两次 / 空侧栏 / `family` / 计数条 / 逐条聊天展开 / 假「下一段」 | 三层：时间签名 + 标题；照片序列（1/3/8/20 规则、竖图不裁）+ 故事；`<details>`「当时留下的资料」默认折叠；页脚「回到记忆」 |
| 张年（/about） | Mock 儿童 Dashboard | 当前年龄 + 一张最像现在的照片 + 「最近学会 / 最近常说 / 最近喜欢」（仅当真实 GrowthRecord 存在）+ 折叠的「更深的资料」（身高体重曲线，仅当真实记录存在）。Mock 全部退出 |
| Capture / Inbox | 一级入口；空壳区块；工程术语 | 从导航移除；`noindex`；Capture 删除空壳「最近留下」区块；Inbox 保留但不在产品面 |
| 404 / robots / metadata | 英文默认；无 robots；单一 title | 品牌化中文 404；`robots.ts` 全站禁止索引（私人档案）；`metadataBase` + 每页 title；www → apex 301 |

### B. 架构改动

- **只动 presentation**：`components/*`、`app/*/page.tsx`、`globals.css`、`layout.tsx`、`not-found.tsx`、`robots.ts`、`next.config.ts`（redirects）。
- **新增只读 view-model / helper（不改 repository、不改 schema）**：
  - `lib/time-signature.ts`：日期格式化（`2026 年 8 月 14 日`）、年龄（`1 岁 7 个月`），无 stage 推断。
  - `lib/memory-chapters.ts`：把 `LifeEvent[] + DailyTrace[] + Media[]` 组织成 年 → 月 → {memories, traceDays, photos}；决定默认展开范围；为每段记忆解析主图（服务端），客户端不再接收整份 media。
  - `lib/media/presentation.ts`：alt 文案回退（`WeChat image` → 中文中性描述）、按原比例的 aspect 计算、1/3/8/20 序列切分。
- **不需要 schema**：以上全部从现有 Store 字段派生。
- **Deferred / Phase B（需要数据或 schema，本轮不做）**：生活阶段 stage、照片焦点位置、「忽然想起」的命中逻辑、年鉴星标持久化、候选审批 / Manage 空间、视频 poster、搜索、auth。

### C. 文件级影响

新增：`lib/time-signature.ts`、`lib/memory-chapters.ts`、`lib/media/presentation.ts`、`components/time-signature.tsx`、`components/editorial-memory.tsx`、`components/month-chapter.tsx`、`components/media-sequence.tsx`、`components/trace-disclosure.tsx`、`components/stage-portrait.tsx`、`app/not-found.tsx`、`app/robots.ts`、`test/time-signature.test.mjs`、`test/memory-chapters.test.mjs`、`test/media-presentation.test.mjs`。

修改：`components/site-header.tsx`、`app/layout.tsx`、`app/page.tsx`、`app/memory/page.tsx`、`app/memory/[year]/page.tsx`、`app/memory/[year]/[month]/page.tsx`、`app/events/[id]/page.tsx`、`app/about/page.tsx`、`app/capture/page.tsx`、`app/inbox/page.tsx`（仅 metadata）、`app/archive/page.tsx`、`app/globals.css`、`next.config.ts`。

删除（不再被引用后）：`components/recent-memory-canvas.tsx`、`components/timeline.tsx`、`components/event-hero-image.tsx`、`components/sleep-journey-trend.tsx`；`components/media-grid.tsx`、`life-event-card.tsx`、`growth-summary.tsx` 本来已无引用。

### D. 依赖顺序

1. `time-signature` + `media/presentation`（所有页面共用）
2. 导航 / layout / 404 / robots / metadata / redirects
3. 详情页（用到 1）
4. `memory-chapters` view-model + 记忆页 / 年 / 月
5. 首页（用到 1、4 的主图解析）
6. 张年页
7. CSS 收口：删除不再使用的选择器

### E. 与微信 Session 的并发风险

- 本轮不触碰：`lib/ingest/*`、`lib/db/*`、`lib/organizer/*`、`drizzle/*`、`scripts/*`、`app/api/*`、`app/actions.ts`、`components/memory-inbox.tsx`、`test/wechat-*`、`test/chat-import-*`、`test/organizer-*`、`test/repository-*`。
- 唯一共享触点：`lib/types.ts`（只读引用，不修改）、`lib/timeline-dates.ts`（只读引用，不修改）。
- 若微信 Session 修改 `Media.alt` 生成逻辑，与本轮的 alt 回退不冲突（回退只在 alt 为空或等于 `WeChat image` 时生效）。

### F. 数据依赖

- **现在就做（不需要完整微信数据）**：导航、404、robots、metadata、时间签名、详情页三层结构、竖图不裁、alt 回退、记忆页折叠、年/月章节、首页结构、张年页去 mock。
- **等真实数据后校准**：首页「最近」的挑选阈值、月章节代表照片的挑选、默认展开月数、年龄跨度文案密度。这些都做成纯函数并用 fixture 覆盖，以后只调参数。

### G. 验收标准

- 导航：任意页面无 Capture 入口；移动端底栏三项等权，不覆盖内容（`site-shell` 底部预留 ≥ 导航高 + safe-area + 16px）。
- 时间：任何页面不出现 `00:00:00`、`+00`、`YYYY-MM-DD` 原始串；记忆显示「2026 年 8 月 14 日 · 当时 1 岁 7 个月」。
- 首页：无自动轮播；无「一年前的今天」；无上传 CTA；growth 无记录时该 section 不渲染。
- 记忆页：默认不逐条平铺 DailyTrace；折叠文案「这个月还有 N 天留下了生活痕迹」；无筛选行、无 Tab、无星标；`/memory` 不再向客户端下发整份 media。
- 详情：日期只出现一次；无空字段骨架；无 `family`；证据默认折叠；竖图不被横向裁切；`WeChat image` 不出现在 alt。
- 张年：不 import `lib/mock-data`；无真实记录时只显示年龄与照片。
- 404 中文品牌页；`/robots.txt` 200；`www` 301 到 apex；每页 title 不同。
- fixture 覆盖：12 个月、数百条痕迹、纯文字记忆、1/3/8/20 张媒体、空月、只有痕迹的月。

### H. 验证

每阶段：`npm run typecheck`、`npm run lint`、`npm test`（完整）、`npm run build`。UI：本地 `next dev` + Playwright 截图 1440 / 1280×720 / 390×844，检查 nav、hero、竖图、纯文字记忆、记忆流、月、年、详情、底部 safe-area、长中文。合并后线上 smoke：域名跳转、robots、title、`/memory` 不含 `00:00:00`。
