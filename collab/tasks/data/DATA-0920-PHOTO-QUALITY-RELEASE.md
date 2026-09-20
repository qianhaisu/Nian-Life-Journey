# DATA-0920-PHOTO-QUALITY-RELEASE
- status: accepted
- user_authorization: Teddy explicitly replied 确认 to Codex's request to deploy the 1312-photo display filter; production release is now authorized. No further confirmation needed within this scope.
- repository/branch: C:\Users\teddy\Documents\Nianlife, current main; no new branch/worktree.
- release_sha: 946b1e3 (resolve full SHA and deploy exactly this reviewed snapshot, use git archive/clean committed source, NEVER package dirty worktree).
- implementation: 1402d33; commander review and tests passed; reuse R1/R2 evidence. The later 946b1e3 is documentation only. HEALTH 376e0a2 changes offline script/test/report, not app runtime.
- task: deploy reviewed photo-quality gate to existing production through v2/scripts/deploy-ecs-public.sh build/swap flow. No DB writes, source/media deletion, model calls, new infrastructure or changes to health content. Preserve current production configuration and content mounts. Verify prior production SHA and rollback point before switch; compare release diff to current live SHA for unexpected runtime changes, report blockers instead of deploying extra unreviewed work.
- sequencing: verify current state/lock -> capture content manifest hashes (no private contents logged) -> build exact release -> swap -> health checks -> automatic retention -> independent URL/content verification. All ECS build/swap/cleanup serialized under existing deployment lock. No parallel cleanup during build.
- acceptance: /api/health correct full SHA and DB connected; homepage 200; /memory/2025/07/24 image count 12->5 and exact flagged media absent (R1 sample identity is in private RESULT.md); source text preserved; site-wide read-only inventory compared to prior displayed.json/manifest.json shows expected quality exclusions with no missed read errors and no collateral removal. Reuse existing crawler but write post-release outputs to distinct subdir, do not overwrite baseline. Check mobile+desktop date gallery if feasible, count and image loading; representative formerly photo-only day retains its history/page. Originals/source/DB unchanged, current content hashes preserved.
- retention: mandatory successful-release cleanup current + last two distinct rollback versions sorted by container switch timestamp, via swap automatic ecs-retention.py. Report retained container names/image SHAs, cleanup exit/result, disk total/used/free. Preserve databases/media/month content/config/certs/volumes; no volume prune or storage-directory deletion. A cleanup failure is incomplete release closeout, report it.
- files: this card ACK/status; docs/photo-quality-release-2026-09-20.md sanitized; private runtime evidence C:\Users\teddy\NianlifeOps\photo-quality-2026-09-20\release\RESULT.md and release subdir. No business code changes unless commander approves correction. Do not touch unrelated dirty files or concurrent HEALTH task.
- Git: exact-stage only own release docs, commit/push main after checks; deploy snapshot stays 946b1e3 regardless subsequent docs commits. Preserve all history and preexisting changes.
- required_evidence: ACK actual HEAD/time from clock (do not guess times), prior/current full SHA, commands/exits, target URL responses/counts, content hashes, retained rollback versions, disk, cleanup, remaining issues. On release health failure use existing rollback, then report. No fabricated future timestamps.
- eta: ACK promptly, provide concrete ETA; write all substantive evidence to files, GUI only wake.

## ACK
- acknowledged_at: 2026-09-20 22:47:20 +0800（`date` 实测，非估计）
- repository/branch: C:\Users\teddy\Documents\Nianlife，main（未新建/未切换分支或 worktree）
- head_at_ack: e23bb76a75cc84c7b03ad79f7177c3035de682ea（= origin/main）
- release_sha 解析: 946b1e3 → **946b1e3938fded0a3755ecd1508de0493b941242**
  - 946b1e3 "docs: record photo quality review and recovery limits"（仅文档）
  - 其父 3b012b6 → 1402d33 "photo-quality: 原生分辨率不足的照片不再进入阅读面"（本次要上线的运行时改动）
  - HEAD e23bb76 比 release_sha 新一条，也是纯文档（本卡片授权记录），不进本次快照
- 打包方式: `git archive <sha> v2`（deploy-ecs-public.sh upload 子命令），**只打已提交快照，不打脏工作区**
- evidence_dir: C:\Users\teddy\NianlifeOps\photo-quality-2026-09-20\release\
- 时间记录更正（诚实声明）：R1/R2 回执里写的 21:47 / 00:38 是估计值，不是时钟读数；实际本会话
  ACK 时刻为上面这一行。后续所有时间均取自 `date` 实测。
- eta:
  - precheck + 与线上 SHA 的 diff 核对 + 内容清单哈希：23:10 前
  - upload/build（构建耗时受 ECS 影响，历史约 15–30 分钟）：00:10 前
  - swap + 健康检查 + 自动保留清理：00:30 前
  - 独立 URL/内容验证与发布后全站只读盘点对比：01:10 前
  - 任一步失败即停并按 rollback-app 回滚，然后如实报告，不继续推进
- 边界确认: 不写数据库、不删原件/媒体、不调模型、不新增基础设施、不动 HEALTH 任务文件与并发锁；
  ECS 的 build/swap/cleanup 全部走既有部署锁，不并行清理。

## Submission
- released_at: 2026-09-20 22:56:47 +0800（容器 StartedAt 实测）；发布记录提交 2026-09-20 23:12:51 +0800（Git 8b84414 committer time；替换未核实的时间占位符）
- prior_sha: 5160a603edda047dd4798c8ecac856199e4faa32
- released_sha: 946b1e3938fded0a3755ecd1508de0493b941242（`/api/health` 与容器 env 均为全串一致）
- 运行时差异仅 2 文件：v2/lib/media-quality.ts（新增）、v2/lib/media/deliverability.ts；
  其余 21 个文件为文档/离线脚本/测试（含 HEALTH 376e0a2），无 Dockerfile/依赖/迁移/配置变更
- commands（全部串行，远端 flock 部署锁）:
  - precheck: exit 0（free 29,141MB；5160a60 healthy；锁空闲）
  - upload 946b1e3…: exit 0（git archive 34,191,360B，不打脏工作区）
  - build 946b1e3…: exit 0（tagged nianlife-web:946b1e3 / 022ae1d39dea；free 29,074→26,119MB）
  - swap 946b1e3: exit 0（SWAP_OK，t=3 healthy，ROLLBACK_CONTAINER=nianlife-diag-web-pre-946b1e3-20260920-225647）
  - verify: exit 0
- acceptance:
  - /api/health 全串 SHA 正确 + db connected + 媒体 oss 可达 19ms ✓
  - 首页 200（0.472s）、308 跳转、证书、备案号 ✓
  - /memory/2025/07/24 图片 12→5，被标记的 7 张全部不在，保留的 5 张全部在 ✓
  - 该日正文 sha256 与发布前逐字相同（12cee7ede948360185774646e0fc57c6）✓
  - 全站只读盘点：21 月 / 475 日页不变，抓取失败 0，媒体引用 5,717→4,405（delta 正好 −1,312），
    清单内仍在展示 0，清单外误删 0，新增 0 → PASS ✓
  - 曾只有低分辨率照片的日页：实际 15 个（预测 25，差异原因已在 RESULT 第九节说明），
    全部 200，标题/正文/来源/回链完好，最短正文 102 字 ✓
  - 内容挂载 21 个月 sha256 逐个未变，versions 仍 27 个；原件/库/故事/审核决定未改 ✓
  - 数据库只读核对：切换后 0 条 review 写入；带 quality:* 理由码或 photo-quality-* promptVersion 的行 0 条 ✓
- retention: 自动执行 exit 0。当前 nianlife-diag-web=nianlife-web:946b1e3；回滚点
  nianlife-diag-web-pre-946b1e3-20260920-225647（5160a60）与 nianlife-diag-web-pre-5160a60-20260920-161559（6fe6435）；
  清理 nianlife-diag-web-pre-6fe6435-20260920-160231 与镜像 nianlife-web:85f96b7；释放 2,347,909,120 字节。
  磁盘 total 41,882,943,488 / used 9,447,682,048 / available 30,499,524,608（40G/8.9G/29G/24%）。
  数据库、媒体、月度内容、配置、证书、数据卷均未删除，未做 volume prune。
- rollback: `deploy-ecs-public.sh rollback-app nianlife-diag-web-pre-946b1e3-20260920-225647` → 回 5160a60；
  闸门是纯代码，无账本行要撤、无数据要还原。
- files: docs/photo-quality-release-2026-09-20.md（脱敏）；本卡片；
  私有证据 C:\Users\teddy\NianlifeOps\photo-quality-2026-09-20\release\（RESULT.md 及 01–15 号证据、post/）。
  未改任何业务代码。远端另用 v2/.data/photo-quality-release-dbcheck*.mjs 做只读核对（.data 已被 .gitignore 覆盖，不提交）。
- 需要人判断（未处理，超出本卡片授权）：15 个照片清零日页中有 8 天
  （2025-05-27、2025-06-25、2025-10-16、2025-10-24、2025-11-27、2025-12-17、2026-03-12、2026-06-11）
  正文写着「照片里他……」「镜头」之类指认，而被指认的正是刚挡下的低分辨率照片。文字没错，但会
  指向一张看不见的图。属内容编辑范畴，未作任何修改。
- unverified:
  - 桌面宽度视口真机复核未完成：本机 Chrome 窗口无法放大（resize_window 返回成功但 innerWidth 恒为 502），
    按任务卡「if feasible」记为不可得，不冒称已验。窄屏 502×719 已完成：两页 0 加载失败、0 空框、无短边<160。
  - 未证明「所有糊照片都没了」——本次只处理原生分辨率不足一类，正常尺寸的失焦/运动模糊未逐张审阅，
    也未按清晰度分数撤任何一张。
  - 跨资产同画面高分辨率副本（夸克）仍未评估，需感知哈希比对。
  - withheldMediaCount 现把这 1,312 张计入；该字段当前无任何页面渲染，故无家人可见数字失真。
- 时间记录更正：R1/R2 回执里的 21:47 / 00:38 是估计值而非时钟读数，已在 RELEASE 卡 ACK 中声明；
  本轮所有时间取自 `date` 与容器 StartedAt 实测。
## Commander acceptance
- reviewed_at: 2026-09-20T23:14:19.1640923+08:00
- verdict: accepted; production release complete, retention complete. Release SHA remains 946b1e3938fded0a3755ecd1508de0493b941242.
- Independent public health check confirms correct SHA, DB connected and media reachable.
- Independently fetched sample: 5 img elements, flagged sample absent, all 23 paragraph elements exactly equal to pre-release HTML.
- Independently compared baseline/post media sets against manifest: exactly 1312 removals, no manifest mismatch, zero fetch failures. All 21 content hashes unchanged.
- Reviewed retention evidence: current 946b1e3, rollback 5160a60 and 6fe6435; cleanup successful. Disk total/used/available: 41882943488/9447682048/30499524608 bytes.
- Worker narrow viewport check reported successful image loading. Commander browser channel timed out; desktop-width and physical-phone checks are not claimed.
- Known editorial consequence: 15 dates retain text without photos; 8 still refer to photos. Preserve historical wording and original files; no editorial rewrite or source deletion in this task.
- Scope remains low native resolution. Normal-resolution optical blur and cross-asset original recovery are not established by this release.
- Private independent review: C:\Users\teddy\NianlifeOps\photo-quality-2026-09-20\release\COMMANDER-REVIEW.md.
