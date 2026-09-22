# NIGHT-RELATIONS-20260921-R7 — 修正伪证据审核，完成原任务

status: queued
recipient: existing session_01UFD7yHbepM7LmPytXGJY1s
parent: R6 (changes_requested)
branch: current main; no new branches. Preserve all unrelated working changes.
authorization: Teddy 本轮明确「继续安排啊 不要停」。原任务的数据修复和验收后ECS发布授权继续有效；不让Teddy做内容审核或再说部署口令。Codex在本轮持续监督，按文件接收产物。

立即禁止部署97eed03的关键词自动批准实现。不是停止工作：在同一任务修正后继续完成。先写私有R7-STATUS.md ACK，10分钟内交真实审核小样和实现方案供Codex快速反馈；其余独立工作继续。

证据：R6临时脚本isSubstantiveContent/isAboutZhangNian/hasRealSourceText仅检查长度、泛词、是否有原文，甚至peopleIssues也不阻断批准；日志399条审核约10毫秒完成。organizer-month-write.mjs tryAutoReview只凭>=15字及“今天/妈妈”等词批准，完全没读来源。这不满足任务。不要继续使用这些规则生成approved。

执行顺序（同一执行者串行写入，无Cowork）
1. 先修正/移除不合格auto-review，不降低现有审核门槛，不回滚他人提交，不将399条全体撤下。保护已知有效内容。
2. 从原两会话的399条最新故事及source_ids生成私有证据包；每条包含正文与people/时间、精确原始消息、说话人可靠身份映射、必要上下文、相关重复候选。语义审核必须由Claude或现有已授权模型真正读取证据逐项判断，不是正则伪造。
3. 审核输出逐项claim→sourceMessageId支持关系，人物是否参与该事件、时间是否支持、重复/冲突判断、是否应改写/合并/保留/暂存、具体理由、内容hash及来源hash。先交10条含可疑人物/主角/时间/重复案例的小样R7-pilot.jsonl。不能只写source_count。全量账本R7-review-ledger.jsonl。
4. 以实际证据修正错误。未经核实不要大范围撤下或清空people。正确故事无需改写；有来源缺口的暂存具体项。298条旧provider=agent记录与真正家庭决定严格区分：核实其原审计来源，提出保留历史且不越过真实家庭决定的兼容处理；不能简单伪装provider绕过guard。通过正式recordClaudeStoryDecision及content hash guard写入，不直接SQL INSERT绕过。准确报告成功写入/幂等/受保护/失败，不把保护跳过当作新审核成功。
5. 自动流程必须读取原始证据并调用真实语义审查，覆盖实际生产入口及月批次入口。可复用现有模型接口/审核管道，先探索代码再实现，不能新购服务。按小批次、低并发、有限重试、可续跑、缓存未变证据控制消耗，记录调用数量。失败不得自动approve。需要审核的内容是代理待办，不是Teddy待办。
6. 合成对抗测试必须覆盖“今天妈妈去开会”等成人事件、人物在同窗口但未参与、故事与来源矛盾/臆造细节、重复事件、来源/正文变更、服务失败、重复执行及真实家庭决定保护；测试必须调用实现本身，不能复制一个测试版tryAutoReview自证。
7. 类型检查/Lint/相关测试/构建、真实受控重复运行、两个来源代表页面检查。精确提交push main。满足验收再部署ECS 47.99.243.155及执行既定保留清理，不要求Teddy重复确认；发布串行且不能夹带其他会话未验收代码。暂不可部署则继续独立工作并写具体限制。

继承R6允许文件范围和隐私/备份/历史保留要求。所有原文、账本及备份置于C:\Users\teddy\Documents\NianlifeOps\artifacts\NIGHT-RELATIONS-20260921。输入仍为原任务两JSON，不扩展到其他私人聊天。不得以DB无记录排除出生前源文件审计。

产物：R7-STATUS.md、R7-pilot.jsonl、R7-review-ledger.jsonl、R7-RESULT.md（同上私有目录）。状态每完成实际批次更新，先交小样，不要等全量跑错再通知。Codex会从文件检查并写R7-FEEDBACK.md，请每个批次/里程碑读取反馈，无反馈继续已授权工作。预计首个小样10分钟，完成预计90–150分钟；若不足明确游标，不宣布完成。父会话须核对你fork执行者的实际内容，不盲转“已完成”。
