> **【重要说明】本目录下早期关于 `Nianlife Nightly Editor`、无头模型写稿（`nightly-editor.mjs` / `day-writer.mjs` / `regen-month.mjs`）及 DeepSeek 识图的内容已被 `STYLE.zhang.md` 第二版（2026-11-12）与 `docs/daily-editor.md` 取代，一切写作准则、照片锚定与每日审编流程以 `STYLE.zhang.md` 和 `docs/daily-editor.md` 为准；严禁启动任何旧模型编辑脚本。**

# 编辑管线与校验工具（`scripts/editor`）

## 当前现行模块（2026-11-12）

| 文件 | 作用 |
|---|---|
| `STYLE.zhang.md` | **唯一现行写作与审核准则（第二版）**：先看图后读消息、三层素材权限（事实 / 画面 / 有分寸的联想）、事实与隐私红线、段落照片锚定 `mediaIds` 与首屏图注 `photoCaptions` |
| `validate-day.mjs` | 纯函数守门人：引语逐字核验与说话人归属、引语数量上限（全篇 ≤4、单段 ≤2）、注册表称谓白名单与点名证据、含糊指人拦截、隐私与真实姓名拦截、无来源「第一次 / 终于 / 比以前」拦截、照片说明书腔 / 群聊转播腔 / 编辑旁白 / 育儿套话 / 四段以上报时拦截 |
| `codex-editor.mjs` | 会话审编证据打包（`prepare`）与候选构建强校验（`apply --literary`）：校验来源 SHA-256 指纹、段落照片锚定 `paragraphMedia`、首屏图注 `photoCaptions`（≤20 字）、每日精选原话 `featuredQuote`、人工稿保护与 `_revisions` 历史归档 |
| `session-photo-review.mjs` | 零外部模型私密照片目视审核（`prepare` / `apply`）、按日 90 秒连拍折叠选片（`curate`），以及写稿前按日生成带 `mediaId` 标注的看图联版（`day-sheets`） |
| `pipeline-status.mjs` | 全链路健康巡检（`inspect`）、ECS 内部缓存刷新（`revalidate`）与每日编辑账本原子记录（`record-editorial`） |
| `identity-rules.mjs` | 家庭称谓唯一来源（由 `lib/organizer/family-registry.ts` 派生） |
| `append-day.mjs` / `plan.mjs` | 按日原子追加/替换与时间词、敏感词纯函数检查 |

完整每日审编与历史重写操作步骤见仓库文档 `docs/daily-editor.md`。

---

## 历史记录（已停用的早期夜间脚本说明，仅供归档备查）

每晚 23:30 的「Nianlife WeChat Daily Sync」负责把微信导出归档并同步入阿里云 RDS 与 OSS。早期曾尝试用计划任务 `Nianlife Nightly Editor`（`nightly-editor.mjs` / `day-writer.mjs` / `regen-month.mjs`，已于 2026-10-12 永久禁用）无头生成草稿；自 2026-11-11 起已全面切换为 Antigravity 每日 00:30 定时会话审编链路。

### 私有文件（不在 git 里，缺了就拒绝运行）

- `NianlifeOps\ops-daily\real-names.private.json`：正文与图注里不能出现的成人真实姓名（缺清单时直接拒绝运行，绝不静默放行）。
