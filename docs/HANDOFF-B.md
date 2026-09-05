# B 轨交接稿（覆盖写，每次收尾更新）

## 我管什么

B 轨拥有：`v2/components/**`、`v2/app/**/page.tsx`、`v2/app/globals.css`、
`docs/ORCHESTRATOR-INBOX-B.md`（出箱段）、`docs/STATUS-B.md`。

不要碰：`v2/scripts/**`、`v2/lib/organizer/**`、`v2/lib/db/**`、
`v2/.env.local`、`docs/ORCHESTRATOR-INBOX.md`、`docs/STATUS.md`。

灰色地带：`v2/lib/publication-moments.ts` 归 B 轨；改其他 `v2/lib/` 文件要在出箱标注。

---

## 现在做到哪

**B-1 到 B-14 全部完成。commit `e716df4`（B-11/B-12/B-13/B-14）已 push main，Vercel 部署中。**

| 任务 | 完成 | 线上验收 |
|---|---|---|
| B-1 P1-12 证据精选 | ✓ | ✓ curl 确认 1 primary + 34 supporting 折叠 |
| B-2 P1-8 照片查看器 | ✓ | ⚠️ PhotoGallery 组件存在；点击/滑动需真机验 |
| B-3 P1-9 月页渐进展开 | ✓ | ✓ "还有 29 天、548 张——点此展开全部"按钮存在；初始 71 img，548 张未预渲染 |
| B-4 P1-10 首页三块 | ✓ | ✓ 三块可见（cover + 最近新变化 + 本月入口） |
| B-5 P1-11 张年页 | ✓ | ✓ 最近的生活节奏出现；"查看那天"链接需真机确认 |
| B-7 P1-2 夸克导入 | ⏸ 阻塞 | apply 模式下 crash（无 stderr，疑 OOM/SIGKILL），A 轨 Codex 正在修复 |
| B-9 全站视觉重构 | ✓ 9a-9e 全完成 | ✓ Cowork 验收通过（9a-fix + 9bc-fix + 9d + 9e） |
| B-10 张年页内容补完 | ✓ | ✓ Cowork 验收通过（最近记下来的 + 家人最近说） |
| B-11 /memory 目录化 | ✓ | ⏳ 等 Cowork 验收 |
| B-12 事件页套壳 | ✓ | ⏳ 等 Cowork 验收 |
| B-13 家人这阵子说 60 天 | ✓ | ⏳ 等 Cowork 验收 |
| B-14 首页最近一组 | ✓ | ⏳ 等 Cowork 验收 |

---

## 下一件事（明确到操作）

等 Cowork 在浏览器验收 B-11 / B-12 / B-14（B-13 是一行改动，不需要单独截屏）。

验收重点：
- **B-11**：手机 375 全高截图 `/memory`：第一屏 ≥3 个月卡片；无「N 段/N 张」；桌面双列；卡片进入视口 fadeInUp
- **B-12**：随机点 3 条记忆：Badge 单行，hero 有阴影，折叠区圆角卡片，无 1px 直边
- **B-14**：首页「最近的新变化」之下有 ≥2 张照片 cluster，三张都是本人，可点进 `/events/[id]`

---

## 不要再踩的坑

1. **`git add -A` 会把约 251 个 CRLF/LF 假改动混入提交**——只 `git add` 自己改过的文件。
2. **`git pull --rebase` 在 CLAUDE.md 有 CRLF 差异时报冲突**——先用 `git log --oneline main..origin/main` 确认 origin 没有领先，没有就跳过 rebase。
3. **DayHead 不能从服务器组件文件跨 `use client` 边界 import**——在 `archive-expander.tsx` 里内联了它的逻辑，不要引回 `month-moment.tsx`。
4. **PowerShell 多行 commit message 含中文字符要用变量法**，不能用 `@'...'@` heredoc（会截断中文）。
5. **`v2/scripts/**` 是 A 轨领土**——卡住就写出箱，不要越界。
6. **B-7 apply 的 crash 是 A 轨问题**：dry-run 正常，apply 在 apply 循环内 OOM/SIGKILL，没有 stderr 输出。不要再次跑 apply 直到 A 轨报修复完成。
7. **memory-index.ts 灰色地带**：修改时在出箱标注（B-11 已做）。

---

## 我不能单方面做的

- 改 `v2/.env.local`（A 轨专属）
- 改 `v2/lib/organizer/**` 或 `v2/lib/db/**`
- 改 `v2/scripts/**`（A 轨领土，教训来自 B-7）
- force push 或删除分支
- 调用会产生费用的外部 API
- 看或打印 `.env`、Token、Cookie
