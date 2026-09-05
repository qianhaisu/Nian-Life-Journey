# B 轨交接稿（覆盖写，每次收尾更新）

## 我管什么

B 轨拥有：`v2/components/**`、`v2/app/**/page.tsx`、`v2/app/globals.css`、
`docs/ORCHESTRATOR-INBOX-B.md`（出箱段）、`docs/STATUS-B.md`。

不要碰：`v2/scripts/**`、`v2/lib/organizer/**`、`v2/lib/db/**`、
`v2/.env.local`、`docs/ORCHESTRATOR-INBOX.md`、`docs/STATUS.md`。

灰色地带：`v2/lib/publication-moments.ts` 归 B 轨；改其他 `v2/lib/` 文件要在出箱标注。

---

## 现在做到哪

**B-1 到 B-15-fix 全部完成。commit `af1d89c`（B-15-fix）已 push main，Vercel 部署中。**

| 任务 | 完成 | 线上验收 |
|---|---|---|
| B-1 P1-12 证据精选 | ✓ | ✓ |
| B-2 P1-8 照片查看器 | ✓ | ⚠️ 真机手势待验 |
| B-3 P1-9 月页渐进展开 | ✓ | ✓ |
| B-4 P1-10 首页三块 | ✓ | ✓ |
| B-5 P1-11 张年页 | ✓ | ✓ |
| B-7 P1-2 夸克导入 | ⏸ 阻塞 | apply crash，A 轨处理 |
| B-9 全站视觉重构 | ✓ 9a-9e | ✓ Cowork 验收通过 |
| B-10 张年页内容补完 | ✓ | ✓ Cowork 验收通过 |
| B-11 /memory 目录化 | ✓ | ⏳ B-15-fix 后等 Cowork 重验 |
| B-12 事件页套壳 | ✓ | ✓ |
| B-13 家人这阵子说 60 天 | ✓ | ✓ |
| B-14 首页最近一组 | ✓ | ⏳ B-15-fix 后等 Cowork 重验 |
| B-15 代表照只认夸克 | ✓ | ✓ 选片规则通过；图片消失问题 → B-15-fix |
| B-15-fix 卡片灰框修复 | ✓ | ⏳ 等 Cowork 验收 |

---

## 下一件事（明确到操作）

等 Cowork 在浏览器验收 B-15-fix：
- `/memory`：每张有夸克照片的月份卡片**看得见张年**，`main img` 数量 = 有图卡片数，`naturalWidth ≥ 384`，无灰框
- 首页 cluster：三张照片可见，全是 `media-quark-sha-`
- 没有一处空灰框

---

## 不要再踩的坑

1. **`git add -A` 会把约 251 个 CRLF/LF 假改动混入提交**——只 `git add` 自己改过的文件。
2. **`git pull --rebase` 在 CLAUDE.md 有 CRLF 差异时报冲突**——先用 `git log --oneline main..origin/main` 确认 origin 没有领先，没有就跳过 rebase。
3. **夸克 web 变体 (~490KB) 经 Next 优化器超时**：≤ 400px 显示宽度的槽位一律用 `variant="thumbnail"`（480px webp），不要用 `variant="web"`。
4. **`Photo` 的 failed → `return null` 已改**：现在 fallback 直连 `mediaDeliveryUrl(id,"thumbnail")`，不会出空灰框。如果以后再改 `photo.tsx` 要保持这条 fallback。
5. **PowerShell 多行 commit message 含中文字符要用 Bash 写**，不要用 PowerShell here-string。
6. **`v2/scripts/**` 是 A 轨领土**——卡住就写出箱，不要越界。
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
