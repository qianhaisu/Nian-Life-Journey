# INBOX — 给 Claude Code 的任务队列

Cowork 写这里，Claude Code 读这里并执行，结果写回 `docs/STATUS.md`。
Teddy 不必在中间转述。

## 启动方式（Teddy 只做一次）

在 Claude Code 里说一句：

> 盯着 docs/ORCHESTRATOR-INBOX.md，文件一变就读，按里面 `status: ready` 的任务从上到下执行，
> 每完成一个把它的 status 改成 done 并在 docs/STATUS.md 追加三行。

## 这条通道的边界（重要）

**它传递工作，不传递判断。**

Claude Code 遇到下面任何一种情况，**停下来问 Teddy**，不要自己决定，也不要问 Cowork：

1. **删除数据** —— 任何 raw_sources / media / 生产行的删除
2. **改生产环境变量、密钥、手动部署或回滚**
3. **force push、改写历史、删分支**
4. **会产生明显费用的外部调用**（Organizer enqueue、批量 AI 调用）
5. **产品判断** —— 页面上该出现什么、不该出现什么。今天最有价值的一次修正是 Teddy 自己打开
   2025-01 看到三张二手交易广告后说的「宁可没有照片，不要错的东西」。那不是任何一个 AI 提出来的。
6. **前提不成立** —— 任务描述与仓库/数据库现状对不上时，停下报告，不要"想办法绕过去"

**验收看数据，不看进程状态。** 2026-09-04 那轮重复导入，日志正常、`processed` 稳步增长、无报错，
实际在往库里灌 4,900 条重复。

---

## 队列

### T1 · 提交待提交的改动 — status: done

**目标**：把工作区里已完成、已验证的改动提交并推上去。Vercel 自动部署。

**内容**：
- `v2/lib/publication-moments.ts` + `test/publication-moments.test.mjs`（Cowork 改，已验证：
  `tsc --noEmit` 通过；相关测试 20/0；全量 `npm test` 改前 618 通过 4 失败 → 改后 619 通过 3 失败，
  剩余 3 个是 organizer-evidence-pipeline 和 storage-phase-2，改动前就在失败）
- `docs/STATUS.md`、`docs/ORCHESTRATOR-INBOX.md`（新文件）
- 你自己那三处导入改动（`--skip`、`--retry-failed`、`pool.on("error")` + unpooled 切换）

**硬边界**：分开提交，不要把导入改动和展示层改动混在一条提交里。工作区约 250 个 CRLF 差异不要卷进来。

**验收**：`git log` 干净分组；`origin/main` 已更新；Vercel 部署成功；打开 https://nianlife.cn/memory/2025/01
确认正文里**不再出现那三张二手交易广告**，只剩旁白 + 月末折叠档案。

**不可接受**：为了让提交通过而跳过验证；把 CRLF 差异混进提交。

---

### T2 · 主群补 3,958 条 — status: done（实际 3,912 条）

**目标**：把主群 2025-11-14 之后的约 3,958 条导进来，零重复行。

**方案**（Teddy 已定）：把 `since` 纳入 `importBatchId`。

**为什么是这条路**：`canonicalMessageId` 的输入是
`{v, conversation, sender, sentAt, type, text, attachments, documentDigest, recordOrdinal}`
（`lib/ingest/chat-import-bundle.ts:18`），**不含 `importBatchId`**——Cowork 已逐字核实，所以零重复行。
且新 `importBatchId` = 新 task 行 = `attempt` 从 0 开始，**顺带绕过 fail-closed，不必调松单调守卫，
也不必手改任何 task 字段**。

**硬边界**：
- 不要动 `chat-import-state.ts` 的单调守卫——它 2026-09-04 刚正确拦下一次异常回退
- 不要手改任何 task 的 status / attempt / 计数器
- 旧 task `0cbd0588` 保留不动。它的计数器是假的（`created=4900` 指向已删除的行），但它是那次
  fail-closed 的完整现场
- source root 是 `E:\WechatHis`（不是 `texts` 子目录）
- 绝不使用 `--max-media` / `--max-messages`：被限额跳过的媒体标记 `deferred_by_limit` 后，
  消息下次判定 reused 而永久跳过，**照片永久丢失**

**验收**：主群两个 label 合计 12,508 条，覆盖 2025-05 → 2026-08；跑
`node scripts/nianlife-status.mjs` 确认新 label 只含 2025-11-15 之后的消息；raw_sources 总数增加
约 3,958，不多不少。

**不可接受**：出现任何一条与现有 8,550 条 `(captured_at, text)` 重合的新行。

---

### T3 · 渲染性能 — status: ready（T2 跑完再开始）

**目标**：月页手机首屏 ≤3 秒。现在 3.6–5.5 秒。

**已知病灶**：`getStore()` 每次渲染发 18 条无 LIMIT 的 `select *`（8,796 行时实测 17.2 MB，
现在 31,465 行）。`raw_sources.captured_at` 和 `daily_traces.occurred_at` **没有索引**。

**做法**：加索引 + 把读取改成按月 scoped，而不是拉全库。

**硬边界**：测量期间数据库写入必须停止，否则数字是噪音。所以排在 T2 之后，不要并行。

**验收**：`/memory/2025/07`、`/memory/2026/05` 手机视口首屏 ≤3 秒，连测三次取中位数。

---

### T4 · 夸克 2,279 张入库 — status: ready（可与 T2/T3 并行，见下方并行规则）

**素材**：`C:\Users\teddy\NianlifeOps\quark-history\2026-09-03\`，2,019 照片 + 260 视频，9.8 GB，
manifest 2,279 行，全部 `status: downloaded_new`。

**三项前置**：
1. `scripts/quark-photo-init.mjs` 的 `ARTIFACT_DIR` 硬编码指向 `quark-photo-prep-20260831`
   （旧 artifact，即已入库那 107 张的来源）。**直接跑它不会发生任何事。** 要改成可配置
2. 同一文件硬编码 `AI_PROVIDER=gemini` / `MEMORY_ORGANIZER=ai` / `AI_ORGANIZER_ENABLED=true`，
   **违反「生产统一 DeepSeek」的决定**
3. **enqueue 策略未定** —— `quark-photo-apply.mjs:202` 按天一个 job，2,279 张约几百个 job；
   超预算时它照样全部入队（第 199 行 warning 自己写了），剩下的由 Vercel cron 在后台捞走。
   判官是冻结的 V6（召回接近 0）→ 最坏情况是几百个 job 在后台烧钱、产出接近零

**enqueue 策略已定（Teddy，2026-09-04）：只入库，不调 Organizer。**

- 把 `quark-photo-apply.mjs` 的 enqueue + drain 改成可关闭（新增开关，默认关；不要删除现有代码路径）
- 这一步只需要照片拿到 `family_photo` 来源身份——那是 `mediaPrivilegeOf` 里 `trusted` 的全部定义，
  也是照片进正文的唯一条件（见 `lib/family-archive.ts` 的 `mediaPrivilegeOf`）
- 零 AI 调用、零费用。等阶段 1 的 recall-first 和审阅台就绪后，再回头决定让 Organizer 看这批
- **如果你发现有任何路径仍会触发 AI 调用，停下来报告，不要"先跑跑看"**

**已知限制**：夸克 2025-03 → 2025-10 这 8 个月总共只有 20 张；307 个没有 `takenAt`，入库了也不会
出现在任何月页。

**并行规则**（Teddy 要求 T4 尽早并行）：

- T4 的**代码改造**（前置 1、2、3）随时可以做，和 T2/T3 不冲突
- T4 的**实际入库**不要和 T2 的导入同时跑——唯一的共享资源是 Neon 连接池，STATE §3 记过一次
  空闲连接掉线导致进程级崩溃，两个长任务同压会放大它。T2 跑完再开 T4 的入库
- T4 入库期间不要做 T3 的性能测量（测量需要写入静默窗口）

**已知限制**：夸克 2025-03 → 2025-10 这 8 个月总共只有 20 张，填不满那 8 个月；307 个没有
`takenAt`，入库了也不会出现在任何月页——先不入或单独处理，不要让它们无声地消失在库里。
