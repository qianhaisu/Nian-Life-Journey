# Nianlife 接手评估（2026-09-04，第 2 版）

> 由 Claude（Cowork）在接手项目时写成。依据：ChatGPT 交接稿、仓库 main@5c64f0e、**生产 Neon 库只读查询**、**E:\WechatHis\texts 逐行扫描**、nianlife.cn 线上实测、WorkBuddy 夸克 staging 报告。输出中不含任何 secret 值。
> 第 2 版改动：在 Teddy 授权下连库、读环境文件、扫微信目录；新增「无文字月份的真相」；记录五项决定；计划改为从最近做到最旧；并入夸克历史素材结论。

## 一句话结论

地基扎实，书还没写出来。产品原则和证据管线都对，但线上只有 3 段 Memory。连库和扫盘后问题更清楚：**硬盘上 2025-01 → 2026-09 每个月都有文字，数据库只进了一个群、到 2025-11-14 为止。「无文字月份」全部是导入没做完，不是生活没留下。** 过去一周约 95% 精力在「不写错」，而 84% 的素材还堆在硬盘上。

## 00 · 已定的五件事（Teddy 2026-09-04）

1. Organizer 改为 recall-first + 人工审阅台；精度机制保留为对每句话的约束，不再作为「要不要出候选」的门。
2. 无文字月份默认放照片（有 takenAt 和主体即可进主阅读层）。
3. Organizer 搬到 Teddy 电脑上的本地 worker；Vercel 只做渲染和审阅台。电脑大部分日子开机。
4. 40 条测试残留暂不删除，读取层过滤。
5. Gemini / OpenAI-compatible provider 暂不删除；生产统一 DeepSeek（.env.local：AI_PROVIDER=deepseek，AI_MODEL=deepseek-v4-pro），其余不再维护。

另：数据源现阶段只有微信 + 夸克；整理与出版从最近月份做到最旧。

## 01 · 证据边界

- 已直接查询生产库（2026-09-04）：raw_sources 8,796、media_assets 1,131（archived 107 / awaiting_archive 1,024）、media 1,153、life_events 83、daily_traces 155、organizer_runs 307、organizer_jobs 13（全部 succeeded，最新 2026-08-31）、content_quality_reviews 107、chat_import_tasks 4、source_memory_links 2,826。
- content_quality_reviews：life_event approved 3 / store_only 15 / downgrade 10 / rejected 6 / needs_human_review 2 / needs_review 1；daily_trace approved 33 / store_only 25 / rejected 10 / needs_human_review 2。
- 本地 .env.local 是 2026-09-01 从 Vercel 拉的快照（VERCEL_ENV=production），其中**没有** REPOSITORY_BACKEND、ORGANIZER_V2_*、INGESTION_TOKEN、CRON_SECRET；线上明显在读 Postgres，说明快照已过时。**Vercel 当前环境变量未核对**；V2 是否已切换按仓库 9/3 cutover 文档（NOT SWITCHED）判断，需 Teddy 在 Vercel 后台确认 ORGANIZER_V2_ENABLED。
- 夸克 staging 数字引自 WorkBuddy 报告，未独立核对（C:\Users\teddy\NianlifeOps 授权弹窗超时）。
- 仓库：V2 从 2026-08-27 起 8 天 166 次提交（9/2–9/3 共 89 次）；Organizer 9,028 行、scripts 8,369 行（59 个）、tests 10,187 行（611 用例）、app+components 1,180 行；docs 27 份 364 KB（23 份为 9/2–9/3 所写）。工作区 251 个「修改」全是 CRLF 差异。

## 02 · 「无文字月份」的真相

E:\WechatHis\texts 有 9 个会话（WeFlow 导出，导出时间 2026-09-01 ~ 09-03，说明 Teddy 的持续导出已在做）。本地 vs 生产库：

| 会话 | 本地消息数（2025-01 起） | 本地覆盖 | 已入库 | 入库覆盖 |
| --- | ---: | --- | ---: | --- |
| 👶🏻张小年成长主力作战部队（群） | 12,508 | 2025-05 → 2026-08 | 8,550 | 2025-05-19 → 2025-11-14 后中断 |
| 私聊 · 阿静 | ≈19,000（全量 85,786，自 2019） | 2025-01 → 2026-09，每月 600–1,500 | 0 | — |
| 私聊 · 陈亚萍 | ≈2,800 | 2025-01 → 2026-08 | 0 | — |
| 老苏家（群） | ≈540 | 2025-03 → 2026-08，2026-05 起活跃 | 0 | — |
| 乳儿班张小年家庭群 / 张小年小群 / 亲爱的爸爸妈妈 / 温州爸妈 | 70 / 11 / 9 / 9 | 都只有 2026-09（新群） | 0 | — |
| 小雪微信群 | — | 只有 JSON 无 Markdown | 0 | — |
| （某会话 2026-02-23/24） | — | — | 99 | 来源不明小批次 |
| （测试残留 msg N <epoch>） | — | — | 40 | 全部 2026-08-31 |

chat_import_tasks 只有 4 条：100 条 canary；主任务跑到 8,550 条在 media_link 阶段被**取消**（2026-09-01）；一条 8 条后失败；一条 1 条。主群只导了 68%，其余 8 个会话没开始。交接稿「解析 53,286 条」属实，入库 8,689 条 = 16%。

**结论：** 2025-01…04、2025-12、2026-01、2026-03…07、2026-09 的「无文字」= 导入任务 9/1 取消后再未续跑；与 Organizer / 质量门无关。

两个衍生事实：
- 2026 年对话重心转移：主群从 2025-08 的 2,450 条/月降到 2026-04 的 49、2026-08 的 19；同期阿静私聊稳定 800–1,400 条/月，老苏家群 2026-05 起活跃。2026 年文字主要在私聊里，关于张年的内容粗估占 5–10%（每月 50–116 条）。importer 目前**没有 --since 参数**，导私聊前要加（按出生日 2025-01-03 过滤）；主体判断在私聊上比家庭群更关键。
- 夸克（WorkBuddy 报告）：2,279 个素材（2,019 照片 + 260 视频，9.64 GiB），连续覆盖 2025-01 → 2026-08，出生当天照片在；2025-03~10 每月仅 1–4 张（夸克侧缺口）；307 个 date-uncertain；17 个视频下载失败可重试；全部在 C:\Users\teddy\NianlifeOps\quark-history\2026-09-03\，SHA-256 manifest，0 入库。与库内 family_photo 仅 107 条（全在 2026-08）一致：照片同样是「素材在、入库没做」。

## 03 · 总体评价

做对了的：产品原则（docs/nianlife-product-principles.md 八条可作长期宪法）；工程底子（SHA-256 身份、canonical message id、checkpoint/幂等/可续跑导入器、fingerprint 身份、SKIP LOCKED 队列、fail-closed 发布）；视觉语言；2025-07 月页。

做偏了的：
- 比例失衡：Organizer 9k 行 vs UI 1.2k 行；一周 364 KB 审计；worthiness v1–v5、V6 冻结、V7 未采用、holdout 三版——而 V2 Organizer 没产出过一段家人可读的故事，且本该处理的数据 84% 还在硬盘。
- 精度高到挡住真实人生：Holdout V3 硬失败全 PASS 但 0/2 真实里程碑放行；生产 review 里 life_event 只有 3 approved。
- fail-closed 走到「把孩子藏起来」：2025-10 有 135 张张年照片，页面默认空白。
- 门禁文化变成门禁表演：「PRODUCT GATE PASSED」之后首页仍是一张照片 + 一段一年前记忆；没人检查「数据事实是不是导入没做完」。

## 04 · 设计思路

保留：Organizer/Publication 分层；证据链；同一天不证明绑定；生活时间优先；文字可无图、图可无文；导入器的 checkpoint/幂等设计。

修正：
1. 人工审阅有原则无入口（/inbox 只读、空）→ 审阅台是 Organizer 最后一级（已决定）。
2. Organizer 放在 Vercel Hobby serverless（每日 cron、5 job/次、300 s）不合适 → 本地 worker（已决定）。
3. Judgment 用真实性阈值卡住存在性 → recall-first（已决定）。
4. 私聊作为 2026 主数据源，主体判断要比家庭群更认真——这是唯一值得给 Organizer 花时间的地方。
5. 文字排版未被当成设计问题（痕迹每句一个大标题）。
6. 较小：getStore() 每次拉 17 MB；30 份带日期审计改为一份 STATUS.md。

## 05 · 对交接计划的评价

- Priority A 持续同步：问题对，但眼前最大缺口是一次性导完 9 个会话 + 2,279 个夸克素材，用现有 wechat:import（加 --since）和 quark-photo-init 即可；先存量后增量。
- Priority D/E Genesis 417：这个数字只针对已入库 8,550 条；补齐后窗口数翻几倍；按 V6 行为结果可预言。先审阅台 + recall-first。
- B 按决定不删；C 本地 worker 上线后自然发生。
- 1–4 周路线没有一条验收是「苏静读了某个月」或「把硬盘数据导完」。
- 根因：旧回路里没人同时看得到网站、数据库和硬盘；换回路而非换 prompt 格式——每轮结束网站上必须多出家人能读的东西。

## 06 · 新计划：从最近做到最旧

原则：导入不分先后、一次全导（便宜、幂等、不需人审）；整理和出版从 2026-09 往回做。2026 年主要文字在私聊，主体判断最难，先做最难的一段把 recall-first 和主体判断校准到位，往回做 2025 家庭群反而顺。

**阶段 0 · 把硬盘上的东西全部导进来（本周，2–3 天）**
importer 加 --since 2025-01-03；续跑主群（从 2025-11-14 checkpoint）；导入阿静、陈亚萍、老苏家和四个新群；小雪群看 JSON 能否用。夸克 2,279 个按 manifest 走 quark-photo-init 入库（date-uncertain 307 个先不入）。本地跑、写生产 Postgres、不 enqueue 旧 Organizer。读取层过滤 40 条残留。展示层：无文字月份默认 photo-led；月页痕迹按天成段。
验收：raw_sources 覆盖 2025-01 → 2026-09 每月；media_assets 覆盖 20 个月；首页「最近」到 2026-09；任何一个月都能看到张年；苏静看过一次。

**阶段 1 · 审阅台 + recall-first，先做 2026-09 → 2026-06（第 2 周）**
/inbox 变审阅台（按天候选 + 原话 + 照片，要 / 改一句 / 不要，写 content_quality_reviews，手机可用）。Judgment recall-first。本地把最近四个月跑成候选，每晚审 10 分钟。私聊主体判断在这四个月真实数据上校准。照片绑定在审阅台人工确认。
验收：2026-06 → 09 每月 ≥8 天文字 + ≥1 Memory；≥5 段 Memory 带人工确认照片；审一天 ≤1 分钟；无私聊候选把非张年的事写成张年。

**阶段 2 · 本地 worker；同时推到 2026-01（第 3–4 周）**
Windows 任务计划（开机 + 每几小时）：指纹目录 → 增量导入 → 本地 Organizer（DeepSeek）→ Postgres → 审阅台；夸克同 worker。Vercel 只保留渲染 + 审阅台，cron 降为兜底。2026-01 → 05 出候选并审完；补 1,024 个归档；视频 poster。
验收：只倒数据，第二天首页变化、审阅台有候选；重跑无重复；关机一周能补；2026 整年可读。

**阶段 3 · 回到 2025 年，然后是出版物质感（第 2 个月）**
2025-12 → 2025-01 逐月候选、审、发布；legacy 82 个在审阅台逐个决定。月章节图文交错；张年页真正回答「现在的张年」；2025 年度书 V1。Resurfacing / 同龄 / PDF 之后。
验收：苏静能把 2025 年从头翻到尾。

**停下：** 新的 worthiness/judgment/holdout/shadow 版本（例外：私聊主体判断校准）；每任务一份长审计 → docs/STATUS.md；Gemini/OpenAI 保留不维护；商业化、登录、多用户不做。

**协作方式：** 目标 / 硬边界 / 验收 / 不可接受结果；每次交付附生产截图 + 数据库前后对比；一个对话解决一个家人看得见的问题。

**下一步：** 阶段 0 第一件——importer 加 --since，续跑主群、导入阿静私聊到 2026-09，让首页离开 8/28。开始前请 Teddy：在 Vercel 后台确认 ORGANIZER_V2_ENABLED 是否设置；如需核对夸克 manifest，给 C:\Users\teddy\NianlifeOps 只读权限。
