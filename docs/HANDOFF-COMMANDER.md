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

## 2026-09-10 · 私有诊断站验收复核（已批准顺序第 1 步，Claude Code 执行）

摘要写在 `docs/STATE.md` 顶部「当前摘要（2026-09-10）」，这里只留结论与需要总指挥决定的事。

- **已验证**：诊断容器实际跑 `nianlife-web:8b8b5829…`（image `1dec65996892`），构建上下文与 `8b8b582` 的 git blob 按内容逐个相等，`d3efa81`/`c57e475`/`8b8b582` 三处改动确实在运行版本里；接阿里云 RDS `pgm-bp11778gex0hi870`（PostgreSQL 18.4），`MEDIA_STORAGE_PROVIDER=oss`，Organizer 关闭；页面图片经真实 `/api/media` 交付的字节与 OSS object 字节 sha256 相等；hot 派生 100% 有 oss 对应行，页面读取不再依赖旧存储。
- **与上一轮回执不一致（需判断）**：`/memory/2026/08` 的 8 月 19 日仍显示餐牌主图 + 两张缩略图（含被摘掉的 `wechat-media:f919…967`）——月页图片由 `lib/publication-moments.ts` 按当天媒体选，不读 `heroMediaId`/`NO_HERO_MEDIA_ID`；详情页确实已只剩文字。上一轮「月页只剩文字、无图」不成立。
- **同类残留**：`/` 与 `/memory` 仍在构建期烤进 mock（镜像内 `index.html` 链接 event-car/daycare-ball/lake），每次启动/部署后头 5 分钟先发 mock 页；`8b8b582` 只堵了月页。
- **未确认**：移动端窄屏渲染（浏览器工具改不动视口，不冒充）；视频仍无任何 poster/preview 派生，四种 variant 全 404，但呈现层已扣住、页面无坏元素。
- **单独待办**：凭据轮换（上一轮误打印过完整环境变量），本轮未处理。
- **边界**：OSS 完成范围只是固定 thumbnail/web 派生集，不代表原图与视频归档完成；旧来源保留、不退役 R2；镜像回滚与数据回滚互相独立，本轮未回滚；公开切换前仍需保护 RDS 新写入的方案；备案前继续 loopback+SSH 隧道，18080 由其他 session 维护、本轮只复用。
- **待补**：已批准顺序的第 2–5 步内容没有写进仓库任何文档，本轮不臆造，请总指挥补写。
- **本文件第 14 行（Phase 2 真实运行结果）是其他 session 的未提交改动，本轮未动、未代提交。**
