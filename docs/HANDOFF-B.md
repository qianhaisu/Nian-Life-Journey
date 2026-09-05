# B 轨交接稿（覆盖写，每次收尾更新）

## 我管什么

B 轨拥有：`v2/components/**`、`v2/app/**/page.tsx`、`v2/app/globals.css`、
`docs/ORCHESTRATOR-INBOX-B.md`（出箱段）、`docs/STATUS-B.md`。

不要碰：`v2/scripts/**`、`v2/lib/organizer/**`、`v2/lib/db/**`、
`v2/.env.local`、`docs/ORCHESTRATOR-INBOX.md`、`docs/STATUS.md`。

灰色地带：`v2/lib/publication-moments.ts` 归 B 轨；改其他 `v2/lib/` 文件要在出箱标注。

---

## 现在做到哪

**B-1 到 B-5 全部完成。** 推送到 main，Vercel 正在（或已完成）部署。

| 任务 | 文件 | 完成 |
|---|---|---|
| B-1 P1-12 证据精选 | `v2/components/evidence-list.tsx`、`v2/app/events/[id]/page.tsx` | ✓ |
| B-2 P1-8 照片查看器 | `v2/components/photo-viewer.tsx`（新建）、month/event/home 页 | ✓ |
| B-3 P1-9 月页渐进展开 | `v2/components/archive-expander.tsx`（新建）、`v2/app/memory/[year]/[month]/actions.ts`（新建） | ✓ |
| B-4 P1-10 首页三块 | `v2/app/page.tsx` | ✓ |
| B-5 P1-11 张年页 | `v2/app/about/page.tsx` | ✓ |

---

## 下一件事（明确到操作）

**入箱 B 轨现在没有新任务。** 如果 Cowork 在 `docs/ORCHESTRATOR-INBOX-B.md` 里加了新任务，
先读顶部看板；没有就做线上验收（手机宽度下实际点开每个功能）并把问题写进出箱。

线上验收优先顺序：
1. `/about` — 点"查看那天"确认有 lifeEventId 的条目；"最近的生活节奏"是否出现
2. 月页 → 展开"整月照片档案" → 点"还有 N 天"按钮，确认按需加载
3. 事件页 → 点任意照片进查看器 → 左右滑动、双击缩放、Esc 关闭
4. 首页 — 确认三块（cover + 最近的新变化 + 本月入口）结构

---

## 不要再踩的坑

1. **`git add -A` 会把约 251 个 CRLF/LF 假改动混入提交**——只 `git add` 自己改过的文件。
2. **`git pull --rebase` 在 CLAUDE.md 有 CRLF 差异时报冲突**——这不是真冲突；`git log --oneline main..origin/main` 确认 origin 没有领先时直接跳过 rebase，不要 stash/reset。
3. **DayHead 不能从服务器组件文件跨 `use client` 边界 import**——在 `archive-expander.tsx` 里内联了它的逻辑（5 行），不要引回 `month-moment.tsx`。
4. **PowerShell 多行 commit message 含中文字符要用变量法**，不能用 `@'...'@` heredoc（`）`字符解析有问题）。
5. **GrowthNote.id === GrowthRecord.id**——用它从 `store.growthRecords` 里找 `lifeEventId`，不要改 `v2/lib/growth-notes.ts`。

---

## 我不能单方面做的

- 改 `v2/.env.local`（A 轨专属）
- 改 `v2/lib/organizer/**` 或 `v2/lib/db/**`
- force push 或删除分支
- 调用会产生费用的外部 API
- 看或打印 `.env`、Token、Cookie
