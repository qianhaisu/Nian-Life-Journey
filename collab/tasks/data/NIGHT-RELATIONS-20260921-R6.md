# NIGHT-RELATIONS-20260921-R6 — 证据复核与持续审核闭环

- status: queued
- recipient: 既有 Claude Code `Nianli history memory relations audit` 会话
- parent: NIGHT-RELATIONS-20260921
- branch: main（用户最新指令覆盖旧 worktree/Cowork 拓扑，不建分支）
- baseline: 27df9a5a6e88e135ae6a45566d80f173be4d09b2；执行前刷新，保护其他会话未提交修改
- ordering: 单执行者负责下述数据/Organizer范围；先证据复核，再审核链路改动与测试，再必要发布，最后 Codex 复核；无其他轨合并依赖
- authorization: Teddy 在原任务授权修复、可回滚数据处理和验收后生产发布，本轮明确要求「继续安排」。不需要 Teddy 逐条内容审核，不重复询问常规授权。不恢复 Cowork 中间层。
- ACK: 读取后立即在下述私有 R6-STATUS.md 写 acknowledged、真实 session、基线、正在占用的文件、计划及预计完成时间；15分钟内提供第一个实际检查点，预计60–120分钟，超时写具体检查点。

## 先读现有证据
C:\Users\teddy\Documents\NianlifeOps\artifacts\NIGHT-RELATIONS-20260921\RESULT.md
C:\Users\teddy\Documents\NianlifeOps\artifacts\NIGHT-RELATIONS-20260921\CODEX-SOURCE-STORY-AUDIT.json
C:\Users\teddy\Documents\NianlifeOps\tasks\NIGHT-RELATIONS-20260921-PROMPT.md

Codex 最新生产只读核实：两份指定来源分别关联158/241条life_events，全部通过当前展示门槛；本轮 agent-review-20260922-v1 共298条，每条reason_codes只有同一 agent_evidence_review_passed，provider=agent，无逐条内容哈希绑定。结果文件的四条通用门槛不足以证明事实/人物/重复均已核查。不要重新全量导入、全量重建故事或把已经可展示的399条一律撤下。

## 本轮必须完成，两项都在原任务范围

A. 实际逐条复核两份来源的399条现有故事，优先检查本轮298条审核涉及的目标，并核对集合边界是否含其他来源。
- 每条读取其精确source_ids及必要上下文，逐项核实故事事实、张年主体、日期、people和媒体归属；发言人不等于故事参与者。复核与已有故事重复/冲突，不以句长、无占位符、旧subject-gate通过代替阅读证据。
- 私有逐条账本记录eventId、被审核正文版本/hash、精确来源消息定位及hash、事实/人物/时间/重复结论、判定理由、审核者、时间。若沿用既有有效审核证据，记录可验证引用与未变化的内容hash。
- 不因原记录理由简单就假定故事有错；证据充分保留，发现实际错误则按已有版本保留机制修正/暂存，保留旧内容和决定。不能跳过现有人类决定保护；真实冲突只隔离该项，其余继续。
- 使用recordClaudeStoryDecision及现有内容版本校验/锁/幂等入口写新审核决定，禁止直接INSERT绕过约束或覆盖旧审核记录。先核实旧provider=agent的语义；不得伪装成人类或更改provider来绕过保护。

B. 接通未来整理后的真实证据审核。
- 覆盖organizer-month-write.mjs及实际生产Organizer入口，不只加一个没人执行的函数。
- 生成后自动调用基于原始证据的审核，再用recordClaudeStoryDecision记录带reviewedContentSha256的决定；使用现有已配置能力，不引入新采购，不无上限调用，记录批次/调用量/重试上限。
- needs_human_review不是交给Teddy的待办。代理能解决的自行核实与修正；证据不足保留未确定并记录原因。不得用四个形式门槛无条件自动批准，不得生成审核假证据。
- 支持中断后续跑、有限重试、幂等，以及来源/正文改变后的重新审核；审核失败不能误显示已完成或伪造批准。旧故事无需因重复运行被反复改写。
- 用合成测试覆盖：事实不符/错人物、同窗口无关发言人、同事件重复、内容变更导致旧审核失效、审核服务失败、重复运行、人类决定保护、合格故事自动进入展示。

## 范围和保护
允许：v2/lib/organizer/**、v2/lib/db/postgres-repository.ts 中相关审核入口、v2/scripts/organizer-month-write.mjs及必要审核执行脚本、对应v2/test/**、本任务状态与脱敏交付文档。生产数据修改限上述来源相关故事/关联/审核记录，先备份并验证恢复路径。
禁止：改首页设计与提醒、夹带其他会话修改、改公开范围、删除源聊天/历史、提交凭据或私有原文、重启无关任务。任何跨范围需求先给Codex具体证据，不让Teddy做常规技术取舍。
当前工作区有其他会话首页/提醒等修改，不得暂存或覆盖；Git写操作、构建与部署串行。

## 验收与交付
1. 私有账本覆盖本轮399条（刷新后若有变化说明差异），统计批准/修订/合并/待核并闭合；写清298审核行与399故事的对应关系。
2. 实际重复执行受控审核批次，证明没有重复事件/审核行；故意改变测试正文时旧hash不能批准。
3. 类型检查、Lint、相关测试、生产构建的命令/退出码/日志。按用户要求精确提交push当前main。
4. 既有生产ECS 47.99.243.155发布授权继续有效；验收合格后必要时发布，串行执行正式流程及保留规则，报告SHA、两个回滚版本、清理、磁盘。不得夹带未验收的其他工作树内容；无法安全发布则明确阻塞并继续可独立工作。
5. 从生产实际读取规则和真实浏览器核对两个来源代表性页面及外婆/雪姨人物关联。保留现有合格证据，只补变化部分。
6. 写私有 R6-RESULT.md / R6-STATUS.md，目录同原RESULT.md；逐条账本为R6-review-ledger.jsonl。仓库只放脱敏摘要和合成测试。提交后等Codex实际复核，不自称Codex final_pass。

不要再建议“单独排小任务”，不要把执行方审核移交Teddy，不要把统一reason_code当成逐条证据。真实阻塞必须具体，其他安全工作继续。
