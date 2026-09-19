# PAGE-0919-SHADCN — 接入 shadcn/ui

- line: page
- status: blocked
- round: 1
- authorization: Teddy 本轮明确要求“引入 shadcn”；允许接入依赖、配置与组件。未授权生产部署。
- branch: main（按本轮用户指令；不创建分支、不切换旧页面分支）
- workspace: C:\Users\teddy\Documents\Nianlife
- base_sha: c9c16bcae7c181bd22ab77f3c69149d12ecf3051
- depends_on: 可用的 Claude Code 页面执行会话，或 Teddy 明确允许 Codex 直接实现
- merge_order: 单执行者在当前 main 串行完成；无数据线任务、无分支合并
- target_sha: 检查通过后的本任务提交，交付时填写，不预造 SHA
- eta: 接单后 30 分钟内提交首轮证据；当前未接单，不承诺完成时间
- next_check: 执行通道恢复或 Teddy 裁决时；本卡不创建后台调度
- push_policy: 检查通过后精确提交并 push 当前分支，包含任务文档；用户指令覆盖旧文档的禁止纯文档 push 条款

## 实施范围

1. 在 v2 接入官方 shadcn/ui，兼容现有 Next.js 15、React 19、Tailwind CSS 4；以官方文档和实际 registry 为准，记录选用版本。
2. 添加 components.json、类名合并工具和必要依赖；同步 package-lock.json。基础组件限定 Button、Card、Input、Label、Dialog，使用官方组件源码并按本项目调整。
3. 主题映射到暖白 #F9F6F0、深暖灰 #433E38、陶土 #A85D43 与现有边框色。保护原 --color-*、--muted 和 radius 变量；shadcn 同名变量含义不同，不能直接覆盖。
4. 审查 Tailwind Preflight、CSS layer 顺序和现有无 layer 的 button/input 等规则。可使用组件范围初始化或前缀隔离，但必须验证生成的工具类和第三方 Portal 内组件都能正常生效。
5. 不批量重做页面；保留中文字体、照片舞台、月报结构及既有交互。通过本地临时组件验收页验证样式和 Dialog 键盘行为，测试页不得进入生产路由。
6. 留一份简短接入说明：如何新增组件、主题变量约定、现有 CSS 共存方式、组件 import 示例。不得仅安装包后声称接入完成。

## 允许路径

- v2/components.json、v2/package.json、v2/package-lock.json
- v2/components/ui/**、v2/lib/utils.ts（若存在先检查，不覆盖既有内容）
- v2/app/shadcn.css、v2/app/layout.tsx、v2/app/globals.css（仅必要接线/隔离）
- v2/postcss.config.mjs、v2/tsconfig.json（仅必要配置）
- docs/shadcn-integration.md、本任务卡

## 验收与交付

- typecheck、lint、全量测试、生产构建：记录命令、退出码与结果；仅本地无凭据环境，不读 .env。
- 验证 Button 变体/禁用态/焦点，Input 与 Label 关联，Dialog 打开、Tab 焦点约束、Escape 关闭与焦点返回。
- 390×844、1280×800 核对首页/记忆/月报的字体、配色、尺寸、横向溢出；声明使用的本地数据与线上数据区别。截图只存本机，不提交家庭信息。
- 交付文件路径、commit SHA、push 结果、组件验收证据、未验证项。不得以构建成功冒充页面验收。
- 保护当前所有无关改动；不得 git add -A、reset、清理工作区、强推、建分支、部署、访问生产数据库或改动数据。

## 当前阻塞证据

2026-09-19：Codex 通过 Windows computer-use 打开既有 Claude 应用，页面相关会话“妈妈月报页面改造”显示 Remote Control disconnected，并提示执行该会话的 Claude Code 已离线。未发送唤醒消息、无 ACK、未开始实现。任务文件不是已接通证明。

官方参考：https://ui.shadcn.com/docs/installation/next 、https://ui.shadcn.com/docs/installation/manual
