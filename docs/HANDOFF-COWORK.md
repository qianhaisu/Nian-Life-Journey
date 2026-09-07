# HANDOFF-COWORK · Cowork 会话交接文件

维护者：Cowork | 最后更新：2026-09-07 CST | 格式：≤80 行，下一会话接续用

## 身份与角色

- Cowork = 任务分发 + 初步审核；Codex = 总指挥/总审核；Code A/B/C = 执行
- 单写人协议：COMMANDER-INBOX.md 由 Cowork 写；三轨入箱由 Cowork 写；STATE.md 由 Cowork 维护

## 当前基线

- 上一轮提交：commit 0001191（ACK + 三轨派单）
- .git/index.lock: 存在（0 字节，遗留），使用临时索引绕过，勿删
- 安全约束：不访问生产库/站点；不部署；不索取凭据；儿童信息按敏感数据处理

## 活跃任务看板

| 任务 ID | 轨道 | 状态 | 交付物 |
| --- | --- | --- | --- |
| MIG-A-001 | Code A | queued（已派，等 ACK）| Phase 2 §18+ 进度 + 备份元数据核查 |
| MIG-B-001 | Code B | queued（已派，等 ACK）| docs/migration-B-acceptance.md |
| MIG-C-001 | Code C | queued（已派，等 ACK）| docs/migration-C-readiness.md |
| OPS-A-001 | Code A | queued（本轮派）| inbox 调度状态 + HANDOFF-A |
| OPS-B-001 | Code B | queued（本轮派）| inbox 调度状态 + HANDOFF-B |
| OPS-C-001 | Code C | queued（本轮派）| inbox 调度状态 + HANDOFF-C |

## Scheduler 状态

- Cowork 定时触发器：未配置（list_triggers 返回空；云端任务需桌面在线，缺口已上报）
- 唤醒方式：Teddy 手动触发 或 三轨在 STATE.md 写阻塞信号

## Neon 状态

- 当前计划/配额：未实时核验（旧 Free 配额耗尽记录已撇回）
- 生产备份：未完成；NIANLIFE-RUN-FULL.bat 就绪，等连接串

## 接续指引

1. 读 docs/COMMANDER-OUTBOX.md 最新命令（游标：CMD-20260907-005）
2. 读 docs/COMMANDER-INBOX.md 末尾确认上轮 ACK 游标（当前：COW-ACK-20260907-002）
3. 读三轨 STATUS*.md 尾部确认 MIG/OPS ACK 状态
4. git 写操作：`export GIT_INDEX_FILE=$HOME/.git-index-tmp; git read-tree HEAD`，再 add 指定文件，commit，cp 回 .git/index
