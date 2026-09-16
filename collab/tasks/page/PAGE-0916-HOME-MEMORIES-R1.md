# PAGE-0916-HOME-MEMORIES-R1

- line: page
- status: queued
- round: 1
- branch: main（用户本轮提供的规则：只使用 main；不新建分支）
- workdir: C:/Users/teddy/Documents/Nianlife
- base_sha: 89ce007a8e37265fcf9858c8f21a34523e7fcf84（设计任务建立前；接单时核对后续纯文档提交）
- depends_on: none；只启用一个执行者，禁止另起并行写 main 的执行线
- merge_order: 页面 Claude 在当前 main 精确提交并 push → Codex 审核 → 用户另行决定发布
- authorization: 用户先要求给设计稿、拍板后交 Claude 实现，随后确认「方向可以 字体和配色可以听新 skill 的」。本轮范围为首页实现与本地验收。
- objective: 实现 docs/nianlife-home-design-2026-09-16.md 的两个首页部分、精选回忆播放和真实微信近 7 天提醒；新 UI skills 决定字体和配色。
- design_reference: C:/Users/teddy/NianlifeOps/design-HOME-0916/home.png 与 player.png。只供理解构图，不作为网站图片；字体和颜色按用户授权完善。
- required_read: 上述设计稿、AGENTS.md、docs/nianlife-product-principles.md、三份设计 skill。最新用户的两个模块及提醒口径覆盖旧首页模块数量、6 小时轮换和旧提醒置顶策略。
- allowed_paths: v2/app/page.tsx、v2/app/home.css；v2/components/home-*.tsx 和对应局部样式；v2/lib/home-*.ts；为本功能单独新增的纯函数模块 v2/lib/home-memory-*.ts / v2/lib/home-weekly-*.ts；相应 test/home-*.test.mjs；v2/public/fonts 和 v2/public/audio 的合法静态资产及许可证；本任务卡结果区和 docs/nianlife-home-implementation-2026-09-16.md。
- shared_paths: 如必须改 v2/app/globals.css，仅限新增本首页作用域下的样式，不能重写全站主题；不得改 package.json / lockfile、通用 schema、导入器、存储或 Organizer。需要新增查询能力时先报告精确接口缺口，继续可独立完成的界面工作。
- ownership: 主 checkout 有他人既有改动。先列出允许范围内的冲突；不得暂存、覆盖或恢复他人修改。若该范围存在另一位执行者，报告具体冲突，不自行切换工作树或建分支。
- acceptance: 按设计稿最后一节验证，尤其真实分组照片、真实可听音乐、暂停和退出行为、近 7 天微信来源过滤、没有事项时留白；不能把旧多故事轮播包装为同一段回忆，不能硬编码示例待办、照片、日期或曲名。
- data_boundary: 优先复用既有 archive / home-feed / reminder source 数据与缓存；不新增整库扫描、不读取全量原聊天正文、不做付费视觉/文案模型调用。真实材料不足要说明缺口并保留真实降级，不能制造合格回忆。
- forbidden: 生产发布、服务器/数据库写入、迁移、删除历史、启动 Organizer/worker、放开公网 POST、新登录权限系统、改 V1、新建分支、强推、把儿童概念图提交或上传第三方。
- eta: 接单后给一个实际预计完成时间；首个检查点为 ACK 后 15 分钟。不制造例行进度文档。
- required_evidence: 修改清单、commit/远端 SHA；typecheck/lint/相关行为测试/build 的命令与退出码；本地可打开 URL；手机/桌面截图和短播放录屏路径；空/有提醒结果；真实音乐来源及授权；无法验证的项目逐项说明。
- push_policy: 按用户本轮规则，完成检查后精确提交并 push 当前 main；不因旧 runbook 的文档不 push 条款停下。不能触发生产发布。
- stop_conditions: 活跃路径冲突、需要生产写入或付费资源、真实数据契约不足；报告实际阻塞，不循环重试，不让旧协议扩大任务。

## 协调记录

- 2026-09-16 13:34 +08:00：原生应用枚举显示 Claude 未运行；正在尝试打开既有应用。未宣称送达或接单。
- 发现旧 GUI 锁：holder=codex，acquired_at=2026-09-15T21:47:24.4708390+08:00，purpose=public-launch；已超过 10 分钟有效期，本轮只在唤醒前回收并重新申请。

## Execution result

待页面 Claude 接单。
