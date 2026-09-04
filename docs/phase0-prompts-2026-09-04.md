# 阶段 0 · 给 Claude Code 的执行提示词（2026-09-04）

编排：Claude (Cowork)。执行：Claude Code（在 C:\Users\teddy\Documents\Nianlife 本地跑）。
格式按 Teddy 的要求：Goal / 硬边界 / 验收 / 不可接受，不给机械施工单。

## 所有 session 的共用前提

- 仓库唯一 worktree、始终在 main；直接 commit + push main，不新建分支。
- **工作区有 251 个文件显示为 modified，全部是 CRLF/LF 换行差异，不是真实改动。** HEAD 存的是 LF，工作区是 CRLF。提交前把你改过的文件转回 LF，否则一个 13 行的改动会变成 384 行的 diff。
- 有 3 个 commit 已提交未 push（96417a5、83b9001、9db477c），先 `git push origin main`。
- `.git` 下有一些 `*.stale-*` 文件是我留下的（我这边删不掉），可以直接删。
- **ORGANIZER_V2_ENABLED 在生产是开着的**，判官是冻结的 V6，精度极高、召回接近 0。任何 enqueue organizer job 的操作都会走 DeepSeek 付费调用，且大概率只产出 store_only。阶段 0 不要触发它。
- 生产库当前真值（2026-09-04 实测）：raw_sources 8,796 / media_assets 1,131（archived 107、awaiting_archive 1,024）/ life_events 83 / daily_traces 155 / content_quality_reviews 107。写入前重新核对，不要拿这些数字当实时事实。
- 隐私红线：日志、终端输出、commit message 里不得出现任何聊天内容、家庭成员原话、文件路径中的人名。

---

## 提示词 1 · 微信全量导入（长时间运行，先跑这条）

```
目标：把 E:\WechatHis 里张年出生（2025-01-03）之后的全部微信消息导入生产 PostgreSQL。

现状（已核实，不要重新考古）：
- 硬盘上 9 个会话，出生日之后共 35,177 条消息；生产库里只有 8,689 条，来自 1 个会话（主群），
  停在 2025-11-14，因为 9 月 1 日那次导入任务被取消后没人续跑。
- 2026 年的家庭文字主要在私聊里：主群 2026-08 只剩 19 条/月，而阿静私聊每月 800-1,400 条。
- 仓库里已有 `npm run wechat:import-all`（v2/scripts/wechat-import-all.mjs），会逐会话导入、
  可中断可续跑，状态记在 v2/.data/wechat-import-all-state.json。

硬边界：
- **source root 必须是 `E:\WechatHis`，不是 `E:\WechatHis\texts`。** 消息身份包含
  documentDigest = sha256(相对路径)；换一个根，已导入的 8,550 条会全部变成重复行。
  已验证：现有行的 documentDigest 对应相对路径 `texts/<会话目录>/<会话>.md`。
- REPOSITORY_BACKEND=postgres，DATABASE_URL 从 v2/.env.local 读，不要打印它们的值。
- **不要用 --max-media 或 --max-messages 压缩单次工作量。** 被限额跳过的媒体不会补回来：
  消息下次运行会被判定为 reused 而跳过，它的照片永久丢失。要么整条会话完整导入，要么不导。
- 不要 enqueue Organizer（微信 worker 本身不会 enqueue，别自己加）。
- 不删除任何行，不改生产环境变量，不 force push。
- 中途可以 Ctrl+C；重跑靠内容身份去重，不会产生重复。
- 有一个 task e54410c2 卡在 running 但租约已过期，重跑会自动接管，不要手动改它的状态。

验收：
- raw_sources 覆盖 2025-01 → 2026-09 每一个自然月，无空洞。
- 总量从 8,796 增长到约 35,000（预期新增约 26,600 条）。
- 每个会话的 chat_import_tasks 最终状态是 completed 或 completed_with_warnings。
- 幂等复核：跑完后再跑一次，created 全部为 0、reused 等于总量。
- nianlife.cn 首页「最近」离开 2026-08-28（数据库和线上共用一个库，不需要部署）。

不可接受：
- 同一条消息出现两个 raw_source id。
- 任何媒体被静默跳过而没有出现在 warningCounts 里。
- 为了跑完把 --since 往后挪，或缩小媒体范围。
- 在日志里打印任何聊天内容。

最终报告写清：每个会话的 created/reused/媒体数、覆盖到哪个月、还有什么没导进来。
```

---

## 提示词 2 · 夸克历史素材入库（在提示词 1 之后）

```
目标：把 WorkBuddy 已经下载并 staging 的夸克历史照片/视频入库，让 2025-01 → 2026-08 的月份有
真实照片可以出版。

现状（来自 WorkBuddy 的 session 报告，**未经我独立核实，你要先自己验证**）：
- 位置：C:\Users\teddy\NianlifeOps\quark-history\2026-09-03\
- 2,279 个素材（2,019 照片 + 260 视频，9.64 GiB），带 SHA-256 manifest
  （manifests/quark-history-manifest.jsonl），连续覆盖 2025-01 → 2026-08 共 20 个月。
- 307 个 date-uncertain（严格标 UNKNOWN，不要强行归月）；17 个视频下载失败可重试。
- 生产库里目前只有 107 张 family_photo，全部在 2026-08。

先做验证，再做设计：manifest 是否完整、SHA-256 是否可复算、仓库里现成的入库路径
（v2/scripts/quark-photo-init.mjs 等）能不能直接消费这批 staging 文件，而不是另起一条链路。

硬边界：
- **SHA-256 是永久身份，fid / check_link / 夸克路径都不是。** 服务端持久化前必须独立重算并核对
  SHA-256，不得信任 manifest 里的值。
- **入库前先确认这条路径会不会 enqueue Organizer job。** 我已核实 lib/ingest/quark.ts 和
  scripts/quark-photo-apply.mjs 都调用 enqueueOrganizerJob；生产的 ORGANIZER_V2_ENABLED 是开的，
  2,279 个素材可能触发大量 DeepSeek 付费调用。阶段 0 不要组织，只要入库——
  如果现成路径必然 enqueue，先停下来报告，不要擅自改判官或绕过队列。
- date-uncertain 的 307 个先不入库，或入库但不赋予 takenAt，绝不猜测月份。
- 不移动、不删除、不重命名 NianlifeOps 下的原始文件；那是仓库外的 staging，不要提交进仓库。
- 媒体走 repository/object-storage 策略，禁止把临时外链当永久地址。

验收：
- media_assets 覆盖 2025-01 → 2026-08，每个月的数量与 coverage-gap 报告一致（或差异有解释）。
- 随机抽 10 个入库素材，用原始文件重算 SHA-256 与库里的 checksum 一致。
- 重跑一次，零重复插入。
- 至少 3 个原本没有照片的月份，在 nianlife.cn 上能看到照片。

不可接受：
- 用 fid 做幂等键。
- 给 date-uncertain 的素材编造日期。
- 为了入库而触发几千个 organizer job。

最终报告写清：入库了多少、按月分布、date-uncertain 怎么处理的、有没有触发 organizer。
```

---

## 提示词 3 · 月页排版：痕迹按天聚成正文（可与提示词 1 并行）

```
目标：月页现在把每一条痕迹都用标题字号平铺，一天三条大字堆在一起，读起来像日志不像书。
改成一天一段、可以从头读到尾的正文。

参考现状：打开 nianlife.cn/memory/2025/07（12 天真实文字，目前最接近成品的月页），
每条痕迹是独立的大字块，「家人说」反复出现。目标是让这一个月能被当成一章读完。

产品原则以 docs/nianlife-product-principles.md 为准，动手前先读。

硬边界：
- 只动 presentation 层：components/*、app/**/page.tsx、app/globals.css。
- 不改 lib/publication-moments.ts 的选择逻辑（它决定什么出现，不决定怎么排版），
  不改 organizer，不改 schema，不碰 repository。
- 不为了排版好看而改写、合并或省略家人的原话；文字是证据，不是素材。
- 不给纯文字的日子补图（这是长期 invariant）。
- 验证必须用真实数据：REPOSITORY_BACKEND=postgres，不要用 mock 或 fixture 下结论。
- 桌面和移动端（390×844、430×932）都要逐屏看过，不能只靠 unit test 宣布完成。

验收：
- 2025-07 读起来是一段一段的生活，不是标题列表。
- 2025-08、2025-06 同样成立（不同的文字密度）。
- 无文字月份（2025-09/10/11）的照片版式没有被这次改动破坏。
- typecheck / 相关 test / lint / build 绿。

不可接受：
- 把痕迹文字改写成统一 AI 文风。
- 为了版面整齐而丢掉某些天。
- 只在桌面端验证就说完成。
```

---

## 提示词 4 · 测试残留在读取层过滤（可与提示词 1 并行）

```
目标：生产库里有一批测试残留 raw_source（内容形如 `msg N <epoch>`，全部 captured_at 在
2026-08-31，分布在 4 个合成会话 label 下，共 40 条）。Teddy 明确决定**不删除**它们，
要在读取层过滤掉，避免它们污染 activityDay 和首页 recency。

硬边界：
- **不 DELETE、不 UPDATE 任何行。** 只在读取/组合层排除。
- 过滤规则必须精确到这批合成数据，不能用宽泛的 LIKE 或按日期一刀切——
  2026-08-31 附近可能有真实消息，误伤了就是把真实生活从档案里抹掉。
- 先证明这 40 条的确切身份（id、source_label、内容形态），再写过滤。
- 要有测试锁住这个行为，并且测试要同时证明「真实消息不被误伤」。

验收：
- 首页 recency / activityDay 不再受这 40 条影响。
- 列出被过滤的 40 条 id，以及确认没有第 41 条被误伤的证据。
- typecheck / test 绿。

不可接受：
- 删除或修改生产行。
- 用 `text LIKE 'msg %'` 这种可能命中真实消息的规则而不加额外约束。
```

---

## 提示词 5 · 渲染性能：索引 + scoped read（建议在提示词 1 之后）

```
目标：页面渲染不再全量拉库。

现状（已核实）：lib/db/postgres-repository.ts 的 assembleStore() 发出 18 条无 LIMIT、
无列裁剪的 select *，实测 18,042 行 / 17.2 MB，其中 raw_sources 占 67%。每次触及
getStore() 的页面渲染都要付这个代价。导入完成后 raw_sources 会涨到约 35,000 行，
这个数字会翻倍。raw_sources.captured_at 和 daily_traces.occurred_at 都没有索引，
而几乎每个 organizer / window 查询都按它们排序。

硬边界：
- 加索引是 additive，可以直接做；不改 schema 语义、不删已有索引。
- scoped read 路径已经存在（scopeStoreToProfile / getHomeEvents / getAllEvents），
  优先复用，不要在旁边另起一条平行链路。
- 不改 repository 契约测试的语义；contract test 必须继续全绿。
- 测量要用真实数据，给出改动前后的实测数字，不要用「应该会更快」这种说法。

验收：
- 首页和月页渲染不再触发 raw_sources 全表读取（用实际查询计划或日志证明）。
- 给出渲染耗时的前后对比（真实生产数据）。
- typecheck / test / lint / build 绿。

不可接受：
- 为了性能牺牲 profile scoping（rows another profile owns 绝不能出现在家庭页面）。
- 用缓存掩盖全量读取而不解决它。
```

---

## 并行建议

- **提示词 1 是长时间运行的（几小时），单独一个终端跑，只写数据库。**
- 提示词 3、4 只写仓库，可以在另一个 session 与 1 并行；但 3、4、5 之间要串行
  （同一时间只能有一个 session 对仓库做写操作）。
- 提示词 2、5 建议等 1 跑完，因为它们依赖导入后的真实数据量。

## 阶段 0 完成的标准

打开 nianlife.cn 的任何一个月都能看到张年（有文字读文字，没文字看照片）；
首页「最近」是 2026-09；苏静看过一次并说了一句话。
