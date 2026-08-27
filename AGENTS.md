# Nian Life Journey V2

## 项目定位

V1 是现有的静态单页产品参考和历史资料。V2 是全新、长期可维护的张年数字人生档案，不能把 V1 HTML 直接重构为 React，也不能以 V1 的 CSS/DOM 组件结构作为 V2 的实现基础。

## 开发规则

- 从最新 `main` 创建功能分支，禁止直接修改 production 或 `main`。
- 任何功能先在 Preview 验证，再合并和部署。
- 保留历史记录，不覆盖历史测量、事件、媒体或发布版本。
- 儿童照片、视频、健康和家庭信息默认按敏感数据处理。
- 媒体必须有明确授权、来源和可见性；禁止临时外链。
- 不在仓库、Issue、日志或文档中提交密码、Token、私钥或其他凭据。
- V1 文件保持可运行；V2 变更应在新应用目录和数据库模型中完成。

## Agent Skills

项目级 Skill 放在 `.github/skills/`，按任务选择性加载，遵循本文件的隐私、V1/V2 边界和 Preview 要求：

- `brainstorming`：需求澄清、方案比较和设计决策。来源：`iurysza/agent-skills`；目标：`.github/skills/brainstorming/`。
- `frontend-design`：界面与交互实现。来源：`exiao/skills`；目标：`.github/skills/frontend-design/`。
- `anti-ai-design`：避免通用化、模板化视觉设计。来源：`huyhoangnhh98/anti-ai-design`；目标：`.github/skills/anti-ai-design/`。
- `web-design-guidelines`：交付前的 UI、可访问性和响应式检查。来源：`vercel-labs/agent-skills`；目标：`.github/skills/web-design-guidelines/`。
- `react-best-practices`：React/Next.js 工程、性能和实现审查。来源：`vercel-labs/agent-skills`；目标：`.github/skills/react-best-practices/`。

当前已安装并核验 `brainstorming`；其余四个 Skill 待网络恢复后补齐，不创建空目录或伪造内容。

## 交付前检查

- 检查数据可见性、儿童媒体授权和健康信息脱敏。
- 确认时间、单位、年龄计算和历史版本没有被覆盖。
- 确认移动端可读、媒体有 alt 文本、视频有 poster 和字幕策略。
- 运行类型检查、Lint、测试和生产构建。
- 只允许指定家庭成员完成发布确认。

## 权限原则

公开页面只展示明确允许公开的内容。管理后台、原始媒体、健康详情和家庭私密信息必须通过认证、授权和服务端访问控制保护。详细架构以 `docs/v2-architecture.md` 为准。
