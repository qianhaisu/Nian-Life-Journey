# Nianlife Cowork 审美验收协议

生效日：2026-09-15

适用角色：Cowork（Claude），以及负责准备请求、唤醒和收取结果的 Codex

## 1. 适用前提与边界

Cowork 是产品原则和审美验收方，只基于浏览器真实渲染给结论。Cowork：

- 不派活、不写代码、不合并、不部署；
- 不修改仓库内任何状态文档；
- 不读代码评审审美，不用静态代码或执行方自述替代实际页面；
- 只把结论、截图和采集日志写入 `C:\Users\teddy\NianlifeOps`；
- 所有实质内容经文件系统传递，GUI 只用于被唤醒和浏览器验收。

调用时机：里程碑完成；影响视觉、排版、信息层级或文案的改动合并前；上线前。不要按每个 commit 调用。

备案期间 `nianlife.cn` 不可用。唯一可接受来源是本地 dev server 加当轮可达隧道（沿用 `tunnel-18080` 方式）。隧道断开或地址不可达时直接 `BLOCKED`，不猜、不看代码代替。

协议刹车：连续 3 轮验收不过即升级 Teddy；纯文档只本地 commit、不 push。每日 push 次数和单目标轮数当前不设上限，但应保留记录。Cowork 不执行 push。

## 2. 唯一通道与逻辑映射

运行时唯一物理目录：

```text
C:\Users\teddy\NianlifeOps\
  _inbox/cowork/<id>.md
  _state/cowork-ready.md
  _state/cowork-handoff.md
  _state/nianlife-product-principles.md
  _state/nianlife-product-principles.sha256
  _locks/gui.lock
  review-<轮次名>/
    README.md
    01-xxx/ 02-xxx/ ...
    capture-log.json
```

早期协议名仅作逻辑映射，不创建第二份结果或第二把锁：

- `collab/review-requests/<id>.md` = `_inbox/cowork/<id>.md`
- `collab/review-results/<id>.md` = `review-<轮次名>/README.md`
- `collab/screenshots/<id>/` = `review-<轮次名>/` 下分页面目录
- `collab/locks/gui.lock` = `_locks/gui.lock`

## 3. B0：每个 Cowork 会话先自举

文件夹授权按 Cowork 会话生效，不继承。授权只能由 Cowork 发起，Codex 只能在本机授权弹窗上批准。新会话未完成 B0 时，不读取任何验收请求；旧 ready 文件不会证明新会话已接通。

1. Codex 取得 `_locks/gui.lock`。
2. Codex 每一步先截图，确认 Cowork 会话窗口在前台且光标在输入框。
3. Codex 用剪贴板粘贴发送，禁止直接 type 中文：`请对 C:\Users\teddy\NianlifeOps 申请文件夹访问权限，完成后写 _state/cowork-ready.md`
4. Cowork 发起文件夹授权。
5. Codex 重新截图定位弹窗，点击“批准 / Allow”；不得硬编码坐标。
6. Cowork 写 `_state/cowork-ready.md`：

```yaml
authorized_path: C:\Users\teddy\NianlifeOps
authorized_at: <ISO-8601 +08:00>
session_id: <当前会话唯一标识>
context_remaining_percent: <0-100>
```

7. Codex 从文件确认 session_id 属于当前会话，释放 GUI 锁。此时才可派发审美请求。

失败处理：20 秒内没有授权框，Codex再截图一次；仍无则判定指令未送达，回步骤 2 仅重发一次。授权被拒绝或弹窗误关后不要重复申请，Cowork/Codex记 `BLOCKED` 并汇报 Teddy。ready 文件的 session_id 不匹配时视为失效，重跑 B0。

由于 B0 只授权 NianlifeOps，Cowork 不得假设自己能直接读取仓库 `docs/`。每轮请求前，Codex 把当前 `docs/nianlife-product-principles.md` 原文完整复制到 `_state/nianlife-product-principles.md`，把 SHA-256 写入同名 `.sha256`，并在请求中引用该哈希。Cowork 校验哈希后使用这份未摘要、未改写的快照。

## 4. GUI 互斥

唯一锁是 `_locks/gui.lock`，内容必须含 holder、时间戳、预计释放时间、用途。锁存在时，Codex 与 Cowork 中未持锁者只能读写文件，不操作鼠标键盘。

锁从取得起超过 10 分钟视为失效；仍需 GUI 的一方必须重新申请。Cowork 执行浏览器验收期间持锁；Codex 唤醒 Cowork 后立即释放自己的锁，转为轮询文件，不再碰 GUI。持锁方结束或中断时及时释放。

## 5. 请求完整性门

Cowork 只读取 `_inbox/cowork/<id>.md`。请求缺以下任一项，直接创建对应 `review-<轮次名>/README.md`，结论为 `BLOCKED`，不开始页面检查：

- 本轮实际可访问的完整隧道 URL；
- 需逐一检查的具体页面路径清单；
- 本轮改了什么、期望达到什么效果；
- 对应 commit 和分支。
- `_state/nianlife-product-principles.md` 的当轮 SHA-256。

建议同时记录：review id、里程碑、移动/桌面视口、已知范围外问题、输出目录名。请求文件不得包含凭据或家庭私密原文。

## 6. 真实页面验收流程

1. 打开请求给出的 base URL，先验证可达、页面不是错误页、运行版本可与请求 commit 对应；不对应则 `BLOCKED`。
2. 按路径清单逐页真实打开。至少覆盖请求指定的手机与桌面视口；交互项必须实际点击/滚动/播放，不用静态截图猜交互。
3. 对每个页面记录来源 URL、采集时间、视口、文件名和必要的运行 SHA；写入 `capture-log.json`。
4. 截图按 `01-页面名/`、`02-页面名/` 编号存放。长页同时提供可读分段图；全页长图不能作为唯一证据。
5. 校验请求中的原则 SHA-256 后，逐条对照 `_state/nianlife-product-principles.md` 原文快照：定位、Person First、Two Clocks、Media First、Invisible Automation、Life Is Not Equal Weight、Bring the Past Back、Automatic Reflection、The Family Owns Its Life，以及温暖但不幼儿化的视觉方向。
6. 只评价真实渲染结果，不打开代码来推断意图。看不到、打不开、版本不明就写未验证或 BLOCKED。
7. 写 `README.md`；完成写入后再释放 GUI 锁。

## 7. 结论格式

每条结论只用以下三级：

- `BLOCKER`：阻断合并或上线。Codex 不得自行忽略，只能修复或升级 Teddy 裁决。
- `SHOULD-FIX`：进入待办，必须在下个里程碑前清空。
- `POLISH`：记录，不阻断。

README 沿用 `gemini-ui-review-2026-09-11/README.md` 的“采集基线 → 页面范围/证据 → 结论 → 已知缺口 → 日志”结构。每条结论必须含：

```markdown
### <BLOCKER|SHOULD-FIX|POLISH> — <短标题>
- page: <具体路径>
- screenshot: <相对文件名>
- principle: <原则编号和名称/视觉方向条款>
- actual: <截图里实际看到的状态>
- expected: <应达到的状态>
```

README 末尾固定状态块，不得省略：

```yaml
status:
  cowork_session_id: <当前会话标识>
  context_remaining_percent: <0-100>
  continuation_needed: yes | no
  next_proactive_check_at: <ISO-8601 +08:00 | none>
```

“无 BLOCKER”不等于所有体验完美；分别汇总三个等级和未验证项。截图必须能追溯到 capture-log 中的 URL 与时间。

## 8. 唤醒、轮询与不重复派发

Codex 唤醒 Cowork：请求文件写完并核对 ready → 取锁 → 截图确认窗口/输入框 → 剪贴板粘贴 `读 C:\Users\teddy\NianlifeOps\_inbox\cowork\<id>.md 并执行审美验收` → 截图确认进入对话 → 释放锁。

之后 Codex 每 5 分钟只轮询目标 README。20 分钟没有结果时，才重新取锁截图一次，判断 Cowork 是运行中、等权限还是中断；随后释放。Cowork 运行期间不得重复派发同一 request id。

## 9. 主动巡检与会话续接

Cowork 可自行发起巡检，结果写 `review-proactive-YYYY-MM-DD/README.md` 和对应截图/日志。主动巡检不产生任务、不改变优先级、不修改任何状态文档；Codex定期收取并决定后续。

当状态块报告 context 余量低于 25%，或连续两次派发无响应时，由 Codex换新 Cowork 会话，顺序不可颠倒：

1. 当前 Cowork 先写 `_state/cowork-handoff.md`：已形成的审美判断、未清 BLOCKER、反复问题、对产品原则的解读要点。
2. Codex 在 Claude 桌面应用新建带固定前缀的 Cowork 任务。
3. 新会话跑 B0。
4. 首条任务是读 `_state/cowork-handoff.md` 并接手。

新会话没有上文；handoff 是唯一传承。未写 handoff 不得换会话。是否续接只看 README 状态块，不从截图读取百分比。

## 10. 失败与升级

- 请求缺字段、URL 不通、运行 SHA 不符、无法截图：`BLOCKED`，写清已验证事实与缺口。
- GUI 锁被占：只做文件读写，等待释放；不抢鼠标键盘。
- 授权失败：按 B0 失败规则停止，不连续弹窗骚扰 Teddy。
- 证据含私密数据：停止采集，不把截图写入仓库或外部服务；报告具体风险但不复制敏感内容。
- 与 Codex 对 BLOCKER 判断冲突：保留原结论，双方都不得自行降级，升级 Teddy。
- 连续 3 轮验收不通过：写 BLOCKER 并要求 Codex升级 Teddy。单目标轮数本身不构成限制。

## 11. 最小可跑示例

1. 当前 Cowork 首次使用，先完成 B0，`cowork-ready.md` 写入当前 session_id。
2. Codex 同步产品原则原文及 SHA-256，再写 `_inbox/cowork/PAGE-0915-001.md`：隧道 `http://127.0.0.1:18080`、路径 `/memory`、标题层级调整目标、commit、`claude/page-line` 和原则哈希。
3. Codex 取锁，用剪贴板发送“读 …PAGE-0915-001.md 并执行审美验收”，确认送达后释放。
4. Cowork 取锁，真实打开手机和桌面 `/memory`，截图保存到 `review-PAGE-0915-001/01-memory/`，在 `capture-log.json` 记录 URL/视口/时间。
5. Cowork 对照产品原则写 README；若标题仍让功能压过“张年”本人，写 `SHOULD-FIX` 或影响核心层级时写 `BLOCKER`，附页面、截图、原则一与期望状态。
6. Cowork 写固定状态块并释放锁。Codex只从 README 收活，不从 Cowork聊天自述判定通过。
