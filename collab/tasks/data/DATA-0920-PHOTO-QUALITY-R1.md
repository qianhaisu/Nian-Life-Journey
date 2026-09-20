# DATA-0920-PHOTO-QUALITY-R1
- status: superseded_by_R2
- line: data (existing Claude Code session: nianlife.cn 性能和图片显示问题)
- repository: C:\Users\teddy\Documents\Nianlife
- branch: main; do not create or switch branches/worktrees
- base_sha: 4bdc08312e92144295fc3c553a987701c48f1f0c; recheck current HEAD before writes, concurrent HEALTH task owns its paths
- depends_on: none
- merge_order: single worker on current main; no branch merge
- authorization: Teddy 2026-09-20 requests uniform removal from display of blurry photos like https://nianlife.cn/memory/2025/07/24 (screenshot image 3/12).
- reference: C:\Users\teddy\AppData\Local\Temp\codex-clipboard-fc08c11e-50cf-4805-af90-4b4a31441443.png
- objective: trace exact sample media; distinguish low-quality original from upscaled thumbnail or delivery bug; audit all currently displayed photos and prepare reversible display exclusion for confirmed similar quality.
- allowed_paths: v2/scripts/photo-quality-*.mjs; v2/lib/media-quality*.ts; v2/test/media-quality*.test.*; existing media selection/delivery files only if required, report exact paths before editing; this task ACK/status; docs/photo-quality-cleanup-2026-09-20.md (sanitized); private evidence C:\Users\teddy\NianlifeOps\photo-quality-2026-09-20\.
- existing_input: v2/data/photo-quality.json is untracked preexisting deterministic sharp.stats cache (1937 entries); inspect read-only, do not overwrite or commit private media identifiers. lib/home-photo-quality.ts is a different AI homepage cache; do not conflate.
- acceptance: record exact sample ID privately and source/delivered dimensions; audit coverage total/scanned/failed/uncertain and candidate counts; review candidates visually, never mass-remove by single sharpness threshold; use higher-quality authorized original where available; confirmed bad photos excluded consistently in date album/home/memory/month selections; preserve originals, source linkage, stories and history; include reversible manifest and rollback.
- execution: first ACK with actual repo/head/current occupancy and ETA; then read-only diagnosis and bounded local scan using existing authorized local/read-only media access. No new external model calls. Prepare minimal implementation and tests if needed, but no production write/deploy. If broader paths needed, report them with evidence for Codex assignment.
- required_evidence: private manifest/contact sheets; sanitized root cause and coverage; exact code paths/SHA; typecheck/lint/tests/build exits; live read-only URL checks; explicit unverified items. Never claim deployed from push.
- push_policy: after checks, exact-stage only task changes and push current main per Teddy; Git/build operations serialized with active HEALTH worker, do not touch its files or locks.
- forbidden: hard delete, database writes, deploy/restart, new branches, bulk subject approval, new model costs, raw family data or credentials in Git/logs, changes to HEALTH work.
- eta: ACK promptly, first evidence in 15 minutes; report concrete blockers rather than guessing.
- result: C:\Users\teddy\NianlifeOps\photo-quality-2026-09-20\RESULT.md

## ACK
- acknowledged_at: 2026-09-20 21:47 (北京时间)
- worker: Claude Code（现有会话，nianlife.cn 性能/图片线）
- repository: C:\Users\teddy\Documents\Nianlife（与卡片一致）
- branch: main（卡片指定；不新建/不切换分支或 worktree。注意 exec-protocol skill 默认数据线拓扑为 `claude/data-line` + `C:\Users\teddy\Nianlife-worktrees\data`，本轮以任务卡为准，已记录差异，不自行切换）
- head_at_ack: b7778045c63df0c783274212fd36c3d8304375a9（= origin/main；比卡片 base_sha 4bdc083 多一条 b777804 "docs: dispatch reversible photo quality audit"，即本卡片自身）
- worktree occupancy（`git status --short --branch`，ACK 时）：
  - modified（他人/前序未提交改动，本轮不碰、不 stash、不回滚）：CLAUDE.md, collab/COWORK-TASTE-PROTOCOL.md, collab/state/ORCHESTRATOR-STATE.md, docs/HANDOFF-COMMANDER.md, docs/ORCHESTRATOR-INBOX.md, v2/public/fonts/nian-round/nian-round-extra-00.woff2, v2/scripts/quark-history-init-20260915.mjs
  - untracked：.github/skills/ui-ux-pro-max/scripts/__pycache__/, collab/tasks/{data,page}/DATA-0915-*/PAGE-0915-*.md（6 份）, docs/nianlife-handoff-2026-09-06-neon.md, v2/data/photo-quality.json（本轮只读输入）, v2/scripts/quark-heic-ingest-linux.mjs
  - 并发 HEALTH worker：其文件与锁不触碰；Git 操作串行，push 前重查 HEAD
- evidence_dir: C:\Users\teddy\NianlifeOps\photo-quality-2026-09-20\（已创建）
- eta:
  - 首批证据（样本精确定位 + 源/投递尺寸 + 覆盖盘点口径）：22:02 前
  - 完整只读诊断 + 候选清单 + contact sheet：23:00 前
  - 若需改代码（可逆排除清单 + 测试）：次日 00:30 前 submitted；无生产写入/部署
- scope confirmed: 只读诊断 + 本地有界扫描；不调用新的外部模型；不写数据库；不部署/重启

## R1 结案说明（被 R2 取代）
- R1 的只读盘点证据全部有效并被 R2 复用：audit.json（11,227 条三层尺寸）、displayed.json（线上爬取
  5,717 条引用，失败 0）、focus.json（4,173 条归一化清晰度，失败 0）、impact.json、sheets/ 联系表。
- R1 提出的实施方案（借 media_subject_check 写 1,312 条 store_only）被总指挥复核否决并撤销：
  它会在主体/隐私账本里留下不是在谈主体的行，分类码未逐张验证，内容版本是写前现取而非绑定审核
  当时的版本。对应脚本 v2/scripts/photo-quality-apply.mjs 已删除，**从未以 --commit 运行过，
  数据库零写入**。
- 实际交付见 collab/tasks/data/DATA-0920-PHOTO-QUALITY-R2.md 的 Submission 段与
  C:\Users\teddy\NianlifeOps\photo-quality-2026-09-20\RESULT.md。
