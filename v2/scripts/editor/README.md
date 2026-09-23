# 夜间编辑（scripts/editor）

每晚 23:30 的「Nianlife WeChat Daily Sync」只把微信**搬进数据库**。「从消息里读出东西」（月页内容、待办）
从来没有自动化过（2026-09-20 查明，见 `docs/STATUS.md`）。这里补的是月页内容那一步。

## 零件

| 文件 | 作用 |
|---|---|
| `plan.mjs` | 决策层，纯函数：今晚该写哪些天、消息过滤、敏感兜底、模型输出形状、时间词核对、失败计数 |
| `validate-day.mjs` | 守门人：引语逐字对得上来源、**引语归在真正的发送人名下**、**点名有证据**、**不许「有人/大人/一位…的」**、引号配对、注册表外的称谓、真实姓名、技术字样、无来源的「第一次」 |
| `identity-rules.mjs` | 称谓的唯一来源：允许的称谓 = family-registry 的 narrativeLabel；发送人 → 称谓按注册表解析（含会话范围） |
| `mark-source.mjs` | 给月内容的每一天补 `_source`：与生成记录逐字相同 = machine；对不上 = 不标记（按人工保护） |
| `append-day.mjs` | 只追加/替换一天，**绝不整体覆盖**月内容 |
| `nightly-editor.mjs` | 编排：读库（只读）→ 选日 → 组材料 → 无头 Claude 写草稿 → 校验 → 追加 → 可选发布 → 留账 |
| `nightly-editor.cmd` | 计划任务的包装（**纯 ASCII**，见下） |
| `register-task.ps1` | 注册计划任务「Nianlife Nightly Editor」，每天 00:15 |

## 默认不发布

`nightly-editor.cmd` 里 `NIANLIFE_EDITOR_PUBLISH=0`：每晚只写草稿到
`NianlifeOps\ops-daily\editor\drafts\`、摘要到 `digests\`，**不装入生产**。抽检若干晚、确认可以之后，
把那一行改成 `1` 才会发布。发布后每天仍写摘要，出错可 `deploy-ecs-public.sh content-rollback` 逐月撤回。

## 私有文件（不在 git 里，缺了就拒绝运行）

- `NianlifeOps\ops-daily\real-names.private.json`：正文里不能出现的真实姓名（缺清单时静默放行等于没校验）
- `NianlifeOps\ops-daily\editor\BRIEF.day.md`：提示词模板，由 `build-brief.mjs` 从 `EDITOR-BRIEF.md` 摘出适用章节生成，含家里的称呼

## 必须知道的几件事

1. **代理**：本机在国内，访问 Anthropic 走 `127.0.0.1:7994`。**不要在任何包装里清除 HTTP_PROXY / HTTPS_PROXY**——清掉会得到假的
   `403 Request not allowed`。夜里代理程序没开，任务就会失败（日志里会明说）。
2. **`.cmd` 必须纯 ASCII**：计划任务的控制台用 GBK 代码页，一个中文字节就能让整个任务悄悄坏掉（2026-09-16 的教训）。
3. **两天延迟**：只写「今天−2」及更早的日子。WeFlow 导出是「昨天」预设，某一天要隔天导出才齐，今天/昨天的只有半天。
4. **只在电脑开着、你已登录时才跑**（计划任务是 Interactive 登录），和同步任务一样。
5. **模型没有任何工具**：`--tools ""`；在空目录里跑；不存会话。最坏情况是写出一篇会被校验拦下的稿子。
6. **通过校验 ≠ 可以发布**。机械校验抓不到主语错误（把 A 做的写成 B 做的）、也判断不了「钱款/夫妻争执/伤痕来由」这类要判断的内容。
   dry-run 阶段的抽检就是为这个。

## 手动跑

```
# dry-run（默认）：草稿写到 NianlifeOps，不碰生产
node --import tsx scripts/editor/nightly-editor.mjs

# 调试：只处理指定的天（绕过「今天−2」与「已覆盖不重写」，所以**禁止与 PUBLISH 同时使用**）
set NIANLIFE_EDITOR_DAYS=2026-09-18 && node --import tsx scripts/editor/nightly-editor.mjs
```

## 安装

`nightly-editor.cmd` 与 `register-task.ps1` 在仓库里是**模板**（git 会改行尾）。实际运行的是 `v2\.data\` 下同名的那两份
（`.data` 不进 git，`.cmd` 必须保持 CRLF + 纯 ASCII）。装计划任务：

```
powershell -ExecutionPolicy Bypass -File v2\.data\register-editor-task.ps1
```
