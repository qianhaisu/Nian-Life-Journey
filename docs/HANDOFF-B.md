# B 轨交接稿（覆盖写，每次收尾更新）

> 最后更新：2026-09-06 12:5x UTC · by Cowork（B-17 结案）

## 我管什么

B 轨拥有：`v2/components/**`、`v2/app/**/page.tsx`、`v2/app/globals.css`、
`docs/ORCHESTRATOR-INBOX-B.md`（出箱段）、`docs/STATUS-B.md`。

不要碰：`v2/scripts/**`、`v2/lib/organizer/**`、`v2/lib/db/**`、
`v2/.env.local`、`docs/ORCHESTRATOR-INBOX.md`、`docs/STATUS.md`。

灰色地带：`v2/lib/publication-moments.ts` 归 B 轨；改其他 `v2/lib/` 文件要在出箱标注。

---

## 现在做到哪

**B-1 到 B-17 全部完成。B-17（月章节三层排版）commit `989cd11` 已 push main，Vercel 已部署，Cowork 手机 375px + 桌面复验通过，2026-09-06 结案。**

| 任务 | 完成 | 线上验收 |
|---|---|---|
| B-1 P1-12 证据精选 | ✓ | ✓ |
| B-2 P1-8 照片查看器 | ✓ | ⚠️ 真机手势待验 |
| B-3 P1-9 月页渐进展开 | ✓ | ✓ |
| B-4 P1-10 首页三块 | ✓ | ✓ |
| B-5 P1-11 张年页 | ✓ | ✓ |
| B-7 P1-2 夸克导入 | ⏸ 阻塞 | apply crash，A 轨处理 |
| B-9 全站视觉重构 | ✓ 9a-9e | ✓ |
| B-10 张年页内容补完 | ✓ | ✓ |
| B-11 /memory 目录化 | ✓ | ✓ |
| B-12 事件页套壳 | ✓ | ✓ |
| B-13 家人这阵子说 60 天 | ✓ | ✓ |
| B-14 首页最近一组 | ✓ | ✓ |
| B-15 代表照只认夸克 | ✓ | ✓ |
| B-15-fix 卡片灰框修复 | ✓ | ✓ |
| B-16 Photo fit prop + 卡片高度修复 | ✓ commit 3e98ada | ✓ Cowork 2026-09-06 复验通过 |

**Cowork 2026-09-06 独立复验**（B-16 后状态）：
- 手机 375px：`/memory` 月卡片高度正常（160-240px 区间），横向裁切看得见人脸
- 首页 cluster：51 张夸克图，三张可见，无灰框
- 事件页/月页正文照片仍按自身比例不裁（自然比例保留）
- `/about` 头像正常（未受 B-16 fit 改动影响，未动该区域）

---

## 下一件事（明确到操作）

**先读 INBOX-B 顶部看板**，确认下一个 ready 任务。

B-17 已结案（Cowork 2026-09-06 复验通过）。当前已知无 ready 任务，等 Cowork 派下一单（大概率是 P2 的 2025 全年月度审阅）。

---

## 不要再踩的坑

1. **`git add -A` 会把约 251 个 CRLF/LF 假改动混入提交**——只 `git add` 自己改过的文件。
2. **`git pull --rebase` 在 CLAUDE.md 有 CRLF 差异时报冲突**——先 `git log --oneline main..origin/main` 确认没有落后，没有就跳过 rebase。
3. **夸克 web 变体 (~490KB) 经 Next 优化器超时**：≤ 400px 显示宽度的槽位一律用 `variant="thumbnail"`（480px webp），不要用 `variant="web"`。
4. **`Photo` 的 failed → fallback 已改**：`failed` 时直连 `mediaDeliveryUrl(id,"thumbnail")` 的原生 `<img>`，不会出空灰框。如果以后再改 `photo.tsx` 要保持这条 fallback。
5. **`Photo` 的 `fit` prop**：`"natural"`（默认，竖图立着，自然比例）vs `"crop"`（固定高度槽位，交给父级 CSS + object-fit 裁切）。卡片/cluster 用 `fit="crop"`；事件页/月页正文/PhotoGallery 用 `"natural"`（或不传，默认即 natural）。
6. **PowerShell 多行 commit message 含中文字符要用 Bash 写**，不要用 PowerShell here-string。
7. **`v2/scripts/**` 是 A 轨领土**——卡住就写出箱，不要越界。
8. **`trusted` ≠ `isPortraitOfZhangnian`**：privilege.trusted 包含 wechat-media，封面/卡片/cluster 只用 `isPortraitOfZhangnian`（`lib/media/representative.ts`）。
9. **memory-chapters.ts 是灰色地带**：改了要在出箱标注。

---

## 我不能单方面做的

- 改 `v2/.env.local`（A 轨专属）
- 改 `v2/lib/organizer/**` 或 `v2/lib/db/**`
- 改 `v2/scripts/**`（A 轨领土）
- force push 或删除分支
- 调用会产生费用的外部 API
- 看或打印 `.env`、Token、Cookie

---

=== B 轨已到收尾节点，可以 /clear ===
