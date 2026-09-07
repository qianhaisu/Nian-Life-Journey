# 当前生效：Codex 直接对接 Code A/B/C

2026-09-07，依据 Teddy 明确同意移除 Cowork 中间层。本文件覆盖旧协作文档的角色、派单、初审和唤醒条款；原有隐私、历史、main、检查后 push 和人工生产发布规则不变。

## 角色与入口

- Codex 总指挥直接拆任务、派单、跟踪、审核和向 Teddy 汇报。
- Code A/B/C 自检后直接回报 Codex，不等 Cowork 转派、初审或放行。
- Cowork 停止本项目派单和写入，不再是执行依赖；旧回执和交接保留。OPS-WAKE-001 取消，不再创建 Cowork 调度。
- Codex 独占三轨 INBOX 当前看板与 STATE；A/B/C 各自独占本轨 STATUS 和 HANDOFF。COMMANDER-OUTBOX 用于全轨指令；COMMANDER-INBOX 仅保留旧 Cowork 通信，不作为收件主入口。

| 轨道 | 直接入箱 | 直接出箱 | 当前任务 |
|---|---|---|---|
| A | docs/ORCHESTRATOR-INBOX.md | docs/STATUS.md | MIG-A-001：离线核对正式备份产物元数据、实际执行状态与阻塞 |
| B | docs/ORCHESTRATOR-INBOX-B.md | docs/STATUS-B.md | MIG-B-001：离线迁移后页面与产品八原则验收清单 |
| C | docs/ORCHESTRATOR-INBOX-C.md | docs/STATUS-C.md | MIG-C-001：离线迁移准备、费用保护缺口与发布回滚清单 |

以上任务沿用旧 ID 和原有文件范围，不重新开始已完成工作。旧卡的“等 Cowork”“不 push”和 Neon 当前 Free 配额断言失效：依用户要求检查后 push main；Neon 当前状态未实时核验。仍不允许新开生产连接、备份、部署或采购。A 仅查任务专用目录，不枚举整个 Downloads 或输出私人文件名。

## 立即执行顺序

1. 每轨读当前卡、核对出箱和占用；未接单则写一句任务 ACK，已接单则继续，不能重复执行。
2. 先完成本轨 OPS-A/B/C-001 的收件调度设置，再继续 MIG 离线任务；调度设置只做一次能力检查，有真实限制即报告，不能拖住 MIG。
3. 用本会话支持的 Cron 工具或 `/loop` 配置唯一每5分钟收件任务；已有则复用。工具不支持时写明实际限制，不把普通等待算调度。
4. 定时提示只读本轨最新卡和 HANDOFF，按任务 ID 去重；无变化立即结束，不写心跳；空闲两轮退到15/30分钟。任务阶段完成时也主动读入箱。
5. 写真实调度 ID、下次触发和恢复办法；自然触发时写一次 scheduled PONG。文件写入不等于唤醒；本机运行依赖设备/会话可用。压缩后确认调度仍有效。
6. 完成 MIG 后交短证据摘要：修改路径、SHA、检查结果、未验证项、下一步；由 Codex 审核。状态简化为 queued → acknowledged → running → submitted → final_pass/changes_requested。

## 持续约束

- 每轨一个执行任务，共享文件/Git 操作串行；精确暂存，保护其他会话修改，不绕过活跃锁，不强推、不新建分支。
- 构建测试不碰生产，收费任务有明确范围、次数、并发、时间和停止边界；本轮离线卡不新增生产权限。
- HANDOFF 不超过80行，保留任务ID、授权、证据、占用、消息游标和调度。安全节点压缩上下文，不携带完整日志/凭据/家庭原文。
- Codex 本线程后台30分钟复核，空闲可退每小时，常规每小时汇报。自己的自动任务不代表三轨已接通。
- 三轨实际任务产物、调度ID与自然PONG齐备前，不宣称无人值守。原 COORDINATION-RUNTIME 的费用和效率细则继续使用，但移除其中 Cowork 依赖。
