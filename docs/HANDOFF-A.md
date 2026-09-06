# A 轨交接稿

> **这份文档只能覆盖写，不能追加。** 它永远只描述"现在"，长度保持在 100 行以内。
> 历史在 `git log` 和 `docs/STATUS.md` 里，不在这。一个刚清空上下文的 Session 只读这一份就能接着干。
>
> 最后更新：2026-09-06 07:34 UTC · by Claude Code（A-6~A-11 全部结案，12 次空闲回读无新任务，已收工）

---

## 1 · 我是谁，我管什么

A 轨 = 写库轨。管数据管线：导入、写手、主体门、分级、月度回顾、性能、本地 worker。

**我拥有的文件**（可以随便改）
```
v2/scripts/**        v2/lib/organizer/**      v2/lib/db/**
v2/.env.local        docs/ORCHESTRATOR-INBOX.md    docs/STATUS.md    docs/HANDOFF-A.md
v2/lib/family-archive.ts   v2/lib/trusted-photo-sources.ts   v2/lib/home-view.ts
```

**B 轨拥有的，我不碰**
```
v2/components/**     v2/app/**/page.tsx       v2/app/globals.css
v2/lib/publication-moments.ts     docs/ORCHESTRATOR-INBOX-B.md    docs/STATUS-B.md    docs/HANDOFF-B.md
```

**Git**：直接在 main 上做；`git add` 只加自己的文件，**绝不 `git add -A`**；commit 前 `git pull --rebase`；
撞上 `.git/HEAD.lock`/`index.lock` 先看年龄——0 字节且超过 30 秒可以删，否则等它自己消失。
**心跳 commit 不用每次都 push**：纯 docs 心跳攒够 ~6 次或有真代码/数据变更再 push（决策 18）。

---

## 2 · 现在做到哪了（P1 全部完成，P2 的 A-6~A-11 全部结案）

**P1**：P1-0~P1-7、主体门+T20-C、信任名单图文绑定、scoped read 全部完成。
**P1-6（本地 worker）**：代码完成，`INGESTION_TOKEN` 已打通，**全量首次导入还没跑**，等 Teddy 拍板跑法。
**A-4/A-5（2025 全年回填 + 补 snapshot）**：已完成，life_events 651→1004+，16 个月 snapshot。

**A-6（痕迹层）→ A-11（昵称误判扫描）今天全部结案，详见 `docs/STATUS.md` 对应时间戳条目**：

| 任务 | 结果 |
|---|---|
| A-6 痕迹层数据 | 2025 全年 217 条 store_only 逐条判定，167→153 条标 `trace_eligible`（按标题单独读的标准重判撤销 14 条），已上线 |
| A-7 2025 年 80 条 approved 核对 | 全读完，7 条编造细节 + 1 条张冠李戴，已按 Teddy 拍板（配图支持的叙述可接受）处理：1 条撤销发布 + 1 条文本重写，其余维持原样 |
| A-8 2026 单源事件核对 | 26 条全读，6 条命中同类问题，已按同一拍板原则处理 |
| A-9 问题事件处理 | 13 条（A-7+A-8）全部处理完，两次写库都核对过实际影响行数 |
| A-10 `reviewFromRow` 根因修复 | `postgres-repository.ts`/`json-repository.ts` 不再对每行调用 `normalizeQualityDecision`；typecheck+106 单测过；Cowork 独立验收通过 |
| A-11 昵称误判扫描 | 30 条候选全核对，0 真误判，确认 2025-10-01 猫体检误判是孤例 |

## 3 · 下一件事

**先读 INBOX 顶部看板**（`docs/ORCHESTRATOR-INBOX.md`）。所有已知任务已交，等 Cowork 派新任务。

已知待做（非阻塞，等 Cowork 派或 Teddy 拍板）：
- 防复发方案（"单源+无配图才收紧写手"，已存档在 STATUS.md）3 选一等 Teddy 拍板，拍板后再单独立项动代码
- 等 Teddy 决定 P1-6 全量导入的跑法，跑完后验证 revalidate 链路
- **P1-4 视觉验收**：打开 2026-07 月页（Quark 照片最多，204 张），确认图文并排
- A-6 排除的约 6 条"敏感/负面家庭摩擦"内容没有删除，留待 Teddy/苏静决定要不要单独处理

---

## 4 · 不要再踩的坑

1. **`REPOSITORY_BACKEND` 不设会静默写进本地 JSON**（`v2/.data/nian-life.json`），终端照样打印 "WRITTEN"。写库脚本必须硬编码。
2. `organizer-month-write.mjs` 的 `--out` 必须是**仓库外**的绝对路径。
3. **匿名发言人要按"一类规则"查**，不是词表。孩子的昵称如果跟宠物/其他人重名，孤立出现在第三方转发聊天记录里时主体门可能误判——A-11 扫过一遍全库，目前只有 2025-10-01 那一条是真误判，其余候选都是"泛指名词"（转发文章里的"宝宝"）不是真的撞名。
4. **月度回顾是二次生成的**：改了 `life_events` 不会自动改 `monthly_snapshot`，删除/修改 life_event 后要重跑 `month-review.mjs --commit`。
5. **切换 `AI_MODEL` 重跑一个月，必须加 `--force`**：去重键与模型无关。
6. **flash 有时会漏掉必填数组字段**——已在 `narrative-validator.ts` 全部加 `?? []`。
7. 验收看数据，不看进程状态。"终端打印出来了" ≠ "数据库里有了"。
8. **巡检/查进度时不要用 `LIKE '%Quark%'`**：会把多个批次加在一起。
9. **T20-C 分级现在是自动的**（P1-3）：`organizer-month-write.mjs --commit` 结束时自动运行 `gradeMonthEvents`。
10. **HEAD.lock/index.lock = 0 字节且超过 30 秒未变化 = 可以删**（先等确认是否别的轨在用）。
11. **删除 life_event 要走三张表**：`source_memory_links`（life_event_id）→ `content_quality_reviews`（target_id）→ `life_events`（id），顺序反了会因外键报错。
12. **往 `content_quality_reviews` 给同一个 life_event 加"第二种标记"时，`target_kind` 绝对不能沿用 `'life_event'`**（A-6 踩过，已修复）：`indexReviews()` 按 `` `${targetKind}:${targetId}` `` 建 Map，底层查询没有 `ORDER BY`，同 key 后来的行会不确定地覆盖先来的真实 T20-C 决定。给标记用一个独立的 `target_kind`（如 `life_event_trace`），从 key 层面隔离。
13. **只有 1 条源消息的 life_event 更容易被写手编造细节**（2025: 9/25=36%，2026: 6/26=23.1%），但**配图能支持的叙述不算编造**（Teddy 2026-09-06 拍板）——只有"两头都薄"（无配图+文字只有一句话）才是真风险区。
14. **Drizzle 全表查询在某些环境会挂起**（A-10 遇到过，跟改的代码无关）：`db.select().from(table)` 不带 `LIMIT` 可能挂起不返回，`.limit(1)` 正常。遇到类似情况先怀疑环境/连接池，不要立刻怀疑自己刚改的代码。

---

## 5 · 我不能单方面做的

- 删数据、删行（要先在 STATUS.md predeclare，等 Teddy 确认）
- 改 B 轨文件（`v2/components/**`、`v2/app/**/page.tsx`、`v2/app/globals.css`、`v2/lib/publication-moments.ts`）
- 为了让数字达标而手动把 `store_only` 改回 approved
- 放宽主体门/分级阈值（收紧是可以自己判断的，放宽不行）
- 接 P1 以外的任务

---

=== A 轨已到收尾节点，可以 /clear ===
