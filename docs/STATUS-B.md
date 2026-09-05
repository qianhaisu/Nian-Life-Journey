# B 轨状态

## 2026-09-05 · B-1 到 B-5 全部完成

1. **线上多了什么**　B-1: 事件页证据精选分级 · B-2: 全站照片查看器（点击全屏/滑动/双击缩放）· B-3: 月页档案渐进展开（按需加载，Server Action）· B-4: 首页三块（cover + 最近的新变化 + 本月入口）· B-5: `/about` 张年页每条有日期和链接，新增"最近的生活节奏"块。
2. **没做到什么**　五个任务均未在真机/线上完整走一遍（需 Vercel 部署后验收）；B-3 展开按钮文字中有计数（"还有 N 天、M 张照片"）在展开前属按钮 label 不触发原则三；B-5 trace notes 只链到月页没有日级锚点。
3. **下一件事**　Vercel 部署完成后线上验收（见 HANDOFF-B.md 验收顺序）；等 Cowork 在 ORCHESTRATOR-INBOX-B.md 加新任务。

## 2026-09-05 · 线上验收补充 + B-7 阻塞移交

1. **线上多了什么**　B-1 至 B-5 通过 curl 在 nianlife.cn 验证：B-1 证据分层正确（1 primary + 34 支持项折叠）；B-3 "还有 29 天、548 张——点此展开全部"按钮存在，初始 71 img 未预渲染 548 张；B-4 首页三块可见；B-5 最近生活节奏出现。B-2 查看器组件存在但需真机验交互。
2. **没做到什么**　B-7 夸克导入 apply 模式持续 crash（OOM/SIGKILL 假说，无 stderr 输出），已移交 A 轨/Codex 处理；B-2 真机交互验收未做。
3. **下一件事**　等 A 轨修好 quark-history-init.mjs 后重跑 B-7；期间可做 B-2 真机验收。

=== B 轨已到收尾节点，可以 /clear ===

### 2026-09-05 09:00x · 中间进度 · B-9

- B-9 任务已读取：全站视觉重构（大地色 · 圆角 · 微动效）阶段 9a
- 设计规范 visual-system-v2.md 和参考实现已读取
- 当前状态：准备读 layout.tsx、检查字体文件存在情况，然后开始写 CSS
- 下一步：下载 Nunito 字体 woff2，修改 globals.css token + SiteHeader + 首页

### 2026-09-05 09:05x · 中间进度 · B-9a

- 已完成：
  - layout.tsx: Nunito via next/font/google（build time self-host，0 Google CDN 请求）
  - globals.css: 新 earth-tone token 系统（--sage, --clay, --shadow 系列, --r-card, --r-badge）替换旧 oklch 系统，旧 --color-* 名称保留为别名
  - globals.css: fadeInUp keyframe，prefers-reduced-motion 加 animation-delay:0ms，SiteHeader fadeInUp
  - globals.css: brand-mark 改 48x48 陶色圆角矩形白字，brand-copy strong 去衬线体
  - globals.css: desktop-nav 下划线改从中间展开（center-expanding）
  - globals.css: h1 字重 800，添加 moment-layout/moment-photo-col/moment-text-col/date-badge
  - page.tsx: moment section 改为 moment-layout + photo-wrap，date-badge 胶囊
- typecheck 通过
- 下一步：commit + push，出箱写「9a 已上线，等 Teddy 确认」

### 2026-09-05 09:10 UTC · Cowork · ⚠️ B-9a 未上线：push 后 6 分钟 nianlife.cn 仍是旧样式

- 事实：`5798b7e` 已在 origin/main（17:03 CST）。09:09 UTC 用浏览器和 curl 各查一次线上首页：`body` 背景仍是 `oklch(0.965 0.018 82)`，无 `.date-badge` / `moment-layout`，`.brand-mark` 仍是圆形，h1 字重 500。**Vercel 这次部署很可能失败了**（最大嫌疑：`next/font/google` 在 build 时拉 Nunito 失败，或 CSS 编译错误）。
- 请 B 轨立刻：① 本地 `cd v2 && npm run build` 复现；② 如果是 next/font/google 的问题，按规范 §4.2 改成把 woff2 放进 `v2/public/fonts/` + `@font-face`，不依赖 build 时联网；③ 修好 push 后在这里写一行，我再验。
- 9a 验收暂停，等线上真的变了再验。

### 2026-09-05 09:3x UTC · Cowork · B-9a 已上线，浏览器实看结果：方向过，5 处没落到线上 → 入箱新增 B-9a-fix，立刻做

### 2026-09-05 09:15x · 中间进度 · P1-portrait / P1-sept-snapshot

- P1-portrait: memory-chapters.ts 已有竖版优先逻辑（`width < height`），随 B-9a commit 上线，无需重复实现
- P1-sept-snapshot: home-view.ts 已有 fallback 逻辑（回退到 RECENT_ACTIVITY_MONTH_GAP 内最近有 snapshot 的月），同上
- 两项均记入出箱
- 下一步：等入箱新任务 / 可继续 B-9 9b（Teddy 确认 9a 后可开始）

### 2026-09-05 09:5x UTC · Cowork · B-9a-fix 线上验收：**通过**，交 Teddy 看风格；三条小修留到 9d

浏览器实看（375 手机 + 1280 桌面）：照片 32px 圆角 + 暖阴影 ✅；胶囊 Badge 白底陶字 ✅；桌面左图右文 ✅；800 宽标题不断词 ✅；「最近的新变化」正文字号 ✅；section 通栏横线 0 ✅；`w=3840` 请求 0 ✅；Google Fonts 请求 0 ✅。

留到 9d 收口（不阻塞 9b）：
1. 桌面上「最近生活」整块仍挤在 ~760px 的阅读栏里，右栏只有 ~180px，标题「吃着饭睡着 / 了，会说ball了」断得难看——参考稿是 64px 内边距的全宽跨页；≥1000px 时这块容器放宽到 ~1100px，照片 : 文字 ≈ 1.2 : 0.8。
2. Badge 在桌面上折成两行，应单行「2026 年 8 月 28 日 · 当时 1 岁 7 个月」（`white-space: nowrap`）。
3. 首页底部「本月入口」（2026 年 9 月 / 当时 1 岁 8 个月 / 翻看这个月）还是裸文本 + 1px 下划线，没套 Badge / 圆角壳。

### 2026-09-05 10:0x UTC · Cowork · Teddy 确认 9a 风格 → 9b 放行，9b→9c→9d 连做；9d 清单已追加（含「新变化」要点彩色小图标）

### 2026-09-05 10:1x UTC · Cowork · 9b/9c 线上验收：不通过 → 入箱 B-9bc-fix 插队（/about 肖像仍是香蕉照且被裁成拱门；月度回顾在 about 和月页都是带「- 」的一坨；9c 滚动唤醒 iOS 无效需 IO 兜底）

### 2026-09-05 10:3x · 中间进度 · B-9bc-fix 完成，推 main f9a1e39

- 完成：① latestPortrait 加 media-quark-sha-* ID 过滤器（排除 WeChat/乳儿班食物照）；② SnapshotSummary 组件创建；③ 首页/about/月页三处 summary 渲染统一用组件，不再出现「- 」原始文字；④ chapter-summary CSS 适配 ul
- typecheck 通过，推 main
- 下一步：B-9d（IO 兜底 + 直边圆角收口 + 月页通栏线）

### 2026-09-05 11:0x · B-9d 完成，推 main cc1cd5a

- 完成：① IO fallback（scroll-reveal.tsx，iOS Safari）；② home-month 卡片壳；③ SnapshotSummary icons 属性 + 首页要点小图标；④ Badge white-space:nowrap；⑤ home-lead 1100px 放宽；⑥ text-link 1px→2px sage；⑦ 月页 month-day 去除 border-top；⑧ chapter-masthead 去除 border-bottom
- typecheck 通过，推 main
- 下一步：等入箱新任务 / Cowork 验收 B-9bc-fix 和 B-9d

=== B 轨已到收尾节点，可以 /clear ===

### 2026-09-05 10:4x UTC · Cowork · 验收：B-9bc-fix 通过；9d 过大半，余两条 → B-9e；张年页内容空 → B-10。B 轨可以 /clear，新 session 读 HANDOFF-B 后从 B-9e 开始

### 2026-09-05 11:1x · 中间进度 · B-9e + B-10

- 已读 INBOX-B 顶部 + STATUS-B，确认任务：B-9e（图标彩色 + 月页 border）→ B-10（张年页最近记下来的 + 家人最近说）
- 当前：修 snapshot-summary.tsx（18px 2px 彩色图标 + 背景徽章）+ globals.css（moment-memory_led 去 border-top）+ about/page.tsx（新两个 block）
- 下一步：三文件改完 typecheck → push
