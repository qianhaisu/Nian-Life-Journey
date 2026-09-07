# 总指挥短交接

> 最新决策：Teddy 已同意移除 Cowork。先读 DIRECT-COORDINATION.md，直接读三轨 STATUS/派单至 INBOX；不再追 Cowork PONG。现有 MIG/OPS 任务沿用，由 Codex 总审。下方早期状态只作参考。

更新：2026-09-07。角色：Codex 总指挥/总审核。只在真实状态变化时更新，限 80 行。

- 用户要求：Cowork 派单/初审，Code A/B/C 执行，入箱出箱协作；定期报告需要用户的事项；减少空转、上下文与费用风险。
- 规则：AGENTS.md → COORDINATION.md → COORDINATION-RUNTIME.md；当前 main，不建分支，精确提交 push，人工生产发布，不覆盖 V1/历史/隐私。
- 最后已读回执：COW-ACK-20260907-001。A/B/C 初始化 ACK 已见；MIG 任务回执另计。总指挥已在 CMD-003 退回 Cowork 关于 Neon 当前 Free/配额耗尽的无依据判断。
- 当前调度：应用 ID `nianlife`，已更新为 ACTIVE、每30分钟，仅本线程；空闲退至每小时。Cowork 和三轨没有已验证的自动唤醒；CMD-004 要求各自配置并做自然触发验收。
- 当前工作：MIG-A-001 备份元数据核对；MIG-B-001 离线页面验收清单；MIG-C-001 离线迁移准备；增加 OPS-WAKE-001 和各轨运行检查点，详见 COMMANDER-OUTBOX 增量。
- 已知事实：Phase 2 §18 / 2a9496b 本机模拟成功；生产备份尚未在此验证完成。Neon 当前计划/配额未实时核验；不要从旧停工通知推断要升级付费。
- 当前总指挥无生产占用、无生产进程；未授权新开备份、部署、DNS、采购。历史中的具体执行授权需核对原出处，不重复索取可用凭据，不扫描旧日志找秘密。
- 本轮提交阻塞：现存 `.git/index.lock`（2026-09-07 22:31:21 本机时间），未删除；CMD-005 已请求持有者释放。四个总指挥文件本地待提交：COORDINATION、COORDINATION-RUNTIME、COMMANDER-OUTBOX、HANDOFF-COMMANDER。锁正常释放后复核暂存区，只提交这些文件并 push；当前远端已有 Cowork 三轨派单 0001191。
- 他人修改：package-lock、临时脚本、Cowork 的入箱/STATE、三轨 STATUS 不代提交。Git 操作前重新 status/diff 并核对当前 HEAD，其他会话可能推进 main。
- 验证基线：CMD-002 记录 typecheck/lint 通过，测试 645 pass/10 skip，2a9496b 的 V2 源码隔离 build 通过。后续仅协作文档提交；是否可复用需比对 v2 源码树和依赖。
- 下一动作：读 COMMANDER-INBOX 新消息和三轨 MIG/OPS 回执；纠偏是否 ACK、唤醒是否有实际 scheduler ID/PONG、备份是否有恢复对账证据。无变化不写文件、不重复检查全历史。
- 常规用户汇报每小时；后台检查可以更频繁但无变化不打扰。紧急费用/数据/发布问题立即汇报，不宣称休眠时实时监控。
