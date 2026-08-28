# Nian Life Journey V2 架构方案

**状态：Mock UI 产品验证阶段，不接真实数据库、认证、导入或 AI 服务**

**基准：V2 Product Architecture，2026-08**

**目标：建立可维护 5–10 年的张年数字人生档案**

## 1. 产品核心

Nian Life 不是儿童 Dashboard、家庭 CMS、相册、健康管理 App 或 AI 自动日记。它把照片、视频、聊天、老师记录、文档、成长与照护资料这些散落的真实痕迹，慢慢整理成多年以后仍愿意重读的记忆。

> 不是把张年的生活存下来，而是让这些日子以后还能回来。

```text
生活发生 → 留下东西 → AI 筛选 / 分类 / 连接 → 爸爸妈妈确认
        → 成为记忆 → 时间过去 → 再次遇见
```

用户看到的是人生，系统内部才是数据。V1 `index.html` 与 `assets/` 保持原样；V2 只在 `v2/` 与本文档中演进。

## 2. 一级产品结构

阅读入口收敛为三个：

```text
首页             记忆                   关于张年
最近             以前                   状态 / 成长 / 睡眠 / 健康
```

录入是独立主操作：

```text
＋ 留下点什么 → RawSource → 关联建议 → Memory Candidate → 人工确认 → Memory
```

- `/`：只回答“最近怎么样，张年。”
- `/memory`：连续时间流，默认从 Event / Day 尺度阅读。
- `/memory/[year]/[month]`：Month Review；不是一级 Tab。
- `/memory/[year]`：Year Review；不是一级 Tab。
- `/about`：现在的状态，以及从成长、睡眠和照护角度重新阅读历史。
- `/capture`：自然的 capture / organize Mock Flow。
- `/events/[id]`：Memory 的 Story / Evidence 双层详情。
- `/timeline`、`/archive`、`/inbox`：兼容旧链接，分别重定向到新结构。

## 3. 数据层次与不可覆盖原则

```text
RawSource（原始资料，永不被 Story 覆盖）
  ↓ AI 仅做筛选、分类、连接和克制草稿
CandidateMemory（候选，必须人工确认）
  ↓
LifeEvent / Memory（可长期阅读的记忆）
  ↓
Timeline / Month / Year / Growth / Care（不同阅读角度）
```

Story 可以修改；RawSource、原始媒体、医疗文档、历史测量和已发布版本不能被静默覆盖。未来修改必须保留修订关系、操作者与时间。

## 4. RawSource：来源、内容与贡献者

每条原始资料有三个独立维度：

- `sourceType`：它从哪里来，如 `family_photo`、`daycare_note`、`wechat`、`medical_document`。
- `contentTypes`：它在讲什么，如 `daily`、`language`、`motor`、`sleep`、`health`。
- `contributorId`：谁留下它，如爸爸、妈妈、老师、医院或系统导入。

`sourceType = wechat` 不等于 `contributor = 妈妈`。这种区分让未来可以从“妈妈眼里的张年”“老师留下的记录”等角度重读，而无需现在增加复杂页面或数据库表。

## 5. Memory 与记忆重量

`LifeEvent` 允许不完整：标题、故事、地点、人物、标签和图库都可以缺省。最轻的记忆可以只是一句话、一张照片或一段 8 秒视频。

内部 `memoryWeight` 有四级：

- `trace`：普通生活痕迹；轻量文字，不强迫成故事。
- `memory`：值得留下的一段普通记忆。
- `highlight`：第一次、明显成长变化或特别有趣的时刻。
- `chapter`：旅行、生日、人生阶段等章节性记忆。

UI 用图片尺寸、标题比例、留白、故事长度和媒体数量表现重量。用户不需要理解这些技术字段，只能使用自然信号“留在年鉴”。

## 6. Story / Evidence

详情页分两层：

1. **Story**：多年后如何重新阅读这一天，包含时间、地点、主媒体、简短故事、人物与成长关联。
2. **Evidence / 那天留下的东西**：照片、视频、微信原话、老师记录、家庭备注与文档。

微信显示为“当时我们怎么说”，老师记录显示为“老师眼里的张年”，而不是笼统附件计数。AI 不能改写或替换这些原话。

## 7. Home：最近的人生变化播放器

`RecentMemoryCanvas` 直接读取最近已确认的 LifeEvent，不维护第二套 Home CMS：

- 桌面端以一张主媒体和右侧 4 条克制索引切换。
- 移动端支持按钮与横向手势切换，不使用广告轮播式分页点。
- Home 其余内容仅有最近变化、少量时刻、当前月份与一段轻量“以前的这个时候”。
- Home 不读取或泄露私密健康详情。

## 8. Memory：三种时间尺度

- Event / Day：`/memory` 连续时间流。
- Month：`/memory/2026/08` 摄影月刊式回顾。
- Year：`/memory/2026` 年鉴式回顾。

Growth、语言、运动、贡献者、人物、地点、标签与 Content Type 都是未来重新阅读 Timeline 的索引角度，而不是新的平行内容库。

## 9. 关于张年

`/about` 取代 Growth / Health 一级入口，包含：

- 现在的张年：年龄、身高、体重与语言、运动、饮食、睡眠、兴趣、性格。
- 成长：数据驱动的身高 / 体重趋势，以及语言 / 运动路径；节点可以回到 Memory。
- Sleep Journey：频繁夜醒 → 夜醒减少 → 夜间稳定 → 抱睡退出 → 自主入睡过渡。
- 健康与关注：观察中、长期关注、习惯建立、护理中、已稳定与历史。

健康和睡眠默认 `private`。当前仅为 Mock UI，明确标记“仅家庭可见”；真实版本必须在服务端认证和授权之后才读取这些数据。

## 10. 医疗资料与 Care Episode

医疗资料采用受控流程：

```text
Medical RawSource
  → 提取日期 / 医院 / 检查类型 / 原始事实
  → 爸爸妈妈确认
  → Care Episode
```

AI 只允许提取、分类、整理和建立顺序；不得诊断、判断病因、修改医疗事实或生成确定性结论。原始医疗文档永久保留。当前 Mock 只证明数据关系和 Episode Timeline 可行，不开发医疗系统。

## 11. AI 边界

AI 的优先级是：

```text
Selection & Connection > Generation
```

它可以把多数普通资料归入 Daily Trace，也可以明确说“今天没有发现需要单独形成 Memory 的事件”。任何候选 Memory、成长推断、Story Draft、医疗提取和可见性变更都必须由授权家庭成员最终确认。

## 12. 隐私与媒体

1. 儿童照片、视频、健康与家庭信息默认敏感。
2. 原始资料默认 `family` 或 `private`；整理前不自动进入阅读页。
3. `public` 必须由授权家庭成员显式确认，并由真实服务端策略执行。
4. Home 与公开 Memory metadata 不得加载健康详情。
5. 媒体必须有授权、来源、可见性和描述性 alt；视频未来必须有 poster 与字幕策略。
6. Mock 图片来自仓库内受控路径，不使用临时外链。

## 13. Now / Later / Out of Scope

### Now

- Next.js App Router、React、TypeScript、CSS 与 Mock Data。
- 新导航、Home、Memory 三尺度、About、Capture、Memory Candidate、Story / Evidence。
- Contributor、Source / Content 双层分类、四级记忆重量、V1 Growth / Sleep / Care 内容迁移。

### Later

- 服务端认证、visibility policy、对象存储、媒体授权与修订历史。
- 真实导入、搜索、AI 辅助聚合、受控医疗资料整理与偶遇过去策略。

### Out of Scope

PostgreSQL、Drizzle、真实 Auth / 上传 / 微信 API / OCR / AI API / 照片识别 / 转码 / 医疗诊断 / 队列 / Worker / 搜索引擎 / 完整 RBAC。

## 14. Preview 与发布

本轮只能在功能分支与 Preview 验证。交付前运行 `npm run lint`、`npm run build`，检查桌面 / 移动端、导航、所有核心路由、中文标题断行、图片比例、键盘焦点与 console。真实合并和发布只能由指定家庭成员确认。
