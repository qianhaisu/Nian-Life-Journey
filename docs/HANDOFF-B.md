# B 轨交接稿（覆盖写，每次收尾更新）

## 我管什么

B 轨拥有：`v2/components/**`、`v2/app/**/page.tsx`、`v2/app/globals.css`、
`docs/ORCHESTRATOR-INBOX-B.md`（出箱段）、`docs/STATUS-B.md`。

不要碰：`v2/scripts/**`、`v2/lib/organizer/**`、`v2/lib/db/**`、
`v2/.env.local`、`docs/ORCHESTRATOR-INBOX.md`、`docs/STATUS.md`。

灰色地带：`v2/lib/publication-moments.ts` 归 B 轨；改其他 `v2/lib/` 文件要在出箱标注。

---

## 现在做到哪

**B-1 到 B-5 全部完成并在线上验证。** B-7 夸克导入被卡住，已交还 A 轨处理。

| 任务 | 完成 | 线上验收 |
|---|---|---|
| B-1 P1-12 证据精选 | ✓ | ✓ curl 确认 1 primary + 34 supporting 折叠 |
| B-2 P1-8 照片查看器 | ✓ | ⚠️ PhotoGallery 组件存在；点击/滑动需真机验 |
| B-3 P1-9 月页渐进展开 | ✓ | ✓ "还有 29 天、548 张——点此展开全部"按钮存在；初始 71 img，548 张未预渲染 |
| B-4 P1-10 首页三块 | ✓ | ✓ 三块可见（cover + 最近新变化 + 本月入口） |
| B-5 P1-11 张年页 | ✓ | ✓ 最近的生活节奏出现；"查看那天"链接需真机确认 |
| B-7 P1-2 夸克导入 | ⏸ 阻塞 | apply 模式下 crash（无 stderr，疑 OOM/SIGKILL），A 轨 Codex 正在修复 |

---

## 下一件事（明确到操作）

**等 A 轨修好夸克导入脚本后**，从入箱读到修复通知，再跑一次：
```bash
cd v2
node --import tsx scripts/quark-history-init.mjs --apply
```
跑完查库：`SELECT count(*) FROM raw_sources WHERE source_label = 'Quark 历史素材 2026-09-03';` 应 ≈ 1,690。

如果入箱有新任务，先做新任务，不要等 B-7。

**B-2 真机验收**（可在等待期间做）：打开 https://nianlife.cn/memory/2026/08，点任意照片
→ 全屏开 → 左右滑 → 双击放大 → Esc/返回关闭，确认返回后位置不跳顶。

---

## 不要再踩的坑

1. **`git add -A` 会把约 251 个 CRLF/LF 假改动混入提交**——只 `git add` 自己改过的文件。
2. **`git pull --rebase` 在 CLAUDE.md 有 CRLF 差异时报冲突**——这不是真冲突；`git log --oneline main..origin/main` 确认 origin 没有领先时直接跳过 rebase，不要 stash/reset。
3. **DayHead 不能从服务器组件文件跨 `use client` 边界 import**——在 `archive-expander.tsx` 里内联了它的逻辑，不要引回 `month-moment.tsx`。
4. **PowerShell 多行 commit message 含中文字符要用变量法**，不能用 `@'...'@` heredoc。
5. **`v2/scripts/**` 是 A 轨领土**——B-7 卡住时差点在那里加诊断代码，被 A 轨叫停。卡住就写出箱，不要越界。
6. **B-7 apply 的 crash 是 A 轨问题**：dry-run 正常，apply 在 apply 循环内 OOM/SIGKILL，没有 stderr 输出。不要再次跑 apply 直到 A 轨报修复完成。

---

## 我不能单方面做的

- 改 `v2/.env.local`（A 轨专属）
- 改 `v2/lib/organizer/**` 或 `v2/lib/db/**`
- 改 `v2/scripts/**`（A 轨领土，教训来自 B-7）
- force push 或删除分支
- 调用会产生费用的外部 API
- 看或打印 `.env`、Token、Cookie
