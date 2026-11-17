# Nianlife「周末去哪」分阶段实施路线图与验收交付清单（03-roadmap）

> **设计基线**：产品与交互见 [01-product.md](./01-product.md)；爬虫、数据模型与 ECS 发布架构见 [02-crawler-and-pipeline.md](./02-crawler-and-pipeline.md)；第三轮重选实测与数据包见 [examples/2026-11-21.json](./examples/2026-11-21.json) 与 [examples/xhs-crawl-manifest-2026-11-21.json](./examples/xhs-crawl-manifest-2026-11-21.json)。  
> **工程约定**：只使用 `main` 分支，不建长期 Preview 环境；常规变更检查通过并推 `main` 后按 [AGENTS.md](../../AGENTS.md) 执行 `deploy-ecs-public.sh` 生产发布并遵守 [docs/ecs-retention-policy.md](../ecs-retention-policy.md)；涉及 `Caddyfile.ecs` 放行 `POST /api/weekend-state`、ECS 挂载调整与新增周度定时任务等基础配置变更，须先经 Teddy 确认后再上线。

---

## 一、三阶段演进总览

| 阶段 | 核心目标 | 交付边界 | 对外可感知价值 |
|---|---|---|---|
| **Phase 1**<br>静态示例 + 全页面 + 免口令直写状态 API + ECS 基座 | 先跑通「首页轻量入口（完整保留 Bento 主画布） + `/travel` 双视图 + 展开配图季节灵感库 + 详情页（亚朵优先对比/时段天气/早午版切换/信息来源折叠）+ `?mode=live` + 「不喜欢这类」与已避开类型持久化 + 直接放行的状态写入 + ECS 拆挂载」整条应用链路。 | `v2/` 页面/API/Caddy/部署脚本 + 以真实核验数据实机验证。 | 周三晚打开首页不打断原有 Bento 档案浏览、`/travel` 双视图横向对比、现场应急视图可用、一键记录「不喜欢这类」与周日轻反馈。 |
| **Phase 2**<br>两阶段（先开放发现、再地名验证）周更爬虫 + 互动门槛 + Webhook | 基于已在 `C:/Users/teddy/NianlifeOps/weekend-planner/` 落盘验证的 `browser-profile/` 与 `relogin.cmd`，上线两阶段周更脚本、3 小时 `hour3data`、携程实价、互动门槛过滤、排除类型联动及无小红书依据硬停发熔断。 | `v2/scripts/weekend/*` + 本机私有账本 + Antigravity 周度 5 个定时调度（依赖周一至周三 20:00 开机联网）。 | 真正实现「**周中零人工收集**」且不再被预设地名或美术馆误导，抓不到小红书绝不硬凑而是诚实提示暂未更新。 |
| **Phase 3**<br>周日轻反馈 & 类型排除自动调权 + 足迹线索衔接 | 打通 `sundayFeedback` 与 `excludedExperienceTypes` → `preference-weights.json` 自动调权、90 天踩雷屏蔽池，以及「准备去哪 → 真实足迹」只读线索衔接。 | 调权脚本 + `codex-editor.mjs` 只读 `Candidate Hint` 消费（不直改 `trips.json`）。 | 推荐越来越贴合张年与父母「好风景、放空、好玩好走」真实口味，且未成行提议不混入成长足迹地图。 |

---

## 二、Phase 1：静态示例驱动的 UI、直写状态 API 与 ECS 基座上线

### 2.1 目标与关键工程重点

1. **先用最新实测核验数据包验证应用层**：以收敛后的 Schema 渲染，确保首页 `WeekendProposalStrip` 仅作为问候语与 Bento 照片墙之间的紧凑一行入口条（完整保留既有问候语、5 块 Bento、近期日常、过去的张年与旅行足迹，不推翻首页结构）、`/travel?view=plan`（含默认可见的紧凑图标周末天气比较条、三方案对应实景主图、4 处带真实配图与可独立展开详情的季节灵感库，以及「不喜欢这类」与已避开类型撤销）、`/travel?view=visited` 双视图、`/travel/weekend/[weekId]` 早/午版切换与「住哪里」（偏爱亚朵标准化大床房、不喜欢喜来登、亚朵优先，不把其他五星品牌一概排除；金桥地铁站亚朵准确标注 `2023 年开业`，无喜来登主推及重复婴儿床提示）及 `?mode=live` 现场视图完全达到 [01-product.md](./01-product.md) 与 [DESIGN.md](../../DESIGN.md) 要求，方案与灵感库无任何美术馆/艺术展锚点，不设夫妻表态投票或微信转发弹窗，用户可见界面**零工程黑话**、**零小红书图片**、**零无来源估算价格区间**。
2. **打通无摩擦状态写入、类型排除持久化与 ECS 挂载拆分**：
   - 将 [v2/Caddyfile.ecs](../../v2/Caddyfile.ecs) 直接放行 `POST /api/weekend-state` 写接口（无口令弹窗、无鉴权限制，由 Teddy 明确指定偏好免鉴权直写）；
   - 在 `v2/lib/weekend/state-store.ts` 支持当周意向方案选择、周日 5 选 1 轻反馈以及家庭共享的「**已避开类型（`excludedExperienceTypes`）**」查看与撤销（初始默认值含 `"art_exhibition"` 对应界面显示「美术馆/艺术展」）；
   - 在 [v2/scripts/deploy-ecs-public.sh](../../v2/scripts/deploy-ecs-public.sh) 与 [v2/scripts/ecs-swap.sh](../../v2/scripts/ecs-swap.sh) 中保持 `/srv/nianlife-content` 整体 `:ro`，单独为 `/srv/nianlife-content/weekend/state` 增加 `:rw` 子挂载（UID `1001` 单写者保护）；
   - 实现 `deploy-ecs-public.sh weekend-install` / `weekend-rollback` 与 `/api/internal/revalidate` 的 `scope: "weekend"` 环回刷新。

### 2.2 Phase 1 具体改动文件清单

| 操作 | 文件路径 | 具体职责 |
|---|---|---|
| **新增** | `v2/lib/weekend/types.ts` | 定义 `WeekendPlannerSnapshot`、`XhsEvidenceNote`、`WeekendStateFile`、`VerificationStatus`（`verified \| unconfirmed \| estimated`）、`ExperienceType`、`SignalStrength` 等完整 TS 类型（与 [02-crawler-and-pipeline.md](./02-crawler-and-pipeline.md) §4.4 一致）。 |
| **新增** | `v2/lib/weekend/content.ts` | 读取 `WEEKEND_CONTENT_DIR`（默认 `/srv/nianlife-content/weekend`）`current.json` 与 `weeks/<weekId>.json`；提供 `300_000 ms` 内存缓存、`invalidateWeekendContent()`、通过 `v2/lib/time-signature.ts` `ageOn` 动态算龄；按上海当前日历日动态派生 `expired` 与「当周缺失自动降级 `unavailable`（电脑未开机/漏发兜底）」；**严禁在渲染路径发起任何网络爬虫请求**。 |
| **新增** | `v2/lib/weekend/state-store.ts` | 参照 `v2/lib/health/file-store.ts` 实现 `WeekendStateStore`（目录锁 + temp write + `fsync` + `rename`），读写 `/srv/nianlife-content/weekend/state/<weekId>.json` 及跨周共享的 `/srv/nianlife-content/weekend/state/excluded-types.json`；保存当周所选方案与出发时段、`sundayFeedback` 及 `excludedExperienceTypes`，受 `v2/scripts/lib/repo-containment.mjs` 仓库外路径校验保护。 |
| **新增** | `v2/app/api/weekend-state/route.ts` | `GET /api/weekend-state?weekId=...` 与直接放行的免口令 `POST /api/weekend-state`（解析并验证结构字段，支持所选方案与出发时段、周五微调确认、周日轻反馈、以及「不喜欢这类」新增与撤销），`dynamic = "force-dynamic"`，响应头 `Cache-Control: no-store`。 |
| **新增** | `v2/components/weekend-proposal-strip.tsx` | 首页极轻入口条（位于问候语与 Bento 照片墙之间，低高度不配大图、不推翻既有 Bento 主屏，展示本周目的地 + 住宿/天气一句摘要 + `去旅行页看看 →`；支持 `published` / `collecting` / `unavailable` / `expired_rest` 状态）。 |
| **新增** | `v2/components/weekend-plan-view.tsx` | `/travel?view=plan` 视图组件：紧凑带图标的多目的地周末天气比较条（默认可见）、3 方案实景配图精简对比卡（含信号提示、时段天气、住宿或当日提示、观察摘要与 **「不喜欢这类」按钮**）、三墩相对方位日光 SVG 小图、带真实配图与独立展开详情的 4 处季节灵感库、周日 5 选 1 轻反馈与已避开类型撤销条（无夫妻投票与微信转发弹窗）。 |
| **新增** | `v2/components/weekend-detail-view.tsx` | `/travel/weekend/[weekId]` 详情与 `?mode=live` 现场模式组件：最晚出发时限高亮卡、早/午出发实质裁剪切换、「不喜欢这类」按钮、自然中文「为什么值得出门」、折叠式「小红书怎么说」、**「住哪里」**（亚朵优先推荐+沿线对比、大床同睡、取消与停车）、实景现场图、交互式降级树（非艺术类室内优先）、底部默认折叠参考来源、现场 4 个应急按钮。 |
| **新增** | `v2/app/travel/weekend/[weekId]/page.tsx` & `v2/app/travel/weekend/weekend.css` | 周末详情路由页面（`renderOnDemand()` 动态读取）与 Daylight Canvas 样式表（零外部 Google Fonts）。 |
| **修改** | `v2/app/page.tsx` & `v2/app/home.css` & `v2/components/home-bento-sections.tsx` | 在 `<header className="canvas-greeting">` 下方、`<div className={bentoClasses}>` 上方插入 `WeekendProposalStrip`；**原封保持 `RecentAnswer` 与 `GrowthHighlightTile` 线上真实文案**；在底部 `TravelFootprintCard` 补充轻量「看看这周末准备去哪 → (`/travel?view=plan`)」副链接。 |
| **修改** | `v2/app/travel/page.tsx` & `v2/components/travel-atlas.tsx` & `v2/app/travel/travel.css` | 顶部新增 `准备去哪`（`?view=plan`）vs `已经去过`（`?view=visited`）URL 持久化分段开关；`TravelAtlas` 原封保留并在顶部增加「提案未成行不入足迹」轻说明。 |
| **修改** | `v2/lib/archive-refresh.ts` & `v2/app/api/internal/revalidate/route.ts` | `parseRefreshRequest` 新增 `scope: "weekend"`，调用 `invalidateWeekendContent()` 并 `revalidatePath` `/`、`/travel`、`/travel/weekend/[weekId]`。 |
| **修改** | `v2/Caddyfile.ecs` | 新增 `@weekendWrite { method POST; path /api/weekend-state }` 反代**直接放行**，其余路径保持只读 405。 |
| **修改** | `v2/scripts/deploy-ecs-public.sh` & `v2/scripts/ecs-swap.sh` | 新增 `weekend-install <weekId> <file>` 与 `weekend-rollback <weekId> <ver\|--withdraw>`（在宿主机用 `python3` 校验 `nianlife.weekend-planner/1`、近 30 天小红书笔记门槛、`excludedExperienceTypes` 拦截与 `totalTripBudget === null`）；在 `ecs-swap.sh` 增加 `WEEKEND_STATE_MOUNT` 读写挂载与单写者 `writers()` 检查，注入 `WEEKEND_CONTENT_DIR`。 |
| **新增** | `v2/test/weekend-content.test.mjs`<br>`v2/test/weekend-state.test.mjs`<br>`v2/test/weekend-api.test.mjs` | 覆盖 Schema 校验（直接跑过 `examples/2026-11-21.json` 与 `xhs-crawl-manifest-2026-11-21.json`）、免口令直接 `POST /api/weekend-state` 200、`excludedExperienceTypes` 添加/撤销持久化、原子锁并发写、动态算龄、零艺术类锚点与零小红书图片守卫。 |

### 2.3 Phase 1 验收标准

1. **构建与单测全部通过**：在 `v2/` 运行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run build` 零错误零跳过；`examples/2026-11-21.json` 无修改直接通过 `weekend/content.ts` 校验渲染。
2. **界面语言与视觉响应式过关**：使用 Playwright 在 `390x844` 与 `1440x900` 下实测 `/`、`/travel?view=plan`、`/travel?view=visited`、`/travel/weekend/2026-11-21` 与 `?mode=live`：
   - 首页在 `390x844` 与 `1440x900` 下完整保留既有问候语、5 块 Bento、近期日常、过去的张年与旅行足迹，只额外嵌一行轻量周末入口条且不挤压 Bento 首屏；
   - 可点击「不喜欢这类」加入已避开类型并支持随时撤销；
   - 全局用户可见 `innerText` 零命中 `ms`、`PASS`、`pending`、`.json`、`weather.com.cn`、`ctrip.com`、`6 条硬检验`、`已拦截`、`R1–R6` 与口令/鉴权字眼；
   - `scrollWidth <= clientWidth` 无横向滚动、触控按钮 `>= 44px`、零外部 `fonts.googleapis.com` 请求。
3. **ECS 部署实机验证**：
   - `deploy-ecs-public.sh caddy-reload` 后，公网对 `/api/weekend-state` 的 `GET` 与免口令 `POST` 返回 `200`，未放行路径 `POST` 仍返回 `405`；
   - `weekend-install` + `revalidate --scope weekend` 环回刷新立即生效；容器切换后 `state/` 下既有家庭表态与「我们不想要的类型」记录 100% 保留。

---

## 三、Phase 2：两阶段爬虫自动化、排除类型联动与 Webhook 提醒

### 3.1 目标与关键工程重点

1. **接入已建好的持久化登录宿主**：复用已在 `C:/Users/teddy/NianlifeOps/weekend-planner/` 创建并由 Teddy 扫码验证通过的 `browser-profile/`、`relogin.mjs`、`relogin.cmd` 与 `storage-state.backup.json`。
2. **落实两阶段抓取策略 + 排除列表联动 + 互动门槛**：
   - 启动采集前先拉取最新「我们不想要的类型（`excludedExperienceTypes`）」列表；
   - **第一阶段（开放性发现）**：只生成**不含任何具体景区/地标地名**的开放词，且主动屏蔽已排除类型关键词（如「看展 / 美术馆 / 艺术」）；
   - **第二阶段（候选地名验证）**：基于第一阶段高互动/高贴合候选生成具体地名验证词，核实交通、推车、近期实况与评论人流；
   - 校验每方案 `>= 2` 篇近 30 天真实小红书笔记且**至少 1 篇满足 `likes >= 100` 或 `comments >= 10`**；若仅低互动笔记支撑则标为 `signalStrength: "weak"`（界面标「信号较弱」）而不优先主推；一旦登录失效、遇验证码滑块或周一至周三 20:00 未开机错失窗口，发布 `status: "unavailable"` 并推 Webhook 提醒 Teddy，**绝不用官网或大模型印象凑数**。
3. **详情页 URL 清洗与逐 3 小时天气/携程实查流水线化**：自动化解析 `weather.com.cn` `var hour3data`、运行 `latestDepartureCutoff` 计算、抽取携程实价与警示、清洗所有 `verified` 来源链接至具体详情页（拒绝根首页）。

### 3.2 Phase 2 具体改动文件清单

| 操作 | 文件路径 | 具体职责 |
|---|---|---|
| **既有复用** | `C:/Users/teddy/NianlifeOps/weekend-planner/relogin.mjs`<br>`C:/Users/teddy/NianlifeOps/weekend-planner/relogin.cmd`<br>`C:/Users/teddy/NianlifeOps/weekend-planner/browser-profile/` | **已创建并由 Teddy 实机扫码验证**，Phase 2 直接作为人工 20 秒扫码重登标准入口复用。 |
| **新增** | `v2/scripts/weekend/sources-weather.mjs` | 解析 `weather.com.cn` 7d 详情页内嵌 `var hour3data` 提取周六/周日逐 3 小时天气（注意校验网页 `<title>` 地名防城代号错配，如德清 `101210204`），周五叠加 `wttr.in` 经纬度坐标接口（或可选和风天气）补全短时降水信号；内置 6h 缓存，显式禁用 `api.open-meteo.com`。 |
| **新增** | `v2/scripts/weekend/sources-xhs.mjs` | 根据 `excludedExperienceTypes` 动态生成**第一阶段开放发现词（禁地名） + 第二阶段候选地名验证词**；以 `headless: true` 串行（8–20 秒随机间隔）运行抓取；结合高赞笔记评论区交叉判定周末拥挤度；输出 `xhs-crawl-manifest-<weekId>.json` 与 `raw/<weekId>/note-*.json/.png`；不下载/输出小红书图片 URL 供前端渲染。 |
| **新增** | `v2/scripts/weekend/sources-official-ota.mjs` | 携程已登录态酒店查价（固定 `2成人+1名ageOn幼儿`、含早实价、免费取消、警示抽取，淘汰超千元/售罄，不写无来源价格区间）+ 官网 SPA 详情页抓取 + `verified` 详情页 URL 清洗器（根域名首页自动降为 `unconfirmed`）。 |
| **新增** | `v2/scripts/weekend/hard-gates.mjs` | 实现 [02-crawler-and-pipeline.md](./02-crawler-and-pipeline.md) §4.2 全部后台校验：近 30 天小红书 `>= 2` 篇准入闸 + **互动门槛（至少 1 篇 `likes >= 100` 或 `comments >= 10`）与 `signalStrength` 标定**、**`excludedExperienceTypes` 体验类型硬拦截**、无小红书硬熔断 `unavailable` 判定、6 维度检验 + Strip-Food Test、雨天非艺术室内备选优先级校验、`computeLatestDepartureCutoff`、酒店 `<= 1000` 元硬闸。 |
| **新增** | `v2/scripts/weekend/rank-and-build.mjs` | 读取 `preference-weights.json`、`excludedExperienceTypes` 与 `cooldown-venues.json`，执行加权打分与 3 槽位正交选拔（`preferred / alt_local / alt_1h`；无达标候选则输出 `status: "rest_recommended"`），调用 `ageOn("2025-01-03", satDay)` 算龄并校验 JSON Schema。 |
| **新增** | `v2/scripts/weekend/notify-webhook.mjs` | 手机轻量推送适配器（支持 Bark / 企微群机器人 / Server酱 Webhook），读取 `C:/Users/teddy/NianlifeOps/ops-daily/weekend.env`。 |
| **新增** | `v2/scripts/weekend/run-weekly.mjs` | 周度总控 CLI（`collect-init` / `verify-deep` / `build-and-publish` / `refresh-friday` / `sync-feedback`），持有独立 `weekend.lock`，启动前拉取 `state/excluded-types.json`，周五刷新先查 `state/<weekId>.json` 确保已有 `pick` 时绝不推翻重排。 |
| **修改** | `v2/scripts/editor/pipeline-status.mjs` | 扩展 `revalidate --scope weekend` 参数支持，供 `run-weekly.mjs` 调用统一 ECS 环回刷新入口。 |
| **新增（本地私有）** | `C:/Users/teddy/NianlifeOps/ops-daily/state/weekend/`<br>Antigravity 周度自动化 / Windows Task (`StartWhenAvailable`) | 初始化私有账本（`weekend.lock`、`run-ledger.json`、`preference-weights.json`、`excluded-types.json`、`cooldown-venues.json`、`auth-status.json`、`cache/`）及周一 `20:00`、周二 `20:00`、周三 `20:00`、周五 `17:30`、周日 `20:30` 调度（错开 `23:30` 与 `00:30`）。 |
| **新增** | `v2/test/weekend-hard-gates.test.mjs`<br>`v2/test/weekend-weather-parse.test.mjs`<br>`v2/test/weekend-rank.test.mjs` | 单元测试：`hour3data` 解析与 `<title>` 校核、已排除类型 `excludedExperienceTypes` 在关键词/候选/打分三级拦截、全低赞笔记标 `weak`、只有 1 篇近 30 天小红书笔记时硬淘汰、无小红书数据时输出 `unavailable`、根首页链接降标 `unconfirmed`、`cutoffTime` 公式算准、周五有 `pick` 不推翻顺位。 |

### 3.3 Phase 2 验收标准

1. **真实周度全链路冒烟**：携带已扫码 `browser-profile/` 运行 `collect-init` → `verify-deep` → `build-and-publish`，产出的周报与采集清单 100% 通过 `02` §4.5 JSON Schema 与 `tsc --strict` 校验，两阶段关键词符合「首阶段零地名 + 禁排除词」。
2. **「没有小红书依据就不推荐」熔断演练**：用空临时 Profile 模拟登录失效或模拟断网错过采集窗口运行 `build-and-publish`，验证系统绝不拿官网资料凑出推荐方案，而是输出 `status: "unavailable"` 并推送手机 Webhook 提醒。
3. **周五不推翻与「不喜欢这类」生效实测**：确认通过 `POST /api/weekend-state` 保存所选方案后周五刷新不重排；点击拉黑某体验类型后，下轮 `collect-init` 与 `rank-and-build` 自动跳过同类关键词与候选。

---

## 四、Phase 3：反馈 & 排除自动调权闭环与「准备去哪 → 真实足迹」线索转化

### 4.1 目标与关键工程重点

1. **周日 5 选 1 轻反馈 & 「不喜欢这类」同步调权**：每周日 `20:30` 拉取 `state/<weekId>.json` 与 `excluded-types.json`，按照 [01-product.md](./01-product.md) §5.4–5.5 规则幂等更新本地 `preference-weights.json` 与 `cooldown-venues.json`。
2. **成行线索只读衔接每日/月度审编**：仅生成只读 `Candidate Hint`（供每日审编会话在查验 Quark EXIF GPS 或微信日页原话时参考），自动化脚本不直改 `v2/lib/travel/trips.json`。

### 4.2 Phase 3 具体改动文件清单

| 操作 | 文件路径 | 具体职责 |
|---|---|---|
| **新增** | `v2/scripts/weekend/feedback-tune.mjs` | 拉取线上 `state/<weekId>.json` 的 `sundayFeedback` 与 `excludedExperienceTypes`，幂等调权：更新正偏好（封顶 `+25`）、处理 `went_tired` 步行上限收紧（`1.2km -> 0.8km`）、`went_pitfall` 90 天屏蔽池以及类型排除权重清零。 |
| **新增** | `v2/scripts/weekend/candidate-trip-hint.mjs` | 当 `selectedProposalId` 已被确认或 `sundayFeedback.outcome` 属 `went_*` 时，生成只读 `C:/Users/teddy/NianlifeOps/ops-daily/state/weekend/trip-hints/<weekId>.json` 供审编参考。 |
| **修改** | `v2/scripts/editor/codex-editor.mjs` | 在只读 `prepare` 阶段可选附带对应周的 `trip-hints/<weekId>.json` 线索摘要，仍需真实杭州市域外照片（`>= 3` 张）或当日已发布日页事实佐证后方更新 `trips.json`。 |
| **新增** | `v2/test/weekend-feedback-tune.test.mjs` | 验证 5 类 `outcome` 与类型排除的调权幂等性、90 天冷却屏蔽、`stayed_home` 不扣分。 |

---

## 五、明确需 Teddy 确认与配合的事项清单（本轮 C1 已按偏好去掉口令）

### 5.1 架构与生产基线变更确认（须先经 Teddy 确认后再动手改 `v2/`）

| 序号 | 确认事项 | 涉及文件 / 基础设施 | 影响范围与说明 |
|---|---|---|---|
| **C1** | **直接放行 `POST /api/weekend-state` 写接口（无口令）** | [v2/Caddyfile.ecs](../../v2/Caddyfile.ecs)<br>`v2/app/api/weekend-state/route.ts` | 按 Teddy 明确偏好，**去掉上一轮的家庭共享口令与鉴权限制**；`Caddyfile.ecs` 仅在既有只读拦截外额外对 `POST /api/weekend-state` 直接放行（不做口令或 Origin 拦阻），后端直接接受所选方案、出发时段、周日轻反馈与「不喜欢这类」排除列表写入并保存为 `/srv/nianlife-content/weekend/state/*.json`。 |
| **C2** | **ECS 只读与可写目录拆分挂载审批** | [v2/scripts/deploy-ecs-public.sh](../../v2/scripts/deploy-ecs-public.sh)<br>[v2/scripts/ecs-swap.sh](../../v2/scripts/ecs-swap.sh)<br>ECS `/srv/nianlife-content/weekend/` | 保持 `/srv/nianlife-content` 整体 `:ro` 不变，新增 `weekend-install` / `weekend-rollback`（锁 `.nianlife-weekend.lock`）；仅把 `/srv/nianlife-content/weekend/state` 设为 UID `1001` 单写者 `:rw` 子挂载。 |
| **C3** | **周度 5 时段自动化任务与本机开机约定** | Antigravity 周度自动化 / Windows Task (`StartWhenAvailable`) | 确认允许注册周一 `20:00`、周二 `20:00`、周三 `20:00`、周五 `17:30`、周日 `20:30` 五个调度窗口，并确认**每周一至周三 `20:00` 本地电脑尽量开机联网**（若未开机则按规则停发新推荐、展示「本周推荐暂未更新」并待唤醒后补采）。 |

### 5.2 Teddy 配合事项进度与可选项

| 序号 | 配合事项 | 当前状态 | 说明 |
|---|---|---|---|
| **A1** | **选定手机推送 Webhook 渠道** | **待 Teddy 选型** | 在 **Bark / 企业微信群机器人 / Server酱** 中任选其一并提供 Webhook URL（存本机 `C:/Users/teddy/NianlifeOps/ops-daily/weekend.env`），用于接收「小红书需重登 / 电脑错过采集窗口 / 周三今晚必订」提醒。 |
| **A2** | **持久化 Chrome Profile 扫码登录** | **首次已完成（2026-11-16）** | Teddy 已使用 `C:/Users/teddy/NianlifeOps/weekend-planner/relogin.cmd` 完成首次扫码；后续仅需在收到失效推送时双击该脚本用约 20 秒重登即可。 |
| **A3** | **（可选）和风天气免费个人开发 Key** | **可选（不阻塞上线）** | 当前已实测通过 `weather.com.cn` `hour3data` 逐 3 小时预报，但免费页暂缺精确降水概率 `%`；不申请则继续使用 `待周五更新 · 预估` 诚实口径。 |
| **A4** | **（可选）未确认习惯补充** | **可选（不阻塞上线）** | 午睡时刻与推车使用比例继续以 `60–90 分钟` 弹性休整窗与平缓优先生效，不阻塞任何阶段发布。 |
