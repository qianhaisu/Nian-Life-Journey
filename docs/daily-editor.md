# Nianlife 每日内容更新规范

2026-10-12 项目约定：内容更新不再调用智谱或 DeepSeek，改由模型会话直接读原始来源、审片、写稿与核验。
2026-11-11 起由 Antigravity 统一负责整条自动化链路与内容品质（不再依赖需保持前台打开的旧 Claude 桌面定时任务）。
2026-11-12 升级：安装《张年成长记 · 写作与编排准则（第二版）》（`v2/scripts/editor/STYLE.zhang.md`），写稿前强制目视看图，编辑管线支持段落照片锚定（`paragraphMedia`）、首屏图注（`photoCaptions`）与每日精选引语（`featuredQuote`）。

## 自动化双阶段架构

每日更新拆分为**原始资料同步**与**会话审编安装**两段独立幂等任务，状态统一写入本机私有账本 `C:/Users/teddy/NianlifeOps/ops-daily/state/`（不进 Git 仓库）：

1. **23:30（Windows 计划任务 `Nianlife WeChat Daily Sync`，已禁用旧 `Nianlife Nightly Editor`）**：
   - 入口：`v2/.data/daily-wechat-sync.cmd`（已开启 `WakeToRun`、`StartWhenAvailable`、`MultipleInstances=IgnoreNew`、防重入 PID 锁 `sync.lock`、防休眠锁 `--prevent-sleep`、SSH 隧道自愈重连、失败重试 `--retries 2` 及真实退出码记录）。
   - 执行 `t35-archive-exports.mjs` 归档 WeFlow 导出并检测上游水位是否滞后，再通过 `t20-run-env.mjs` 运行 `nianlife-worker.mjs --since-days=21 --content-dedupe --no-organizer --no-review --no-revalidate` 将新增聊天与媒体写入阿里云 RDS 与阿里云 OSS（强制 `MEDIA_STORAGE_PROVIDER=oss` 并剥离继承环境中的 `R2_*`，严禁 R2）。
   - 完成后调用 `scripts/editor/pipeline-status.mjs record-sync` 记录 `last-sync-run.json`（含归档阶段异常）。

2. **00:30（Antigravity 定时自动化 `Nianlife 每日内容更新`）**：
   - 每天北京时间（`Asia/Shanghai`）00:30 启动独立会话，按下方标准流程完成健康巡检、私密照片目视审核、待编来源导出、写稿前强制看图、非虚构写稿与照片锚定、`apply --literary` 强校验、ECS 原子安装、缓存刷新与账本回执。

---

## 每次审编执行流程

1. **检查全链路水位与互斥锁**
   - 在 `v2` 目录运行：
     `node --import tsx scripts/editor/pipeline-status.mjs inspect --lookback-days 14 --json`
     （若需经受控隧道包装器运行，注意 `t20-run-env.mjs` 内部已自动附带 `node --import tsx`，应直接传脚本路径：`node .data/t20-run-env.mjs -- scripts/editor/pipeline-status.mjs inspect --lookback-days 14 --json`）。
   - 核实 WeFlow 上游导出水位（`maxExportedDay`）、RDS 消息水位（`rdsWatermarkDay`）、OSS 媒体状态（`r2MediaCount === 0`）及未覆盖日期分类（`published`、`skipped_no_material`、`blocked_upstream_export`、`failed_infra`、`pending_editorial`）。
   - 若 `rdsWatermarkDay` 落后于 `maxExportedDay`（且 `sync.lock` 未被占用），先补跑 `cmd.exe /c C:\Users\teddy\Documents\Nianlife\v2\.data\daily-wechat-sync.cmd`。
   - 若上游微信未导出或网络/隧道/程序异常，必须如实记为 `blocked_upstream_export` 或 `failed_infra`（`pipeline-status.mjs record-editorial --failed <day>:<stage>:<code>`），**严禁将基础设施或程序失败永久标成当日无素材（`no_qualifying_material` / `skipped_no_material`）**。

2. **私密照片目视审核与按日选片（零外部模型）**
   - 新导入微信照片默认 `visibility = 'private'`。当 `photoReview.unreviewedCount > 0` 或 `approvedButPrivateCount > 0` 时运行：
     `node --import tsx scripts/editor/session-photo-review.mjs prepare --since <起始日> --out <本次私有目录>/photo-review`
   - 会话使用 `read_file` 直接逐张查看生成的编号缩略图联版（`sheets/sheet-*.jpg`），依据儿童隐私原则拦截裸露、洗澡、如厕训练局部、证件、账单、地址门牌、病历、纯截图与无关画面，写出私有 `verdicts.json`。未成功下载缩略图的候选严禁默认放行。
   - 运行 `node --import tsx scripts/editor/session-photo-review.mjs apply --out <本次私有目录>/photo-review --verdicts <verdicts.json>` 在同一数据库事务中写入 `content_quality_reviews`（`provider = 'antigravity'`）并将通过审核的照片设为 `visibility = 'family'`。
   - 运行 `node --import tsx scripts/editor/session-photo-review.mjs curate --from <起始日> --until <今日> --out <本次私有目录>/photo-review/day-media.json` 按 90 秒连拍折叠选出每日 `firstScreenMediaIds`（最多 6 张）与 `expandedMediaIds`。

3. **导出待编原始来源包**
   - 运行：
     `node --import tsx scripts/editor/codex-editor.mjs prepare --out <本次私有目录>/editorial --lookback-days 14`
   - 工具只读 RDS 与线上 `/srv/nianlife-content/*.json`，导出未覆盖日期、证据指纹及每日已审核媒体池（`dayMedia`）。重写历史旧稿时显式传入 `--rewrite-days <YYYY-MM-DD,...>`（人工稿 `_source = "human"` 受保护不可覆盖，旧稿连同旧版照片锚定/图注/引语自动归档至 `_revisions`）。

4. **写稿前强制看图（目视查看当天已审核照片联版）**
   - **硬性前置步骤**：只要当天有已审核照片，严禁只读文字消息盲写。运行按日看图联版子命令（纯只读，支持日常更新与批量重写）：
     `node --import tsx scripts/editor/session-photo-review.mjs day-sheets --source-pack <本次私有目录>/editorial/source-pack.json --out <本次私有目录>/day-sheets`
     （批量重写也可加 `--days <d1,d2>` 或 `--all-expanded`。）
   - 工具自动遵循 `STYLE.zhang.md` 第三节规则：**加载当天全部 `firstScreenMediaIds` 照片；当首屏照片不足 4 张时，自动连同 `expandedMediaIds` 一起生成联版**，在每格顶部清晰标注 `[首屏 N]` / `[展开 N]`、拍摄时刻、尺寸/时长与精确 `mediaId`，输出至 `<本次私有目录>/day-sheets/sheets/<YYYY-MM-DD>*.jpg` 与 `day-sheets.json`。
   - 会话必须使用 `read_file` 逐日打开对应的联版图片，观察真实场景/器物、小年的动作姿态、神情视线以及画面中已确认身份的家人（未核实的成人只写动作或省去，绝不猜身份），确定每张照片锚定到哪一段，并构思不超过 20 字的场景图注。

5. **家庭非虚构写稿、照片锚定与 `apply --literary` 强校验**
   - 严格遵循 `v2/scripts/editor/STYLE.zhang.md`（第二版）逐日阅读全部原始消息与 `real-names.private.json`（仅核对脱敏禁词，严禁外泄成人真实姓名），结合目视看图结果撰写私有 `decisions.json`（必要时附 `month-meta.json` 更新月度 `coverMediaId`、`homeHeroMediaId`、`cardLine`、`intro`）。
   - 只有当天原始消息确实不含小年具体事实时，才可使用 `decision: "skip"` 并写明具体 `reason`；账本会绑定当日 `evidenceFingerprint`（含可读消息与已审核照片），一旦后续补进新导出消息或照片，该日会自动重开为 `pending_reopen`。
   - **决策文件 `decisions.json` 结构示例**（向后兼容旧结构，写稿型决策支持 `paragraphs[i].mediaIds`、`photoCaptions`、`featuredQuote`）：
     ```json
     [
       {
         "day": "2026-07-18",
         "decision": "write",
         "kind": "story",
         "emphasis": "lead",
         "title": "草坪水池里的球",
         "paragraphs": [
           {
             "text": "下午草坪上支起充气水池，小年坐进浅水里，两手抓着彩色塑料球往水面上按。",
             "sourceIds": ["src-101", "src-102"],
             "mediaIds": ["media-photo-01", "media-photo-02"]
           },
           {
             "text": "奶奶说「宝宝很喜欢水」，爷爷补了一句「必须点赞」。",
             "sourceIds": ["src-103", "src-104"],
             "mediaIds": ["media-photo-03"]
           }
         ],
         "photoCaptions": {
           "media-photo-01": "午后坐进草坪充气水池抓彩球",
           "media-photo-02": "低头拍打水面溅起水花",
           "media-photo-03": "湿着头发靠在池边歇气"
         },
         "featuredQuote": {
           "text": "宝宝很喜欢水",
           "speaker": "奶奶",
           "sourceId": "src-103"
         }
       }
     ]
     ```
   - **产出的月度内容 JSON 新增字段**（旧数据缺省时前端平滑降级）：
     - `days[i].paragraphMedia?: string[][]`：与 `paragraphs: string[]` 按下标一一对齐的段落锚定照片 ID 数组；
     - `days[i].photoCaptions?: Record<string, string>`：`mediaId -> 图注`（每条去首尾空白后 `1..20` 字）；
     - `days[i].featuredQuote?: { text: string; speaker: string; sourceId?: string }`：当天至多 1 条逐字核验原话，供首页「家人的话」与日页消费；
     - `homeHeroMediaId?: string`（月度顶层可选字段，由 `--month-meta` 维护）。
   - 运行 `node --import tsx scripts/editor/codex-editor.mjs apply --out <本次私有目录>/editorial --decisions <decisions.json> --literary [--month-meta <month-meta.json>]`，强制执行以下硬校验：
     - **来源与指纹**：数据库来源存在性与文本 SHA-256 指纹未变；
     - **引语逐字与数量上限**：直角引号 `「…」` 与弯引号 `“…”` 逐字子串核验、同句说话人归属（含句末 `。」` 跨句边界识别）；全篇引语不超过 4 处，单段引语不超过 2 处；
     - **人物与隐私红线**：仅允许已登记家庭/老师称谓，拦截含糊指人「大人」，零成人真实姓名；成人医疗、证件、密码、地址门牌、外伤磕碰、排泄细节、财务金额与工程技术字样全面拦截；
     - **时间与跨日断言**：时间词与引用消息发送时段一致；无原消息依据不得在叙述中断言「第一次」「终于」「比以前」；
     - **第二版文风红线**（引号与书名号以外的叙述文字）：
       - 禁照片说明书腔（`照片里|画面中|镜头里|视频里|有一张|一张里|另一张里|这张照片`）；
       - 禁微信群聊转播腔（`分享了一段视频|发来…照片/视频/消息/一段/几张|又发来|陆续发来|传来好消息|在群里说|家人群里聊起|有一条留言写道|通话时长` 及叙述中的 `点赞`）；
       - 禁编辑旁白（`这里把|不必写成|值得记下的是`）；
       - 禁育儿套话（与 `STYLE.zhang.md` 第五节 17 条清单完全同步）、禁第二人称「你」、禁四段及以上按钟点报流水账；
     - **照片锚定与图注硬门槛**：
       - 当天 `firstScreenMediaIds` 不为空时，**至少一段必须有非空 `mediaIds`**（且所有 `mediaIds` 必须属于当天已审核媒体池，同一张照片不可重复锚定到多段）；
       - 当天**每张 `firstScreenMediaIds` 照片都必须有非空 `photoCaptions[mediaId]`**，每条不超过 20 字、不得直接重复当天标题，且同样通过隐私、真实姓名、技术字样、照片说明书腔与引语逐字核验；
       - 若填写 `featuredQuote`，必须通过当天原消息逐字子串核验与已登记说话人归属核验。

6. **版本化原子安装、缓存刷新与账本回执**
   - 显式调用 Git Bash（不可误用 WSL `C:\Windows\System32\bash.exe`）执行原子安装：
     `"C:\Program Files\Git\bin\bash.exe" -lc 'ECS_SSH=ecs-user@47.99.243.155 ECS_KEY=/c/Users/teddy/.ssh/nianlife-prod-ecs.pem ./scripts/deploy-ecs-public.sh content-install <YYYY-MM> <candidate.json> <expectedRevision>'`
     将候选文件安装到 `/srv/nianlife-content/versions/` 并原子切换软链（带 `flock` 与版本比较保护，保留完整历史版本供 `content-rollback` 回退；应用代码容器绝不自动重新部署）。
   - 运行 `node --import tsx scripts/editor/pipeline-status.mjs revalidate --scope archive`（由于公网 Caddy 拦截 `/api/internal/*`，该子命令通过 SSH 在 ECS 容器环回地址 `http://127.0.0.1:3000/api/internal/revalidate` 内部触发刷新，零密钥传输或日志暴露）立即清理 Next ISR 与内存档案缓存。
   - 运行 `node --import tsx scripts/editor/pipeline-status.mjs record-editorial --decisions <decisions.json> --receipt <本次私有目录>/editorial/review-receipt.json` 将成文与跳过结论连同实时 RDS `evidenceFingerprint` 写入 `editorial-ledger.json`。
   - 直接请求线上月页与日页核对标题、正文、段落配图与图注渲染，不以单纯 HTTP 200 代替内容核验；最后再次运行 `node --import tsx scripts/editor/pipeline-status.mjs inspect --lookback-days 14 --json` 确认 `overallHealthy === true`。

---

## 其它模块与标识约定

- **旅行 / 提醒 / 首页轮播 / 健康**：与 `AGENTS.md` 权限原则一致。不运行任何旧 GLM / DeepSeek 脚本；普通日常更新不改动健康私有账本，也不执行 `deploy-ecs-public.sh swap` 应用容器发布。
- **历史标识保持兼容**：`codex-editor.mjs`、`_source = "codex"` 是既有数据结构中的历史字段名，保持不变以确保前后端与校验器完全兼容。
