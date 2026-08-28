# Nian Life Journey V2 架构方案

**状态：Mock UI 产品验证阶段，不接真实数据库、认证或导入服务**
**基准：V1.3，2026-08**  
**目标：建立可维护 5-10 年的“张年人生档案”**

## 1. 产品核心

V2 不是儿童个人主页，也不是成长 Dashboard。它是一部会持续长大的家庭摄影书：把散落在照片、视频、微信、老师记录、成长观察和照护资料里的生活，慢慢整理成多年以后仍然愿意重读的记忆。

用户看到的是人生，系统内部才是数据。V1 `index.html` 和 `assets/` 保持原样；V2 在 `v2/` 中拥有独立的页面、组件和 Mock 数据边界。

## 2. 三层产品模型

```text
RAW       人生原材料
  ↓
MEMORY    整理后的记忆
  ↓
STORY     长期人生叙事
```

```text
照片 / 视频 / 微信 / 老师记录 / 医院资料 / 家庭文字
                         ↓
                   Memory Inbox
                         ↓
                     LifeEvent
                         ↓
       Timeline · Month · Year · Growth · Care
                         ↓
                   Search / AI（未来）
```

### RAW：人生原材料

刚进入系统的内容不需要立刻成为完整的 `LifeEvent`。它们先留在 `Memory Inbox`，保留来源、原始时间、作者和可见性，等待家庭成员判断：忽略、稍后查看、加入已有记忆，或整理成一条新记忆。

### MEMORY：整理后的记忆

`LifeEvent` 是一个已经被家庭选择和整理过的生活片段。它有日期、地点、人物、标题、故事、标签、媒体和成长关联，但仍保留它由哪些 RawSource 支撑。

### STORY：长期人生叙事

Story 不是把原文拼起来，而是多年以后家庭愿意怎样记住这一刻。它可以被 Timeline、月度回顾和年度 Archive 重新阅读。未来 AI 只能帮助整理、连接和总结候选内容，不能创造事实。

## 3. Memory Inbox

`/inbox` 是受保护的家庭整理入口，不是企业后台。当前只用合成 Mock Data 验证体验，不实现认证或真实导入。

- Source 是主体，按“来源 + 时间”自然展开，不使用数据表格。
- 同一来源的一组照片、老师文字或聊天会一起出现，保留原始上下文。
- 操作包括“整理成记忆”“加入已有记忆”“创建一条记忆”“暂时不处理”。当前操作只改变页面内的 Mock 状态。
- 页面可以展示一段“候选记忆”，验证未来聚合体验，但本轮不实现 AI clustering。
- 原材料默认 `family` 或 `private`，在整理完成前不会自动出现在 Timeline。

## 4. TypeScript 数据模型

第一阶段只在 `v2/lib/types.ts` 中预留模型，不创建真实业务表。模型保持少量、明确的实体，不预先拆出标签、人物、地点、审核、AI 任务等二十多张表。

### `RawSource`

它是 RAW 层的统一来源记录，也是 Story 的 Evidence 入口：

- `id`、`profileId`
- `sourceType`：`family_photo`、`family_video`、`daycare_photo`、`daycare_note`、`wechat`、`parent_note`、`medical_document`、`growth_measurement`
- `capturedAt`、`importedAt`
- 可选 `text`、`mediaIds`
- `sourceLabel`、`authorLabel`
- `visibility`：`private`、`family`、`public`
- `status`：`inbox`、`reviewed`、`attached`、`ignored`
- 可选 `relatedLifeEventId`

`status` 描述整理进度，不代表公开状态。`relatedLifeEventId` 只在它已经附着到某条 LifeEvent 后出现。

### `LifeEvent`

它是 MEMORY 层的主实体，保留 `sourceIds` 和 `mediaIds`，从而能同时表达“故事”和“故事由什么支撑”：

- `title`、`story`、可选 `storySections`
- `occurredAt`、`locationLabel`、`people`、`tags`
- `sourceIds`、`mediaIds`、`heroMediaId`
- `memoryWeight`：`feature`、`memory`、`daily_trace`
- `scopes`：`family`、`daycare`、`outing`、`growth`
- `growthRecordIds`、`careRecordIds`
- `eventType`、`visibility`

详情页分成两层：

1. **Story Layer**：日期、地点、标题、Hero Media、家庭故事、人物、标签和相关成长变化。
2. **Evidence Layer**：标题为“那天留下的东西”，按时间展示照片、视频、微信和家庭备注。故事表达多年以后如何记住它，Evidence 表达当时真正留下了什么。

### 其他最小实体

- `Media`：照片/视频元数据，可在尚未附着到 LifeEvent 时只关联 RawSource。
- `GrowthRecord`：身高体重和语言、运动、兴趣等观察；可选关联 LifeEvent。
- `CareRecord`：健康、睡眠、饮食和儿保等照护观察；默认私密，不在 Home 或公开 Timeline 泄露健康详情。
- `DailyTrace`：普通一天的几件小事，不强迫写成完整故事卡。
- `CandidateMemory`：未来聚合能力的 Mock 表现，只保存候选来源和家庭确认状态。
- `MonthlySnapshot`、`MonthArchive`、`YearArchive`：月度和年度回顾索引，不复制或覆盖历史记录。

## 5. Timeline：人生的主阅读入口

Timeline 不把所有事件做成平权日志，而是让记忆有重量：

- **Feature Memory**：旅行、生日、第一次或明显变化。大图、大标题、更多故事和更大的垂直空间。
- **Memory**：普通但值得保留的 LifeEvent，使用中等视觉权重。
- **Daily Trace**：普通一天的几条记录，使用轻量文字流，不生成完整故事卡。

Timeline 只提供克制的来源视角：`全部`、`家里`、`托班`、`出游`、`成长`。筛选不是数据管理功能，而是让家庭重新看到“托班生活”“一起出游的日子”或“这一年的成长变化”。

## 6. Archive、Growth、Care

### Archive

`/archive` 是 Month / Year 的回顾入口。当前只展示 2026 年的 August Mock：主照片、月度一句话、值得记住的时刻、照片/视频数量和几个线索。它不是统计系统，而是“重新阅读这个月”的入口。未来每一年是一册家庭摄影年鉴，历史月与历史年不可被覆盖。

### Growth

Growth 不建立一套割裂于 Timeline 的健康 Dashboard。它回答“他正在成为谁”，把语言、运动、兴趣和第一次发生的事沿时间串起来；每个节点可以回到关联的 LifeEvent、Photo、Video 或 RawSource。身高体重只是时间中的小注脚。

### Care

Care 是从照护角度重新阅读一段时间的 **Episode Timeline**，例如“开始流鼻涕 → 症状变化 → 睡眠受到影响 → 医院检查 → 状态改善”。健康记录默认 `private`，本轮只保留类型、Mock 数据和架构边界，不实现完整 Care 页面。

## 7. 隐私与历史

1. 儿童照片、视频、家庭信息和健康内容默认私密。
2. `public` 必须由被授权的家庭成员显式设置；客户端不能自行改变 visibility。
3. Home 和公开 Timeline 不加载健康详情；受保护页面也只能在真实服务端授权后读取私密内容。
4. 原始来源、媒体、测量和事件不被静默覆盖。更正应保留历史关系，并在未来由服务端记录操作者和时间。
5. V1 文件和媒体永远不作为 V2 的真实导入源；本轮所有数据都是合成 Mock。

## 8. Now / Later / Out of Scope

### Now：本轮验证

- Next.js App Router、React、TypeScript、Tailwind CSS。
- `/` Home、`/timeline`、`/events/[id]`、`/inbox`、`/archive` 的 Mock UI。
- `RawSource`、Story/Evidence、记忆重量、来源筛选、Daily Trace、候选记忆和 2026 Archive。
- 移动端优先、桌面端编辑型布局、家庭可见性文案和可访问的基本交互。

### Later：真实产品阶段

- PostgreSQL、Drizzle、认证和服务端 visibility policy。
- 受控 object storage、媒体授权、poster、字幕和可回滚的媒体绑定。
- 真实导入流程、来源确认、修订历史、审计和家庭成员权限。
- 搜索、年度浏览、Episode Timeline、候选聚合和 AI 辅助整理。

### Out of Scope：本轮明确不做

- PostgreSQL、Drizzle、认证、真实文件上传、微信/托班自动导入。
- AI API、OCR、视频处理、自动 clustering、数据同步和真实医疗数据导入。
- 复杂统计、管理后台、RBAC、发布审批平台和公开发布工作流。

## 9. 目录与交付边界

```text
.
├── index.html                     # V1，保持不改
├── assets/images/                 # V1 媒体，保持不改
├── docs/
│   └── v2-architecture.md
└── v2/
    ├── app/
    │   ├── page.tsx               # Home
    │   ├── timeline/page.tsx
    │   ├── events/[id]/page.tsx
    │   ├── inbox/page.tsx
    │   ├── archive/page.tsx
    │   └── globals.css
    ├── components/
    ├── lib/
    │   ├── types.ts
    │   └── mock-data.ts
    └── public/images/              # V2 受控 Mock 媒体
```

交付前检查：运行 `npm run lint`、`npm run build`，检查所有路由的移动端与桌面端渲染、图片 alt、浏览器 console、健康信息边界和 Timeline 是否仍然是产品中心。真实部署仍需从当前 `main` 创建功能分支、Preview 验证和指定家庭成员确认；本轮不执行真实部署。

## 10. AI 预留原则

未来 AI 的职责是帮助家庭整理、连接和总结：从 RawSource 提议候选记忆、把相关来源连到 LifeEvent、生成月度总结初稿或辅助搜索。AI 不能创造日期、人物、测量、健康状态、媒体来源或公开权限；所有候选结果都要经过家庭成员确认，且默认不向第三方发送儿童原图、健康详情或家庭身份信息。
