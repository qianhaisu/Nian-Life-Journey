# B 轨交接稿（覆盖写，每次收尾更新）

## 我管什么

B 轨拥有：`v2/components/**`、`v2/app/**/page.tsx`、`v2/app/globals.css`、
`docs/ORCHESTRATOR-INBOX-B.md`（出箱段）、`docs/STATUS-B.md`。

不要碰：`v2/scripts/**`、`v2/lib/organizer/**`、`v2/lib/db/**`、
`v2/.env.local`、`docs/ORCHESTRATOR-INBOX.md`、`docs/STATUS.md`。

灰色地带：`v2/lib/publication-moments.ts` 归 B 轨；改其他 `v2/lib/` 文件要在出箱标注。

---

## 现在做到哪

**B-1 到 B-15 全部完成。commit `2b759e7`（B-15）已 push main，Vercel 部署中。**

| 任务 | 完成 | 线上验收 |
|---|---|---|
| B-1 P1-12 证据精选 | ✓ | ✓ curl 确认 1 primary + 34 supporting 折叠 |
| B-2 P1-8 照片查看器 | ✓ | ⚠️ 组件存在；点击/滑动需真机验 |
| B-3 P1-9 月页渐进展开 | ✓ | ✓ 按钮存在；548 张未预渲染 |
| B-4 P1-10 首页三块 | ✓ | ✓ 三块可见 |
| B-5 P1-11 张年页 | ✓ | ✓ 生活节奏出现 |
| B-7 P1-2 夸克导入 | ⏸ 阻塞 | apply crash，A 轨 Codex 修复中 |
| B-9 全站视觉重构 | ✓ 9a-9e 全完成 | ✓ Cowork 验收通过 |
| B-10 张年页内容补完 | ✓ | ✓ Cowork 验收通过 |
| B-11 /memory 目录化 | ✓ | ✓ Cowork 验：B-12/B-13 过；B-11/B-14 不过 → B-15 修复 |
| B-12 事件页套壳 | ✓ | ✓ Cowork 验收通过 |
| B-13 家人这阵子说 60 天 | ✓ | ✓ Cowork 验收通过 |
| B-14 首页最近一组 | ✓ | ⏳ B-15 修复后等 Cowork 重验 |
| B-15 代表照只认夸克 | ✓ | ⏳ 等 Cowork 验收 |

---

## 下一件事（明确到操作）

等 Cowork 在浏览器验收 B-15：
- **`/memory`**：每张月份卡片 `<img src>` 含 `media-quark-sha-`，肉眼能看到张年的脸；没有夸克照片的月份显示纯文字卡片（无灰框）
- **首页 cluster**：三张全是 `media-quark-sha-`，不含香蕉牛奶等 wechat-media；不足 2 张则整块不渲染
- **缩略图不糊**：naturalWidth ≥ 显示宽度

---

## 不要再踩的坑

1. **`git add -A` 会把约 251 个 CRLF/LF 假改动混入提交**——只 `git add` 自己改过的文件。
2. **`git pull --rebase` 在 CLAUDE.md 有 CRLF 差异时报冲突**——先用 `git log --oneline main..origin/main` 确认 origin 没有领先，没有就跳过 rebase。
3. **DayHead 不能从服务器组件文件跨 `use client` 边界 import**——在 `archive-expander.tsx` 里内联了它的逻辑。
4. **PowerShell 多行 commit message 含中文字符要用 Bash 写**，不要用 PowerShell here-string。
5. **`v2/scripts/**` 是 A 轨领土**——卡住就写出箱，不要越界。
6. **B-7 apply 的 crash 是 A 轨问题**：dry-run 正常，apply OOM/SIGKILL。不要再次跑 apply。
7. **`trusted` ≠ `isPortraitOfZhangnian`**：privilege.trusted 包含 wechat-media，封面/卡片/cluster 只用 `isPortraitOfZhangnian`（`lib/media/representative.ts`）。
8. **memory-chapters.ts 是灰色地带**：B-15 改了 `latestPortrait` 用 `isPortraitOfZhangnian`，出箱已标注。

---

## 我不能单方面做的

- 改 `v2/.env.local`（A 轨专属）
- 改 `v2/lib/organizer/**` 或 `v2/lib/db/**`
- 改 `v2/scripts/**`（A 轨领土）
- force push 或删除分支
- 调用会产生费用的外部 API
- 看或打印 `.env`、Token、Cookie
