# A 轨交接稿

> **这份文档只能覆盖写，不能追加。** 它永远只描述"现在"，长度保持在 100 行以内。
> 历史在 `git log` 和 `docs/STATUS.md` 里，不在这。一个刚清空上下文的 Session 只读这一份就能接着干。
>
> 最后更新：2026-09-06 02:1x · by Claude Code（A-6 完成，等 Cowork 抽读验收）

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
撞上 `.git/HEAD.lock` 先等 30 秒；0 字节锁超过 30 秒可以删。

---

## 2 · 现在做到哪了

**P1-6（本地 worker）**：
- `nianlife-worker.mjs` Phase 5 已接上 `/api/internal/revalidate`（Bearer INGESTION_TOKEN），
  失败只记日志不让 worker 非零退出。新增 `--since`/`--max-messages`/`--limit`/`--no-state-update`
  仅供手动 bounded 测试用，定时任务不带参数=原行为不变。
- `E:\WechatHis` 已有 Teddy 导出的真实数据。跑过 bounded 测试（50 条最近消息）验证四阶段全部
  正常，幂等性没问题。**全量首次导入还没跑**（主群 conversation 7,244 条消息是大头，5万条仅
  入库16%里剩下的部分）——等 Teddy 决定手动跑一次（数小时）还是挂 Task Scheduler 03:00 定时
  任务靠增量消化。**`INGESTION_TOKEN` 已打通**（2026-09-06，Teddy 已分别填进 Vercel 和
  `.env.local`，Cowork 验证 POST /api/internal/revalidate 返回 200），下次 worker 跑
  revalidate 阶段不会再跳过。

**A-4（2025 全年回填）已完成（2026-09-06）**：
- 2025-01~12 十二个月全部过了 T7 管线（dry-run --max-calls=400 → 抽读 → commit → T20-C 自动
  分级 → `t18-backfill-media-binding.mjs --commit` → `month-review.mjs --commit`）。
- life_events 从接近 0 涨到 651 条。8 个月（01/04/07/08/09/10/11/12）有完整月度回顾快照；
  4 个月（02/03/05/06，新生儿期消息量本来就少）按既有 <5 事件阈值规则停在 quiet index，
  没放宽标准凑数。实测 `curl nianlife.cn/memory/2025/12` 200，能看到真实记忆文字。
- **过程中发现并修复一个真实主体门误判**：2025-10-01 有一条把两只家猫（其中一只也叫"年年"，
  跟孩子昵称撞了）的兽医体检报告错判成孩子看兽医。Teddy 确认后删除（source_memory_links →
  content_quality_reviews → life_events 级联删，435→434）、重跑该月 month-review。**根因未修**：
  `subject-gate.ts` 遇到"孤立昵称 + 转发的第三方宠物医院聊天记录"这种组合仍可能误判，这次是
  人工抽读发现的，不是系统挡住的。全库按宠物/兽医关键词扫描过，确认只此一条，但不能排除别的
  月份里还有没被抽到的同类问题。**下一个 session 建议专门做一次全库"孤立昵称+第三方转发聊天"
  模式扫描**（不限于猫，任何跟孩子昵称撞名的人/宠物都有风险）——这属于收紧 subject-gate 判断
  逻辑，是产品判断，不要在别的任务里顺手改。

**A-5（补 4 个月 monthly_snapshot）已完成（2026-09-06）**：
跑了 `month-review.mjs --month=2025-0{2,3,5,6} --commit`，四个月判官日志一致：已发布
（published）life_event 分别只有 4/3/2/1 条，均低于 5 条阈值，脚本在写库前就退出——
`monthly_snapshot` 仍是 16 个月，**没有新增，是既有规则正常生效，不是遗漏**。
INBOX 给的 23/14/11/13 是这四个月 life_events 总数（含大量 low 级 not-about-child），
不是已发布数，两者不是一回事。这四个月页面上仍能看到当月 life_event 列表，只是没有独立的
月度回顾摘要。

**其余 P1 状态**：P1-0（2026-01~05）✅、P1-1（conversationId 稳定性）✅、P1-2b（HEIC 1,260 张
入库）✅、P1-3（主体门+T20-C）✅、P1-4（信任名单制图文绑定）✅代码完成，视觉验收未做、
P1-5（scoped read）✅。

---

**A-6（痕迹层数据，2025 全年）已完成（2026-09-06）**：
- 217 条 2025 store_only life_events **逐条读完判定**，167 条标为「可展示痕迹」，写进
  `content_quality_reviews`（`provider='cowork-a6'`、`decision='trace_eligible'`、
  `prompt_version='a6-trace-layer-v1'`，纯新增行，不改任何现有 approved/store_only 判定）。
  B 轨读取：`target_id=<life_event.id> and provider='cowork-a6' and decision='trace_eligible'`
  存在即可展示为痕迹。脚本：`scripts/a6-export-store-only.mjs`（只读导出）+
  `scripts/a6-trace-layer-write.mjs`（写库）。每月数字和 2025-06 全表逐条判定见
  `docs/STATUS.md` 2026-09-06 02:07 UTC 条目。等 Cowork 抽读验收。

## 3 · 下一件事

**先读 INBOX 顶部看板**（`docs/ORCHESTRATOR-INBOX.md`）。A-6 已交，等验收结果。

已知待做（非阻塞，等 Cowork 派或 Teddy 拍板）：
- 等 Teddy 决定 P1-6 全量导入的跑法，跑完后验证 revalidate 链路真的让 nianlife.cn 秒级更新
- **P1-4 视觉验收**：打开 2026-07 月页（Quark 照片最多，204 张），确认 Quark 照片和文字并排
- 建议：全库"孤立昵称+第三方转发聊天记录"模式扫描（见上，subject-gate 收紧，需要单独立项）
- A-6 排除的约 6 条"敏感/负面家庭摩擦"内容（育儿嫂怠慢嫌疑、父母因钱起争执等）没有删除，
  留待 Teddy/苏静决定要不要单独处理，不属于这次痕迹层范围

---

## 4 · 不要再踩的坑

1. **`REPOSITORY_BACKEND` 不设会静默写进本地 JSON**（`v2/.data/nian-life.json`），终端照样打印 "WRITTEN"。写库脚本必须硬编码。
2. `organizer-month-write.mjs` 的 `--out` 必须是**仓库外**的绝对路径。
3. **匿名发言人要按"一类规则"查**，不是词表。同理，**孩子的昵称如果跟宠物/其他人重名，孤立出现在第三方转发聊天记录里时主体门可能误判**（2025-10-01 的猫体检报告就是这样）——抽读时留意这类内容。
4. **月度回顾是二次生成的**：改了 `life_events` 不会自动改 `monthly_snapshot`，删除/修改 life_event 后要重跑 `month-review.mjs --commit`。
5. **切换 `AI_MODEL` 重跑一个月，必须加 `--force`**：去重键与模型无关。
6. **flash 有时会漏掉必填数组字段**——已在 `narrative-validator.ts` 全部加 `?? []`。
7. 验收看数据，不看进程状态。"终端打印出来了" ≠ "数据库里有了"；抽读时打开真实月度回顾草稿看内容，不能只看 written 数字。
8. **巡检/查进度时不要用 `LIKE '%Quark%'`**：会把多个批次加在一起。
9. **T20-C 分级现在是自动的**（P1-3）：`organizer-month-write.mjs --commit` 结束时自动运行 `gradeMonthEvents`。
10. **HEAD.lock = 0 字节且超过 30 秒未变化 = 可以删**（先等 30 秒确认是否别的轨在用）。
11. **删除 life_event 要走三张表**：`source_memory_links`（life_event_id）→ `content_quality_reviews`（target_id）→ `life_events`（id），顺序反了会因外键报错。

---

## 5 · 我不能单方面做的

- 删数据、删行（要先在 STATUS.md predeclare，等 Teddy 确认）
- 改 B 轨文件（`v2/components/**`、`v2/app/**/page.tsx`、`v2/app/globals.css`、`v2/lib/publication-moments.ts`）
- 为了让数字达标而手动把 `store_only` 改回 approved
- 放宽主体门/分级阈值（收紧是可以自己判断的，放宽不行）
- 接 P1 以外的任务

---

=== A 轨已到收尾节点，可以 /clear ===
