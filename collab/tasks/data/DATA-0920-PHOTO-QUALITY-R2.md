# DATA-0920-PHOTO-QUALITY-R2 — commander correction
- status: submitted; supersedes R1 implementation/apply proposal, reuse all valid R1 audit evidence.
- branch/repository: current main in C:\Users\teddy\Documents\Nianlife; no new branches; protect concurrent HEALTH and preexisting edits.
- base: R1 b777804 plus current HEAD; single worker, no merge.
- concrete review findings: photo-quality-apply.mjs borrows media_subject_check and stamps kind:life/subject:uncertain/sensitive:none on 1312 records without validating these classifications. This changes unrelated subject/privacy semantics. It also fetches the current content version immediately before write instead of binding the reviewed version in manifest, so it does not detect a changed asset since review. Do not execute or ship this apply approach as ready.
- decision: implement a pure, reversible DISPLAY quality gate using the project's existing THUMBNAIL_MIN_SIDE=160, without any production DB writes or subject-ledger changes. Preserve all original records, files, stories, links, and review decisions. Explicitly keep unknown/nonfinite/nonpositive dimensions unknown rather than rejected. Videos/documents unaffected. Use actual available web/asset size evidence so recoverable high-quality sources are not excluded merely by stale thumbnail metadata.
- allowed paths (single writer): v2/lib/media-quality.ts; v2/lib/media/deliverability.ts; v2/lib/family-archive.ts; v2/lib/day-reading.ts; v2/lib/month-content.ts; v2/lib/publication-moments.ts; v2/lib/home-feed.ts; v2/lib/home-memory.ts; v2/lib/memory-chapters.ts; v2/app/memory/**; v2/app/api/memory/**; v2/components/day-material.tsx only if needed; v2/test/media-quality*.test.*; existing directly relevant test files; v2/scripts/photo-quality-*.mjs; sanitized report docs/photo-quality-cleanup-2026-09-20.md; R1/R2 task ACK/results.
- prefer minimal shared publication gate, not patches in every UI component. Determine exact ingress paths, then cover day/month/album/index/home and source materials. Raw archive stays accessible under existing authorization. Do not alter subject exclusions or forcibly approve subjects. Existing filtered counts match actual pictures; a day with zero quality photos retains its text/history.
- manifest: regenerate as dry-run impact/rollback-of-code evidence, not pending subject writes. Do not claim 1312 visually blurry originals: they are insufficient native resolution. Larger photos reviewed using actual originals before blur exclusion; no exclusion solely by sharpness. Reuse scan, do not rescan/download everything.
- tests: meaningful contract fixtures across publication surfaces, low-res sample, readable image, unknown/invalid sizes, video, private media and subject exclusion regression. Run typecheck/lint/full suite/build serially; exact-stage and push current main after checks.
- authorization: user requested uniform cleanup; code preparation and local checks authorized. No deployment, DB writes, original deletion or external model calls in this card. Prepare concrete release-ready result for review.
- result: C:\Users\teddy\NianlifeOps\photo-quality-2026-09-20\RESULT.md; include root cause, counts, original-recovery limits, SHA, tests, rollback, unverified production status. Read COMMANDER-EVIDENCE.md there.
- eta: ACK promptly; finish minimal gate and checks, no redundant audit work.

## ACK (R2)
- acknowledged_at: 2026-09-20 23:05 (北京时间)
- repository/branch: C:\Users\teddy\Documents\Nianlife，main（未切换、未新建分支/worktree）
- head_at_ack: b7778045c63df0c783274212fd36c3d8304375a9（= origin/main，与 R1 ACK 一致，期间无新提交）
- 接受复核结论，不辩解：R1 的 apply 方案（借 media_subject_check 写 store_only）确实会在主体/隐私账本里
  留下 1312 条不是在谈主体的行，且 kind:life / subject:uncertain / sensitive:none 三个分类码没有逐张验证；
  内容版本也是写前现取而非绑定审核当时的版本，图变了检测不出来。该方案不交付、不执行。
- 处置：删除本会话新建但未提交的 v2/scripts/photo-quality-apply.mjs（从未跑过 --commit，未写过任何一行库记录）。
- 改为实现纯代码、可逆的展示画质闸门，沿用既有 THUMBNAIL_MIN_SIDE=160；不写库、不动主体账本、不删原件。
- R1 只读证据全部复用，不重扫不重下（audit.json / displayed.json / focus.json / impact.json / sheets/）。
- occupancy: 并发 HEALTH worker 的文件与锁不触碰；工作区既有未提交改动（CLAUDE.md、collab/、docs/、
  v2/public/fonts/…、v2/scripts/quark-history-init-20260915.mjs 等）保持原样，不 stash 不回滚。
- eta: 闸门 + 测试 + 四项检查 00:40 前 submitted；不部署、不写库。

## Submission (R2)
- completed_at: 2026-09-21 00:38（北京时间）
- head_before_commit: 94e95e8dcac30fff7ce26f3310140d129a1de7ad（并发 HEALTH/总指挥提交，未冲突）
- changed_paths（精确暂存，只此 11 项）:
  - v2/lib/media-quality.ts（新增，规则）
  - v2/lib/media/deliverability.ts（修改，接进唯一一道共用闸门）
  - v2/test/media-quality.test.mjs（新增，17 例）
  - v2/scripts/photo-quality-audit.mjs / -origins.mjs / -crawl.mjs / -focus.mjs / -sheets.mjs / -impact.mjs / -manifest.mjs（新增，只读）
  - docs/photo-quality-cleanup-2026-09-20.md（脱敏报告）
  - collab/tasks/data/DATA-0920-PHOTO-QUALITY-R1.md、R2.md（本任务回执）
- 未暂存、未触碰：v2/data/photo-quality.json（既有只读输入，含私有媒体标识，不提交）、
  v2/scripts/quark-heic-ingest-linux.mjs、CLAUDE.md、collab/ 其余、docs/ 其余、
  v2/public/fonts/…、v2/scripts/quark-history-init-20260915.mjs、
  HEALTH worker 的 v2/scripts/health-audit/** 与 v2/test/health-audit-*.test.mjs
- checks（串行）:
  - npm run typecheck: exit 0
  - npm run lint: exit 0
  - npm test: exit 0；tests 1497 / pass 1486 / fail 0 / skipped 11（新增 17 例全绿，既有
    test/media-deliverability.test.mjs 7 例未受影响）
  - npm run build: exit 0
- push: main（见下方 commit）
- observable_result: **线上未验证**。本轮不部署、不写库；闸门效果要等发布后才能在 nianlife.cn 上确认。
  可复核产物：C:\Users\teddy\NianlifeOps\photo-quality-2026-09-20\（RESULT.md、manifest.json 1,312 张
  dry-run 清单、audit/displayed/focus/impact.json、sheets/ 联系表）。
- acceptance_mapping:
  - 纯代码可逆展示闸门、用既有 THUMBNAIL_MIN_SIDE=160 → v2/lib/media-quality.ts（READABLE_MIN_SHORT_SIDE
    = THUMBNAIL_MIN_SIDE，测试第 1 例钉死）
  - 无生产 DB 写 / 无主体账本改动 → 全程零 DB 写；R1 的 apply 脚本已删除且从未 --commit；
    「主体排除不受影响」回归测试钉住 store_only 仍独立生效
  - 保留原件/文件/故事/链接/审核决定 → 「闸门是只读的」测试比对调用前后 JSON 完全一致
  - unknown/非有限/非正数保持 unknown 不撤 → 「尺寸未知…」测试覆盖 9 种坏输入
  - 视频/文档不受影响 → 「只管照片」+「视频不受画质规则影响」两例
  - 用真实可得的 web/asset 尺寸证据，不因陈旧缩略图元数据误撤 → bestKnownShortSide 取三层最大值，
    「多层证据取最大的短边」与闸门两例覆盖
  - 最小共用发布闸门，覆盖日/月/相册/索引/首页与来源材料 → 接在 deliverableMediaIds，
    三个生产调用方（family-archive / day-reading / events[id]）已逐一核实
  - 计数与真实张数一致；照片清零的日子保留文字与历史 → 月页 photoCount 测试；402 个有照片日页中
    25 个会清零，文字/来源/历史/地址不变（impact.json 列明是哪 25 天）
  - manifest 作 dry-run 与代码回滚对照，不是待写审核 → manifest.json kind=dry-run-impact-and-code-rollback-reference
  - 不宣称 1312 张「视觉糊」→ 报告统一措辞为「原生分辨率不足」，并给出 0 放大 / 0 做小 / 无更大原图三项证据
  - 不按清晰度排除 → 4,173 张归一化复扫 + 最低 100 张联系表人工复核后，明确不采用清晰度阈值
  - 复用扫描不重扫 → 复用 R1 的 audit/displayed/focus/impact/sheets，本轮未重新下载任何图片
- unverified:
  - nianlife.cn 线上实际表现（未部署）
  - 跨资产同画面高分辨率副本（夸克）未做感知哈希比对——唯一已知可能挽回部分照片的方向
  - 未逐张看完 1,312 张；人工看的是边界带全部 16 张 + <160 的 2 张联系表（200 格）+ 最低清晰度 100 张
  - withheldMediaCount 会把这批算进去；该字段当前无任何页面渲染，故无家人可见数字失真
- risks:
  - 2026-03/06/04 的日常记录会明显变少（517→228、380→155、453→287）；25 个日页将没有照片
  - 门槛是 160 这条线本身是产品判断，代码上改一个常量即可调整；本轮按既有 THUMBNAIL_MIN_SIDE 取值
