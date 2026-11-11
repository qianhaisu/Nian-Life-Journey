# Nian Life Journey V2

## 执行入口（2026-10-10）

Teddy 已取消 `nianlife-orchestrator` 协作技能及 Codex → Claude Code / Cowork 派单流程。Codex 收到命令后直接执行、检查并完成，不唤醒、派单或调用 Claude Code。旧协作文档仅保留为历史记录，不再作为当前执行要求；发布、隐私和数据保护原则继续有效。

2026-10-12：Teddy 决定内容更新不再调用智谱或 DeepSeek，改由模型会话定时直接读来源、写稿与审核（此前由 Claude Code 执行）。旧 Windows `Nianlife Nightly Editor` 已禁用，原始微信同步继续运行；每日流程见 `docs/daily-editor.md`。不启动旧模型编辑、补录、照片识别、提醒提取或轮播评分入口。

2026-11-11：Teddy 将项目日常演进、UI 审美、非虚构内容审编、每日更新链路与生产发布统一交由 Antigravity 接管维护；写作与审核准则见 `v2/scripts/editor/STYLE.zhang.md` 与 `docs/daily-editor.md`。常规应用代码在检查通过并推送 `main` 后由 Antigravity 自动完成生产部署，仅在存在重大确认事项（如破坏性数据迁移、可见性/权限边界变更或基础设施重大调整）时需先经 Teddy 确认。

## 项目定位

V1 是现有的静态单页产品参考和历史资料。V2 是全新、长期可维护的张年数字人生档案，不能把 V1 HTML 直接重构为 React，也不能以 V1 的 CSS/DOM 组件结构作为 V2 的实现基础。

## 开发规则

- 只使用 `main`，不创建功能分支，不搭建长期 Preview 环境。
- 长期运行环境只有 production；不存在独立的 Preview/Staging 长期环境。
- 本地类型检查、Lint、测试和构建通过后，才提交并 push `main`。
- Git push 本身不触发远端 CI 自动部署；常规变更有序完成检查并 push `main` 后，由 Antigravity 直接执行生产发布（`v2/scripts/deploy-ecs-public.sh upload` / `build` / `swap` / `verify`）而无须等待人工批准，每次发布记录 commit SHA、回滚点及 ECS 保留清理结果。若涉及重大确认事项（如破坏性 Schema/数据变更、隐私与可见性规则调整、域名/证书/网关或存储架构变更），须先向 Teddy 说明并获确认后再发布。
- 保留历史记录，不覆盖历史测量、事件、媒体或发布版本。
- 儿童照片、视频、健康和家庭信息默认按敏感数据处理。
- 媒体必须有明确授权、来源和可见性；禁止临时外链。
- 新增媒体的原图、缩略图和网页图永久只写 OSS，禁止使用 R2 或经 R2 中转；导入与定时同步必须遵守，不因旧环境变量回退。
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
- 常规生产发布在检查通过后自动执行并留存 SHA 与回滚记录；存在重大确认事项时须先经 Teddy 确认。

## 权限原则

公开页面只展示明确允许公开的内容。管理后台、原始媒体必须通过认证、授权和服务端访问控制保护。详细架构以 `docs/v2-architecture.md` 为准。
