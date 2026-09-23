# 首页照片位置梳理（2026-09-23，前端 session）

范围更正（Teddy 中途澄清）：首页"最近的一组"（原"最近一周"主题）已于 2026-09-19 下架，
**不恢复、不补新板块**。下面只列首页现在实际渲染的位置，不包含已下架的东西。

## 结论先说：首页现在只有两个会出现照片的位置，没有月份卡片

`v2/app/page.tsx`（2026-09-16 改版后）整页只有三段：`home-lede`（问候+文字近况，无图）、
一段回忆（`HomeMemory` 或 `MemoryFallback` 二选一）、`Reminders`（纯文字，无图）。
月份卡片/月份网格不在首页——月份入口在顶部导航「记忆」里（`/memory/...`），不属于本次任务范围。

---

## 位置一：`HomeMemory` 轮播（几段回忆，一次一段，按「换一段」切换）——首页的主要照片位置

- 组件：`v2/components/home-memory.tsx`；数据：`v2/lib/home-memory.ts` 的 `selectHomeMemories()`。
- 池子来源：`archive.chapters`（`loadFamilyArchiveOnDemand()` 已经读好的全档案，**不是**只有最近月份）——
  也就是说这个位置的候选**横跨全部有照片的月份**，包括还在回填中的 2026-07/08/09。
- 段落种类（`MemoryThemeKind`）：**只有 `topic` 和 `season` 两种**。
  - `day`（某一天）在代码里已经写好（`buildDayMemory`），但**从未接入** `selectHomeMemories()` 的
    组装逻辑——只有 `test/home-memory.test.mjs` 在用它。这不是本次任务要修的东西（会变成新增位置/新主题），
    只记一笔，供以后决定要不要接。
  - `week`（最近一周）已删除，本次不恢复。
- 每一段内部的选片逻辑（已经是"本地程序去重 + DeepSeek 语义评分"两把尺子，不是新起炉灶）：
  1. **门槛**：`usable()` = `isSubjectChecked`（media_subject_check 审核通过，确认画面里是张年，
     截图/表情包/商品图/证件在审核这一步已经被挡掉，2026-09-23 刚上线的 f8328a8）
     + `thumbnailSized`（尺寸够用）。
  2. **去重看像素**：`representatives()` 把连拍/原图+压缩版折叠成一组，取**像素最大**那张
     （`burstGroups` + 按 `width*height` 排序）——这就是"优先用高清原图"，已经实现，不是新需求。
  3. **挑好看看价值分**：`pickSlides()` 用 `photo-topics.json`（DeepSeek 逐张标注的 `value` 0–1 分）
     排序，价值分不够/缺失时才退回按时间均匀取（`spread`）。`topic` 主题额外要求
     `value ≥ TOPIC_MIN_VALUE(0.7)` 且主题判断 `confidence ≥ 0.6`。
  4. **同段内不同质化**：`diversify` 开关（`day`/`season` 开，`topic` 关，因为 topic 段本来就只有
     一个话题）——按"这个子话题目前选了几张"升序插入，价值分只用来在同等次数里排序。
  5. **封面**：`coverIndexOf()` 取价值分最高的一张；跨时间的段（topic/season）额外限制在
     **后 40%**（时间上偏新），避免"跨一年的主题封面永远是最小时候"。
- 主题词表（`TOPIC_THEMES`）：玩水、睡觉、笑、吃饭、户外、玩玩具、抱着——依据都是
  `photo-topics.json` 里逐张标注的 `topic` 字段，**已经是 DeepSeek v4.1 Flash 跑出来的**
  （`lib/organizer/deepseek-model.ts` 统一约束），不是本地程序猜的。
- **本轮已补上的两个缺口**（原来记在这里的两条，2026-09-23 已实现，见下面「已完成」一节）：
  1. 跨段（跨 topic/跨 season）不检查重复——已加 `usedIds` 跨段排除。
  2. 同段内"是否同一场景"只靠 burst 像素去重——已加"同一天+严格小于 10 分钟"的替代规则，
     真正的场景标注字段到位后这段替代逻辑会整体删掉换成读那个字段。

## 位置二：`MemoryFallback` 单图降级——只有 `memories.length === 0` 时才会出现

- 组件：`v2/app/page.tsx` 里的 `MemoryFallback`；数据：`v2/lib/home-feed.ts` 的 `feed.lead`
  （`selectLead()` / `buildPhotoCandidates()`）。
- 触发条件：`selectHomeMemories()` 一段都选不出来。**已用生产验证：今天确实不会走到这里**——
  `curl https://nianlife.cn/` 返回的 HTML 里有 `memory-stage`（位置一在渲染），没有
  `memory-single-photo` / `home-nothing`（位置二的特征标记），确认生产此刻渲染的是位置一。
- 池子来源：`photoPoolMemories(archive.chapters, today)` → 近 `HOME_CANDIDATE_WINDOW_DAYS` 天的
  已发布记忆里，经 `story_binding` 审核通过的配图（`memory.storyPhotos`/`memory.lead`），
  按"轮换期"（`edition`）在候选间循环、避免同一张连续多期出现（`home-feed.ts` 里的冷却机制）。
- 打分：`qualityFor()` 优先读 `HOME_PHOTO_QUALITY_PATH` 指向的离线缓存；查不到该张时退回
  `deterministicQuality`（纯几何/时间的确定性降级分，不是模型评分）。
- **已核实（2026-09-23，SSH 进生产容器直查）：这份缓存在生产完全没有接上。**
  `docker exec nianlife-diag-web env | grep HOME_PHOTO` 空——没有设 `HOME_PHOTO_QUALITY_PATH`；
  容器里 `/srv` 下只有 `nianlife-content` 和 `nianlife-health` 两个持久挂载，没有第三个给
  这份缓存用。也就是说位置二哪怕被触发，今天也**只会**用确定性降级分，`scripts/home-photo-quality.mjs`
  这个生成脚本至今没有在生产数据上真正跑过一次、更没有接进任何夜间任务。
  由于位置二现在不是首页实际渲染的位置（上一条已证实），**这条缺口眼下没有线上影响**，
  但按 Teddy 的要求（"没有的话，让它跟着夜间任务一起生成"）如实记在这里，不假装已经接好。
  接线本身（选哪个夜间任务、什么时候跑、写到哪个持久目录）需要一个新的 DeepSeek 批次调用
  和一次部署改动（新增一个类似 `HEALTH_MOUNTS` 的持久挂载 + 环境变量），
  这属于数据 session 的调用编排范围（CLAUDE.md 视觉解析分工表），前端 session 不越权代做；
  这里给的是可以直接交接的规格，见文末「交接给数据 session」。

---

## 已完成（2026-09-23，不依赖 round4 数据的部分）

Teddy 认可审计结论后明确：轮播最终重选要等全部月份的同场景精选完成，但下面四件事不依赖那份
数据，先做掉。改动全部在 `v2/lib/home-memory.ts`（+ `v2/test/home-memory.test.mjs` 补测试），
不改选片的核心排序逻辑（价值分、diversify、封面规则一个字没动）。

1. **跨段去重**（同一轮播里同一张照片、以及同一次连拍的近似照片，只能出现在一个段里）：
   `selectHomeMemories()` 从"topic 段和 season 段各自独立 `.map()`"改成按 `TOPIC_THEMES` 顺序
   （Teddy 点名的玩水/睡觉/笑排最前）→ 再按季节新到旧顺序，依次建段；每建成一段（且真的会展示，
   即通过 `spansMultipleDays`），把它用掉的照片记入一个 `usedIds` 集合，后面的段用
   `excludeUsedBursts()` 把这些照片（连同它们各自的连拍组）从候选池里剔除。供给不够时，
   后面的段会缩小甚至整段不出现（不复用），这是预期行为，不是 bug（新增测试
   「跨段去重供给耗尽时，后建的段没有照片可选，宁可不出这一段」钉住这一点）。
2. **同场景去重的替代规则**：真正的"同场景"标注字段（10 分钟内 + 画面相似度）还在数据 session
   那边做，字段没来之前用"同一天 + 拍摄时间连续相差**严格小于** 10 分钟"这条链式规则代替
   （`sceneGroups()`/`sceneRepresentatives()`，新函数，只在 `home-memory.ts` 内部用，字段就绪后
   整段删掉换成读那个字段）。留了一张"最值得展示"的（按价值分，没有价值分退回像素），应用在
   burst 去重（90 秒连拍）**之后**、按天封顶（`capPerDay`）**之前**。
   用严格小于而不是小于等于：现有选片逻辑到处假设"隔 10 分钟＝不同瞬间"
   （`moments()` 测试夹具、以及很多实际候选的取样间隔），如果用"小于等于"，恰好卡在 10 分钟
   整的候选会被误判成同场景，波及面很大；新增测试「恰好相差 10 分钟不算同一场景」钉住这个边界。
3. **位置二的质量缓存现状**：已核实（见上）——生产没有接，位置二今天也不是实际渲染的位置。
   没有去"顺手"新建一个夜间脚本或部署挂载，因为那需要一次新的 DeepSeek 批次调用编排和
   一次持久挂载的部署改动，按分工应该由数据 session 决定调用范围和时机；规格已经写好可以直接接手。
4. **不新增位置，不做"最近 30 天首屏大图"**：确认没有改 `app/page.tsx` 的板块结构，
   `HomeMemory`/`MemoryFallback`/`Reminders` 三段和改动前完全一样，只改了段内部的候选池计算。

验证：`test/home-memory.test.mjs` 43 条全过（新增 4 条，覆盖跨段去重两种供给情形 + 场景去重
两种边界）；`test/home-feed.test.mjs` / `test/home-photo-quality.test.mjs` / `test/render-on-demand.test.mjs`
共 76 条全过（这三个文件没有改动，用来确认没有牵连回归）；`tsc --noEmit` 干净；`npm run lint` 干净。

## 部署与生产验收（2026-09-23，71b88e6）

两道闸都过：`GATE_A_OK`（线上 SHA cd6cf64 是 71b88e6 的祖先）→ 构建 → `GATE_B_OK`（切换后
`/api/health` 的 sha、`/`、`/health`、`/memory/2025/12`、`/memory/2025/12/01` 五项冒烟全部 200）。
`curl https://nianlife.cn/api/health` 确认线上 `build.sha` 已是 `71b88e691fee1a2289d17f834bac822399bda812`。
保留策略清理了一份旧镜像（`nianlife-web:0f7088d`），当前保留 `71b88e6`/`cd6cf64`/`456b2d7` 三个版本。

浏览器验收脚本：`v2/.data/home0923-dedup-verify.mjs`（Playwright，桌面 1440×900 + 手机 390×844，
各把「换一段」点 5 次，抓每次的封面 `src` 和所有已挂载 `<img>` 的 `src`）。结果：

| 宽度 | 依次切到的 6 段 | 封面重复 | 已挂载 img 里重复的 src |
|---|---|---|---|
| 桌面 1440×900 | 玩水的日子 → 2026 年的夏天 → 睡着的样子 → 2026 年的春天 → 笑起来的时候 → 2026 年的秋天 | 0/6 | 0 |
| 手机 390×844 | 同上（同一批数据，同样的顺序） | 0/6 | 0 |

两种宽度都没有 4xx/5xx、没有页面 JS 报错。截图存在 `.data/frontend-verify/`：
`desktop-home-switch-0.png` ~ `-5.png`、`mobile390-home-switch-0.png` ~ `-5.png`
（`0` 是打开首页时的初始段，`1`–`5` 是每点一次「换一段」之后）。目测两张样例（桌面第 0 张、
手机第 0/2 张）：布局完整、照片清楚、没有裁切或加载失败。

跨段去重的效果在这次真实数据上不算剧烈——6 段本来就是 6 个不同的主题/季节，产品今天的素材量
下这几段candidate 池本来就够大，不太容易出现"同一张高分照片同时是两段候选"的情况；
真正验证这条逻辑生效的是单元测试（供给紧张时的两条新测试），生产这次点选只是确认没有引入
可见的回归，不是"抓到了一次原本会重复、现在被挡住的照片"。

## 交接给数据 session：位置二质量缓存要接进夜间任务需要什么

- 现成脚本：`v2/scripts/home-photo-quality.mjs`（能力门 + 有界批次 + 严格解析，2026-09-13 写的，
  一直没在生产数据上真正跑过）。用法见文件头注释：
  `node --import tsx scripts/home-photo-quality.mjs --out <cache.json> [--limit] [--days] [--base]`。
- 读取端已经就绪、不用改：`v2/lib/home-photo-quality.ts` 的 `loadQualityCache()` 读
  `HOME_PHOTO_QUALITY_PATH` 指向的文件；`v2/lib/home-feed.ts` 的 `qualityFor()` 已经接好这条读取路径。
- 缺的是"跑起来 + 让生产读到"这一段：
  1. 找一个夜间任务把这个脚本接进去（或新写一个），输出写到一个**持久目录**（不能是容器内部路径，
     重启会丢——参照 `HEALTH_MOUNTS`/`CONTENT_HOST_DIR` 那种"ECS host 目录只读挂载进容器"的模式）。
  2. 部署脚本（`v2/scripts/deploy-ecs-public.sh`）加一个新的 mount 变量（前端 session 可以配合改，
     但只有在数据 session 决定了目录结构和文件名之后才能加，不能凭空建一个可能没内容的挂载点）。
  3. 生产环境变量加 `HOME_PHOTO_QUALITY_PATH` 指向挂载后的容器内路径。
  4. 这条线目前**没有生产影响**（位置二不是当前渲染路径），优先级由 Teddy/数据 session 定，
     不算这一轮的阻塞项。

## 交接给数据 session：photo-topics.json 目前不是"夜间自动"

Teddy 原话要求确认"夜间任务跑完，首页自动换新照片，不用人工操作"。**如实汇报：现在不是这样。**

- `v2/data/photo-topics.json` 是**手动批次跑出来 + 手动 commit + push + 部署**上线的
  （`git log -- v2/data/photo-topics.json`：`7aad3e7` 全库标注、`a328dc4`/`e4f9a48` 两次修规则重新
  提交，三次都是独立的提交，不是某个自动化任务写的）。仓库里**没有**一个生成这份文件的脚本
  被提交下来（`grep -r "photo-topics" v2/scripts` 无结果）——生成它的脚本本身也不在版本控制里。
- 读取端是**构建期静态 import**：`v2/lib/home-memory-topics-load.ts` 默认
  `import("@/data/photo-topics.json")`，这份 JSON 会被打进 Next.js 构建产物。也就是说哪怕现在
  就有一个夜间任务能重新算出这份 JSON，只把文件写到磁盘上不会让线上生效——**必须走一次 commit +
  部署**，或者改成跟质量缓存一样，用 `HOME_PHOTO_TOPICS_PATH` 环境变量在运行时读一个持久挂载的
  文件（代码里这个环境变量已经留了口子，只是生产没设）。
- 这两件事（写生成脚本、决定要不要改成运行时读取）都涉及 DeepSeek 批次调用编排和部署挂载改动，
  按分工交给数据 session 决定；前端 session 这一轮只把现状核实清楚，不擅自建一个可能跑不动或
  没人维护的自动化。

---

## 卡在哪：round4 数据还没到"可以重新精选"的程度

`v2/.data/round4-progress.md`（注意路径是 `v2/.data/`，不是仓库根目录 `.data/`）里没有名为
"去重后"的列——现有列是：重写天数 / 回填条数 / 校验是否通过 / 月页是否打开正常 /
**新挂上照片、视频**。查了这一列：

| 月份 | 新挂上照片 / 视频 |
|---|---|
| 2026-09 | `-` |
| 2026-08 | `-` |
| 2026-07 | `-` |
| 2025-12 | 86/3（唯一有数字的月份） |

**2026-07/08/09 三个月都还是 `-`，同场景精选还没做完。** 而位置一（`HomeMemory`）的候选池是
`archive.chapters` 全量，直接吃到这三个月现在的照片状态——如果现在就动手"换得更好"，选出来的
很可能是马上要被替换掉的旧候选，等于白做一轮,还可能把测试/截图的证据基线建在一批快要变的照片上。

**按任务书自己给的条件**："先看 xxx，确认三个月已经有数字，再开始选图；还没有的话，先做梳理，
等数据就绪"——第 1 步（本文件）已完成，第 2/3/4 步（选图标准落地、DeepSeek 打分缓存改造、
部署与真实截图验收）等 2026-07/08/09 三个月「新挂上照片/视频」列出现数字之后再做。

## 下一步（等 round4 全部月份的同场景精选完成后）

1. 数据 session 全部月份跑完、第一个夜间任务写出新的 `photo-topics.json` 之后——**按现状
   还需要一次 commit + 部署才会生效**（见上面「photo-topics.json 目前不是夜间自动」），
   不是自动的。真要做到"无人工操作"，需要数据 session 决定：继续手动 commit+部署，
   还是改成运行时读取一个持久挂载的文件（`HOME_PHOTO_TOPICS_PATH`，读取端代码已经支持）。
2. 新 `photo-topics.json` 上线后，重新看一遍首页轮播的实际选片结果（换 5 次段，确认好看、
   不重复、不同质化），因为本轮的跨段/场景去重逻辑本身不依赖具体是哪批照片，届时不需要
   再改代码，只是候选池换新了。
3. 位置二质量缓存要不要接进夜间任务，由 Teddy/数据 session 按优先级定（现在没有生产影响）。
