# shadcn/ui 发布记录 — 2026-09-19

Teddy 明确授权：“你来干吧 尽量避开妈妈月报的改动 做完发布”。Codex 直接完成实施、检查、push、发布与线上验证。

## 交付

- 生产：https://nianlife.cn/
- 发布 SHA：`f9e51636b2ed1707b9e2bd3a31b4621ea650eff3`。
- 镜像：`nianlife-web:f9e5163`，Docker image `4ce868565d4d`。
- 回滚容器：`nianlife-diag-web-pre-f9e5163-20260919-120108`，保留原镜像 `nianlife-web:7a5c14b`。
- 可按既有部署脚本执行 `rollback-app nianlife-diag-web-pre-f9e5163-20260919-120108`；运行端点与私钥通过既有本地配置提供，不写入仓库。

基础组件 Button / Card / Input / Label / Dialog 已接入，暖色主题与 Tailwind `ui:` 前缀隔离；首页“换一段”实际使用 Button。妈妈月报源码和数据路径零改动。原有依赖版本无升级；新增依赖锁定在 package-lock.json。详见 [接入说明](shadcn-integration.md)。

## 验证结果

- typecheck、lint、生产构建通过。
- 全量测试 1360 项：1349 通过、11 跳过、0 失败。
- `npm run test:ui` 通过：390/1280px 的组件样式、月报样例隔离、类名合并、44px 默认点击高度、标签关联、禁用态、可见焦点、弹窗焦点约束/Escape/返回焦点。
- ECS 上传精确提交的 git archive，构建与切换脚本均退出 0；健康检查报告同一完整 SHA、数据库 connected。HTTP/HTTPS 与 www 规范跳转正常，首页 HTTP 200。
- 真实首页、记忆、妈妈月报在 390×844 / 1280×800 下全部 HTTP 200、零横向溢出、首屏图片均实际加载。
- 首页在两个宽度均验证新 Button 标记存在；点击“换一段”后回忆状态文本实际改变。
- 妈妈月报两个宽度的发布前后全部采样元素的布局和计算样式逐项相同，整页 PNG 的 SHA-256 也分别完全相同。
- 已查看发布后的首页手机截图，照片、品牌、标题与按钮布局正常。

私人截图、浏览器指标、日志只保存在本机临时目录 `C:\Users\teddy\AppData\Local\Temp\nianlife-shadcn-20260919`，未进入 Git。未实测 iOS 真机。

## 运行边界

沿用已核对的原生产配置；`MONTH_CONTENT_DIR=/srv/nianlife-content` 与只读挂载保留，Organizer worker 仍为 false，未写业务数据、未更改 DNS/Caddy。构建后剩余磁盘 1583MB，高于脚本 1500MB 下限但余量较小；本轮未清理任何历史镜像或回滚容器。
