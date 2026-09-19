# Nian Life Journey V2

## 协作入口（2026-09-07）

**最新覆盖：Teddy 已同意移除 Cowork 中间层。先读 `docs/DIRECT-COORDINATION.md`，Codex 直接派单和审核 A/B/C，三轨直接出箱回复，不再等 Cowork。下段旧角色分配已被替代；其他项目原则不变。**

先读 `docs/COORDINATION.md`。Codex 是总指挥/总审核，Cowork 负责派单/初审，Claude Code A/B/C 执行。总指挥通过 `docs/COMMANDER-OUTBOX.md` 向 Cowork 投递，Cowork 在 `docs/COMMANDER-INBOX.md` 回执；三轨沿用既有入箱/出箱。用户无需充当传声筒，未收到 ACK 不得宣称自动协作已接通。旧文档中的时点状态不能覆盖当前明确授权，发布、隐私和数据保护原则继续有效。

## 项目定位

V1 是现有的静态单页产品参考和历史资料。V2 是全新、长期可维护的张年数字人生档案，不能把 V1 HTML 直接重构为 React，也不能以 V1 的 CSS/DOM 组件结构作为 V2 的实现基础。

## 开发规则

- 只使用 `main`，不创建功能分支，不搭建长期 Preview 环境。
- 长期运行环境只有 production；不存在独立的 Preview/Staging 长期环境。
- 本地类型检查、Lint、测试和构建通过后，才提交并 push `main`。
- push 不会触发自动部署；生产部署必须经人工批准，并由人工手动执行，每次发布记录 commit SHA 和回滚点。
- 保留历史记录，不覆盖历史测量、事件、媒体或发布版本。
- 儿童照片、视频、健康和家庭信息默认按敏感数据处理。
- 媒体必须有明确授权、来源和可见性；禁止临时外链。
- 不在仓库、Issue、日志或文档中提交密码、Token、私钥或其他凭据。
- V1 文件保持可运行；V2 变更应在新应用目录和数据库模型中完成。

## ECS 发布保留规则（2026-09-19，长期有效）

- ECS 只保留当前线上版本及最近两版回滚；按回滚容器名称中的切换时间排序，不按镜像构建时间排序。每次成功发布后自动执行，不再要求 Teddy 提醒或重复授权。
- 发布健康检查通过后，清理更早的已停止回滚容器、无容器引用的旧应用镜像，以及悬空构建镜像和未使用缓存。失败发布不触发清理；清理失败须明确报告，不能宣称发布收尾完成。
- 保留 Git 历史和发布记录；此规则只限制 ECS 部署副本，不删除数据库、照片视频、妈妈月报、运行配置、证书或 Docker 数据卷。禁止直接删除 Docker/containerd 存储目录或使用 system prune --volumes。
- 统一入口为 `v2/scripts/deploy-ecs-public.sh swap`，成功后自动调用 `ecs-retention.py`；其他发布方式也必须执行同一规则。构建、切换和清理必须串行，不在其他发布正在构建时清理缓存。
- 每次发布报告必须包含当前 SHA、保留的两个回滚版本、清理结果及磁盘总量/已用/可用空间。详细约定见 `docs/ecs-retention-policy.md`。

## Agent Skills

项目级 Skill 放在 `.github/skills/`，按任务选择性加载，遵循本文件的隐私、V1/V2 边界和 Preview 要求：

- `brainstorming`：需求澄清、方案比较和设计决策。来源：`iurysza/agent-skills`；目标：`.github/skills/brainstorming/`。
- `frontend-design`：界面与交互实现。来源：`exiao/skills`；目标：`.github/skills/frontend-design/`。
- `react-best-practices`：React/Next.js 工程、性能和实现审查。来源：`vercel-labs/agent-skills`；目标：`.github/skills/react-best-practices/`。

当前已安装 `brainstorming`、`frontend-design`、`react-best-practices`，另有 `impeccable`、`quarkclouddrive`、`ui-ux-pro-max`；`anti-ai-design` 与 `web-design-guidelines` 已于 2026-09-19 移除。

## 交付前检查

- 检查数据可见性、儿童媒体授权和健康信息脱敏。
- 确认时间、单位、年龄计算和历史版本没有被覆盖。
- 确认移动端可读、媒体有 alt 文本、视频有 poster 和字幕策略。
- 运行类型检查、Lint、测试和生产构建。
- 只允许指定家庭成员完成发布确认。

## 权限原则

公开页面只展示明确允许公开的内容。管理后台、原始媒体、健康详情和家庭私密信息必须通过认证、授权和服务端访问控制保护。详细架构以 `docs/v2-architecture.md` 为准。
