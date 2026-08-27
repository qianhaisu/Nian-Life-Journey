# Nian Life Journey V2 架构方案

**状态：架构设计阶段，不包含业务代码**  
**基准：V1.3，2026-08**  
**目标：建立可维护 5-10 年的“张年数字人生档案”**

## 1. 产品核心与设计原则

V2 不是由多个栏目拼接的网站，而是一个以时间为主轴的人生档案系统：

```text
张年 Profile
  -> Timeline
    -> LifeEvent
         -> Photo / Video / Location / People / Tags
         -> GrowthRecord
         -> CareRecord
```

`LifeEvent` 是完整的“记忆单元”：一次发生在时间中的经历及其故事、媒体、地点、同行的人、标签和相关观察。`GrowthRecord`、`CareRecord` 与 `Media` 可独立记录，但在发生于具体生活情境时应关联到 `LifeEvent`，使 Timeline 成为理解张年生活的共同入口，而不是让成长、照护和媒体形成孤立系统。

1. V1 保持原样、继续可访问，只作为真实内容、产品需求与视觉语言参考；V2 不重构 V1 DOM、CSS 或脚本。
2. 首期优先完成可用的家庭记录体验，避免把家庭档案做成企业级 CMS。
3. 数据记录应有时间、来源与可见性。成长和照护记录的更正保留原记录，并以新记录标示修正关系，不静默覆盖历史。
4. 儿童照片、视频、健康记录和家庭信息默认私密。`public` 必须由被授权的家庭成员显式设置，不能由客户端自行决定。
5. 所有读取、写入、媒体访问和 visibility 判断都必须在服务端再次授权；公开页面只能查询明确为 `public` 的数据。
6. 任何生产发布仍需从当前 `main` 创建功能分支、通过 Preview 检查，并由指定家庭成员确认后合并。MVP 不在应用内实现审批平台。

## 2. V1 现状与迁移边界

V1 是 `index.html` 中的静态单页，展示了档案概况、月度总结、身高体重趋势、成长维度、健康与睡眠观察、闪光时刻、外出食物指南及下月关注事项。它使用固定底部导航，包含 `assets/images/` 下的图片，也有内嵌 base64 WebP。

V2 应保留的产品价值：

- 从出生日期计算年龄；保留身高、体重及其测量日期。
- 记录日常故事、闪光时刻、睡眠和健康观察，但健康内容只表述为日常观察，不替代专业医疗判断。
- 延续适合手机阅读的温和、清晰视觉语言，且每张媒体都要求有 alt 文本。
- 将 V1 的静态“下月重点”转成带日期的 GrowthRecord 或 CareRecord，必要时关联 LifeEvent。

V2 不迁移或改写 V1 的代码和原始内容。任何导入必须逐项确认来源、可见性和媒体授权；首期可从合成数据开始，再手工录入或导入已确认可用的内容。V1 的 base64 媒体不直接复用为 V2 数据来源。

## 3. MVP 页面与体验

首期只有六个核心页面，均按当前用户可访问的数据渲染：

1. **Home**：张年的当前状态、最近发生的事情、最近照片、近期重要成长变化和最近闪光时刻。
2. **Timeline**：产品的主页面。按日期浏览 LifeEvent；一个日期块可以连续呈现照片、故事、同行的人、地点及相关成长或照护观察。
3. **LifeEvent Detail**：一个完整记忆单元，包含标题、发生时间、地点、故事、照片/视频、标签、相关成长记录与相关照护记录。
4. **Growth**：按时间查看身高、体重及发展观察；以趋势与记录列表为主，可跳回相关 LifeEvent。
5. **Care**：按时间查看简单的健康、睡眠、饮食或照护观察；默认私密，可跳回相关 LifeEvent。
6. **Media**：按时间浏览已授权媒体，并显示其关联的 LifeEvent；不做复杂媒体资产管理平台。

创建和编辑可以作为上述页面中的受保护操作或简洁的 `/manage` 区域，不另建 Dashboard、发布审核、媒体审查或权限管理后台。首页、Timeline 和详情页是首期体验优先级最高的路径。

## 4. MVP 数据模型

PostgreSQL 为唯一业务数据库，Drizzle ORM 负责 schema、迁移和 TypeScript 类型推导。业务表均使用 UUID；时间存 UTC、按家庭配置时区展示。第一阶段只建立以下六个核心实体，不为标签、人物、地点或审批预先建立大量表。

### 4.1 `profiles`

张年的稳定档案，一期通常只有一条。

- `id`、`displayName`、`birthDate`、`timezone`、`bio`、`visibility`
- `createdAt`、`updatedAt`

年龄由 `birthDate` 和查看日期计算，不保存会过期的“当前年龄”。

### 4.2 `life_events`

Timeline 的主实体和记忆单元。

- `id`、`profileId`、`title`、`story`
- `occurredAt`、可选 `occurredEndAt`、`recordedAt`
- `eventType`（如 `moment`、`outing`、`routine`、`milestone`）
- `locationLabel`：仅保存适合展示的粗粒度地点；不保存或公开儿童精确地址。
- `people`：受限 JSON 数组，只放关系或经确认的显示名，例如“妈妈”“爷爷奶奶”。
- `tags`：受限 JSON 字符串数组，用于首期筛选与后续 AI 理解。
- `visibility`、`createdAt`、`updatedAt`

首期 `people`、`tags` 和地点以字段承载，避免 `people`、`tags`、`locations` 及多对多关系表。出现跨档案复用、关系权限或复杂检索的明确需求时，再拆成独立实体。

### 4.3 `growth_records`

所有成长测量和成长观察共用一张表，而不是首期拆分 `growth_observations` 与 `growth_milestones`。

- `id`、`profileId`、可选 `lifeEventId`
- `kind`（如 `height`、`weight`、`language`、`motor`、`social`、`feeding`、`sleep`）
- `observedAt`、`value`、`unit`、`note`、`source`
- 可选 `correctsId`：更正时指向旧记录，旧记录保留。
- `visibility`、`createdAt`

数值测量使用 `value` 与 `unit`；叙事观察可只使用 `note`。当睡眠需要每日结构化时段、成长指标需要医学参考区间或里程碑需要独立流程时，再拆分专用表。

### 4.4 `care_records`

简单照护与健康观察共用一张表，而不是首期建立 `sleep_records`、`health_observations`、`care_guides`。

- `id`、`profileId`、可选 `lifeEventId`
- `kind`（如 `health_observation`、`sleep_note`、`feeding_guidance`、`reminder`）
- `observedAt`、可选 `endedAt`、`status`、`note`、`source`
- 可选 `correctsId`
- `visibility`、`createdAt`

健康记录默认 `private`，文字必须是观察而非诊断。只有确有稳定的、需要独立查询和验证的每日睡眠指标、医疗观察字段或版本化照护指南时，才拆分专用实体。

### 4.5 `media`

足够简单、可扩展的照片与视频元数据；数据库只存元数据和受控存储定位，不存二进制。

- `id`、`profileId`、可选 `lifeEventId`
- `type`（`photo` 或 `video`）
- `objectKey`：受控对象存储的内部 key，不使用临时外链或不受控 URL。
- `thumbnailObjectKey`、`width`、`height`、`mimeType`、可选 `durationSeconds`
- `takenAt`、`alt`、`visibility`
- `createdAt`

一期实现上传、保存、生成缩略图和绑定 LifeEvent。若同一媒体未来需要关联多个事件，再由 `media_links` 关系表替代 `lifeEventId`；一期不提前增加该表。

### 4.6 `monthly_snapshots`

用于首页月度回顾和长期浏览，不是发布版本系统。

- `id`、`profileId`、`month`（例如 `2026-08`，同一 Profile 唯一）
- `summary`、`highlights`（JSON 字符串数组）、`visibility`
- `createdAt`、`updatedAt`

快照引用的是当月已存在的 LifeEvent、GrowthRecord、CareRecord 和 Media 查询结果，不复制这些原始记录。若未来需要冻结公开展览或正式版本回滚，再增加不可变发布版本模型。

### 4.7 共通约束

- MVP 只有 `private`、`family`、`public` 三种 visibility，存为受约束枚举值。
- 新建照片、视频、健康记录和家庭关系信息默认 `private`；`public` 必须显式选择。
- `family` 的具体访问者由认证后的家庭访问策略判断。MVP 可以只有单一受信家庭访问组，不实施多级 RBAC。
- 读取服务和 Server Action/Route Handler 都必须按登录身份与 visibility 过滤；客户端传来的 visibility 和关联 ID 仅作输入，不能作为授权依据。
- 以数据库外键保证 `profileId` 与可选 `lifeEventId` 的完整性；记录关联的 Profile 必须一致。
- 为关键写入保留 `createdAt`、`updatedAt` 和操作者标识的最小请求日志。完整审计平台、修订系统和不可变发布版本留待后续。

## 5. 媒体、隐私与访问控制

### Media MVP

1. 已登录用户从受保护页面上传照片或支持的短视频。
2. 服务端确认用户可写入 Profile，并生成受限上传凭据或代理上传。
3. 文件存入私有的受控 object storage；数据库保存 `objectKey`、尺寸、MIME、拍摄时间、alt 和 visibility。
4. 同步或简单的受控处理生成缩略图；处理完成后才能在应用中使用。
5. 用户将 Media 绑定到一个 LifeEvent；页面按服务端授权生成媒体访问响应。

生产环境的 V2 新媒体使用对象存储，V1 的 `assets/images/` 保持原样。不得使用临时外链，不得提交私密原图、base64 媒体或凭据到仓库。选择对象存储服务前，应确认区域、备份、成本和访问策略；私有 bucket 默认拒绝公开列举与读取。

### Privacy MVP

- 儿童媒体、健康信息、家庭信息默认私密；`public` 是逐条显式选择，不是“已登录即可公开”。
- 公开页面不得加载、预取、生成 metadata 或在错误信息中泄露私密标题、地点、缩略图、object key 或关系信息。
- `private` 仅对记录者/档案所有者可见；`family` 仅对服务端认证后的家庭访问者可见；`public` 才允许匿名读取。
- 访问策略放在服务端数据访问层；对象存储原件不直接公开。
- 每个媒体需要来源、上传者和 alt；每条真实数据写入前需要人工确认适当的 visibility。完整 consent workflow 留待需求明确后再做。

## 6. 技术架构：Now / Later / Optional

### Now

- Next.js App Router、React、TypeScript、Tailwind CSS。
- PostgreSQL 和 Drizzle ORM，六张 MVP 业务表及迁移。
- 一个可靠的认证方案，用于登录并在服务端识别家庭访问者；选择与部署平台兼容、维护量低的方案。
- 单一 Next.js 应用：页面、Server Actions/Route Handlers、授权策略和数据库访问在同一部署单元中完成；不建独立后端。
- 私有受控 object storage，用于 V2 新媒体；上传、保存、缩略图和 LifeEvent 关联。
- 部署到一个支持 Preview 的平台，配置生产数据库、环境变量、备份和最小健康检查。
- 单元/集成测试覆盖 visibility 策略、关键写入校验及 Timeline 查询；在手机与桌面浏览器做关键路径验证。

### Later

- `people`、`tags`、`locations` 与 Media 多对多关系的拆表：当复用、筛选、共享或关系授权成为实际需求时。
- 更完整的账户与家庭成员管理：当单一家庭访问组不再够用时，再增加角色和成员模型。
- 结构化睡眠、健康或照护专用表：当记录频率、字段验证或趋势分析证明 JSON/通用记录不够用时。
- 多媒体处理队列：当同步缩略图影响体验、视频量增加或需要可靠重试时。
- 不可变发布版本、内容修订、最小审计界面和公开内容回滚：当家庭开始频繁公开分享时。
- 基础全文搜索或筛选索引：当 Timeline 数据规模和实际查询行为证明需要时。
- 视频 poster、转码和字幕工作流：先明确视频使用量、设备兼容性与存储预算。

### Optional

- Redis：只有出现可测量的会话、限流或缓存瓶颈时再引入。
- 独立后端、消息队列和独立 worker：只有异步媒体/AI 工作无法在单体应用中可靠处理时再拆分。
- CDN、自定义缓存失效和原图归档：由公开媒体规模、成本和撤回需求决定。
- 第三方 CMS、搜索引擎、offline-first、多语言与高级统计：仅在明确的使用场景和维护责任出现后评估。
- AI 能力：见下一节；不在 MVP 建立 `ai_jobs` 或通用 AI 平台。

## 7. AI 预留

V2 的结构化 `LifeEvent`、`GrowthRecord`、`CareRecord`、`Media` 与 `MonthlySnapshot` 已足以让未来 AI 在受控范围内理解张年的生活。未来可能支持：

- 月度总结初稿；
- LifeEvent 摘要；
- 标签、时间线分类和图片 alt 文本建议；
- 在明确授权范围内的搜索问答。

AI 只能生成候选结果，不能自动改写测量、健康状态、visibility 或公开状态。接入前必须定义最小数据发送范围、家庭授权、人工确认与供应商保留策略；默认不向第三方发送儿童原图、健康详情或家庭身份信息。只有真实使用场景稳定后，才增加任务记录、模型版本和人工审核等能力。

## 8. 实际目录结构

保留 `v2/` 是合理的：它为 V1 静态站点与 V2 应用提供明确所有权边界。首期只建立马上会使用的目录；不要预建空的 `admin`、`api`、`audit`、`worker`、多层测试或组件分类目录。

```text
.
├── index.html                     # V1，保持不改
├── assets/images/                 # V1 参考媒体，保持不改
├── AGENTS.md
├── .github/
├── docs/
│   └── v2-architecture.md
└── v2/
    ├── app/
    │   ├── (app)/
    │   │   ├── page.tsx           # Home
    │   │   ├── timeline/
    │   │   ├── events/[id]/
    │   │   ├── growth/
    │   │   ├── care/
    │   │   └── media/
    │   ├── login/
    │   ├── layout.tsx
    │   └── globals.css
    ├── components/                # 仅在首个可复用组件出现后创建
    ├── db/
    │   ├── schema.ts
    │   └── index.ts
    ├── lib/
    │   ├── auth.ts
    │   ├── policy.ts
    │   ├── media.ts
    │   └── validation.ts
    ├── drizzle/
    ├── public/
    ├── package.json
    ├── drizzle.config.ts
    ├── next.config.ts
    └── tsconfig.json
```

随着实现出现再创建 `tests/`、更细的 schema 文件、Route Handlers 或管理页面。V2 独立管理依赖、环境变量、迁移和部署项目；不改变 V1 入口或其历史。

## 9. 实施顺序

1. **隐私与部署决策**：确认仓库和部署项目访问策略、默认时区、家庭访问者、生产数据库和对象存储；在确认前不导入真实敏感数据。
2. **最小应用骨架**：在新功能分支创建 `v2/` Next.js 项目，配置 TypeScript、Tailwind、PostgreSQL、Drizzle、认证与 Preview。
3. **六实体和服务端策略**：创建迁移、输入校验、visibility policy 和合成数据；先测试未授权与公开查询不会泄露私密数据。
4. **Timeline 主路径**：实现 LifeEvent 创建、Timeline、详情页及 Growth/Care 关联。
5. **照片主路径**：实现私有媒体上传、缩略图、alt、visibility 与 LifeEvent 关联。
6. **Home、Growth、Care、Media**：以真实使用场景打通浏览与创建；完成移动端和 Preview 验证后部署生产。

## MVP Scope

MVP 完成后，指定家庭成员能够：

1. 登录。
2. 查看张年首页。
3. 浏览 Timeline。
4. 打开一个 LifeEvent。
5. 创建 LifeEvent。
6. 上传照片。
7. 把照片绑定到 LifeEvent。
8. 添加成长记录。
9. 添加简单照护记录。
10. 查看 Growth。
11. 查看 Care。
12. 控制每条记录和媒体的 `private` / `family` / `public`，并由服务端执行访问控制。
13. 在手机上正常浏览和记录。
14. 经过 Preview 检查后部署到生产环境。

## Out of Scope for MVP

- AI assistant 和通用 AI jobs 平台。
- 视频转码、HLS、字幕处理和复杂视频管线。
- 复杂搜索和搜索引擎。
- 多级审批与 publication revision。
- 多角色权限与完整 RBAC。
- 完整审计系统。
- 自动照片分类、自动 EXIF 清理 pipeline、去重和 AI 图片理解。
- 病毒扫描 worker、CDN purge workflow、legal hold 和原图归档平台。
- 多语言、离线编辑或 offline-first。
- 高级统计分析。

## 10. 未决事项

- 哪些内容和媒体允许 `family` 或 `public`，以及谁负责最终的公开确认与紧急下线。
- 认证供应商、对象存储供应商、区域、备份频率、存储预算与恢复责任。
- 家庭访问者的最小定义，以及张年成年后对自身档案的控制与迁移安排。
- 是否继续公开 V1；若继续公开，应单独评估 V1 已有敏感内容，且该评估不改变 V2 的默认私密原则。
