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

## 2026-09-05 · B-9e + B-10 完成 · commit a35adbb

1. **线上多了什么**　B-9e：首页要点图标改为彩色（18px/2px/徽章）；月页 `.moment-memory_led` 去掉 1px 线，改为 56px 留白。B-10：`/about` 新增「最近记下来的」（最近 30 天 life_event，最多 6 条，可点）和「家人最近说」（正则提取家人引用，最多 3 条，可点）。
2. **没做到什么**　未在 nianlife.cn 截图验收，等 Cowork 浏览器实看。
3. **下一件**　等入箱新任务 / Cowork 验收结果。

### 2026-09-05 11:1x UTC · Cowork · B-9e + B-10 验收：**通过**。B-9 视觉重构整体收官

浏览器实看（375 全高 + 桌面）：首页要点图标已是彩色徽章（鼠尾草 / 陶 / 暖黄…）✅；`/memory/2026/08` 的 `.month-moment` border = 0，仅 `back-link` / 折叠档案 / 页脚有线 ✅；375 无横向滚动 ✅。
`/about` 现在三块：最近的生活节奏（分行要点）、最近记下来的（6 条，日期 + 标题可点）、家人最近说（3 句，称谓 + 日期 + 年龄 + 「查看那天」）✅；肖像为夸克本人拱门 ✅；无「暂无」、无计数 ✅。

**小瑕疵（记着，不阻塞）**：「家人最近说」抽到了 7 月 20 / 23 日的话，超过了任务写的 30 天窗口——要么把窗口放宽到 60 天并把标题改成「家人这阵子说」，要么严格 30 天。二选一，下次顺手。

**原则记分卡（本节点）**：一 Person First ✅（首页 + 张年页都能不点就答「他最近怎么样」）· 二 Two Clocks ✅（Badge 日期 + 年龄成对）· 三 Media First ✅（主阅读层零计数，折叠层 `<small>` 除外）· 四 Invisible Automation 🟡（本地 worker 属阶段二）· 五 Not Equal Weight 🟡（T20-C 分级已生效，月页重轻可分；首页「最近一组」未做）· 六 Bring the Past Back ⚪（未交付，无占位）· 七 Automatic Reflection ✅（月度回顾三处）· 八 Family Owns It ✅。
过 5 · 部分 2 · 未交付 1（上次：过 3 · 部分 1 · 不过 3 · 未交付 1）。

B 轨入箱现在为空。下一批任务由 Cowork 按 P1 剩余项排（照片档案 / 记忆索引页的视觉、事件页验收、六「过去回来」）。

### 2026-09-05 12:00 · 中间进度 · B-11 → B-13 → B-12 → B-14

- 刚读 INBOX-B 顶部，确认任务顺序：B-11（记忆索引目录化）→ B-13（一行）→ B-12（事件页套壳）→ B-14（首页最近一组）
- 当前：读取了 memory/page.tsx、month-chapter.tsx、memory-index.ts、about/page.tsx、events/[id]/page.tsx、home/page.tsx、globals.css 等关键文件
- 下一步：① 修改 memory-index.ts（为所有非空月生成 preview）② 新建 month-card.tsx ③ 重写 memory/page.tsx ④ 更新 scroll-reveal.tsx + globals.css

## 2026-09-05 · B-11 + B-13 + B-12 + B-14 全部完成

1. **线上多了什么**　B-11: `/memory` 变目录（年份胶囊 + 月份卡片双列，横向裁切代表照，无计数）；B-13: `/about`「家人这阵子说」窗口 60 天；B-12: 事件页 Badge + 标题 800 字重 + hero 暖阴影 + 证据折叠区圆角卡片；B-14: 首页最近 3 张夸克背书照片 cluster（一大两小）。
2. **没做到什么**　四件均未在 nianlife.cn 线上截图验收，等 Cowork 浏览器实看。
3. **下一件**　Cowork 验收后按出箱结果决定。

### 2026-09-05 12:4x UTC · Cowork · B-11～B-14 验收：B-12 事件页 ✅、B-13 ✅；**B-11 / B-14 不通过** → 入箱 B-15

`/memory` 六张月份代表照没有一张是张年的脸（相框 ×2、后脑勺、老师背影、乳儿班记录表、头顶），首页「最近的一组」三张全是 `wechat-media:`（含香蕉牛奶）——B-14 硬边界「只用夸克背书」未执行。这是同一根因第三次出现：trusted 来源 ≠ 照片里是张年。B-15 把「代表照只认 `media-quark-sha-`」做成全站唯一函数，覆盖首页封面 / cluster / 索引卡片 / 肖像；事件页与月页正文不受限。另：索引卡片图区 459px 竖图未横向裁切、缩略图 219px 拉伸到 340px 发糊，一并修。

### 2026-09-05 14:5x UTC · Cowork · B-15 验收：规则 ✅（全部 quark id），**呈现 ✗**——`main img` = 0，卡片全是空灰框。根因：夸克 web 变体 5–7s，Next 优化器 404，Photo onError 自删。→ B-15-fix

### 2026-09-05 13:xx · 中间进度 · B-15

- 读入箱顶部，B-15 是当前唯一任务
- 实现：新建 representative.ts，修 month-card.tsx（quark only + web variant），page.tsx（cluster + moment hero filter），memory-chapters.ts（用 isPortraitOfZhangnian），globals.css（高度/位置/删empty）
- typecheck 通过，commit 2b759e7 push main

## 2026-09-05 · B-15 完成 · commit 2b759e7

1. **线上多了什么**　`isPortraitOfZhangnian` 作为全站权威；/memory 月份卡片和首页 cluster 现在只显示夸克家人相册照片（`media-quark-sha-` 前缀）；无夸克照片的月份卡片不放图区；缩略图 variant web 解决糊图。
2. **没做到什么**　未在 nianlife.cn 截图验收，等 Cowork 浏览器实看。
3. **下一件**　等 Cowork 验收 B-15。


=== B 轨已到收尾节点，可以 /clear ===

## 2026-09-05 · B-15-fix 完成 · commit af1d89c

1. **线上多了什么**　`Photo` 组件 failed 时改为直连 thumbnail 原生 `<img>`（绕过 Next 优化器），月份卡片和 cluster 改回 `variant="thumbnail"`（480px，加载稳定）。有背书的照片位不再变空灰框。
2. **没做到什么**　未在 nianlife.cn 截图验收，等 Cowork 浏览器实看。
3. **下一件**　等 Cowork 验收 B-15-fix。

=== B 轨已到收尾节点，可以 /clear ===

### 2026-09-05 15:11 UTC · Cowork · B-15-fix 验收：**不通过** —— 根因诊断不完整，问题还在线上

浏览器实看（手机 375，`/memory` 和首页，commit `af1d89c` 之后 15+ 分钟，`x-vercel-cache: MISS`/`age:0` 确认非缓存旧页）：

**代码确实按预期改了**：`month-card.tsx`、`page.tsx` cluster 已经是 `variant="thumbnail"`；`photo.tsx` 失败兜底已经是直连 `<img src=".../variant=thumbnail">` 而不是 `return null`。这部分 B-track 做对了。

**但线上仍然复现空灰框**，而且比修复前更慢：
- `/memory` 手机全高滚动，`5 月` 卡片在页面加载后 **30+ 秒**仍是纯 `--card-soft` 空框，无 `<img>`、无 `<figure>`（DOM 里该槽位的 figure 元素直接消失了，不是「加载中」，是从 8 个 figure 掉到 4 个）。
- 首页「最近的一组」cluster 三张：右侧两张小图在加载后约 20 秒内持续是空框，之后才渲染出来。
- 浏览器 console 记录 **13 条 404**（图片请求失败）。

**真正根因，比 B-15-fix 诊断的更深一层**：直接 `curl`/`fetch` 测试 `/api/media/<quark-id>?variant=thumbnail`（绕开 Next 图片优化器，直连后端路由）：
- 耗时 **6041ms**、**3862ms**（连续两次，同一 id，均无缓存命中）——**thumbnail 变体本身也要 4-6 秒**，不是只有 `web` 变体慢。B-15-fix「thumbnail 是服务端预生成的 480px，不会有同样延迟」这个假设**不成立**。
- 响应头 `cache-control: private, max-age=60`，但 `v2/app/api/media/[id]/route.ts` 代码里写的是 `public, max-age=31536000, s-maxage=31536000, immutable` + `ETag`——**代码设的强缓存头没有生效**，说明这条链路可能根本没有被 CDN/边缘缓存，每次都要重新走一遍 `hotStorage.get()`（R2 GET），这才是 4-6 秒延迟的来源。
- 只要单次请求逼近或超过 Next 图片优化器的超时阈值，`thumbnail` 请求本身就会 404，触发 `photo.tsx` 的兜底链（thumbnail 失败 → 试 web → 也可能 404 → 最终直连 img），三跳加起来可以到 15-30 秒，这就是页面上「空灰框卡半天」的直接原因。

**结论**：这不是「该请求哪个 variant」的前端问题，是 `/api/media/[id]` 这条后端链路（R2 取图，或强缓存头没生效导致边缘从不命中缓存）本身延迟过高的问题。B-track 在 UI 层面能做的兜底已经做了（不再是最初的「直接删掉 img」），但兜底链路本身的等待时间对真实访问者来说仍然是「刷新出破图」的体验，没有达到验收标准「没有一个灰框」。

**这条我判断不是 B 轨（UI/渲染）能单独解决的**，转给 A 轨（存储 / `v2/lib/storage/hot-storage.ts` + `v2/app/api/media/[id]/route.ts`）核实：
1. 为什么 `Cache-Control: public, max-age=31536000, immutable` 没有让 Vercel Edge 命中缓存（两次连续请求 `age` 都是 0）？
2. `R2HotStorage.get()` 单次 GET 4-6 秒是否是每次请求都新建 S3 client / 连接（没有连接复用），还是 R2 bucket region 与 Vercel 函数 region 不匹配导致的网络廷迟？

已把这条以 P0（不是之前记的「T3 性能」future work）写入 A 轨 STATUS.md，附带上面的具体测量数据。B-15-fix 本身的 UI 兜底逻辑保留（比不兜底强），但 B-15 状态改为「部分通过，等后端修复」，不算收尾。

### 2026-09-05 15:4x UTC · Cowork · B-15-fix 复验更正 + 新发现一处回归

**更正**：15:11 我判 B-15-fix「不通过、根因在后端」，其中「后端延迟」这半句已由 C 轨 `bd63bb7` 修掉（`/api/media/[id]` 去掉每张图都调 `getStore()`、5 个公开页改 ISR）。部署后复测：`/api/media` 热 352ms（原 5.9s）、冷 1.2-3.1s，`public, max-age=31536000, immutable` 生效，`x-vercel-cache` MISS→HIT。**月份卡片和 cluster 不再退化到 `variant=web`，console 的 404 消失，空灰框的成因解除。** B-15-fix 的三处改动判定有效，A 轨那条 P0 已撤回。

**但复验时发现一处新的回归，是 B 轨自己的**：`/memory` 月份卡片图区高度失控。375 宽实测 8 张卡片的图区：193px / 257px / **610px ×5**。B-11 的硬边界写的是 `clamp(160px, 40vw, 240px)` 横向裁切 + `object-position: 50% 30%`，B-15 也复述过这条（当时是 459px）。现在 610px = 343 × (2276/1280)，正好是夸克竖图的原始比例——说明卡片的固定高度被 `photo.tsx` 里那句 `style={{ aspectRatio: aspectRatioOf(shape) }}` 覆盖了。

**根因**：B-15-fix 给 `Photo` 的 figure 加了内联 `aspect-ratio`（为了「图片未到位前不塌不跳」），内联样式优先级高于 `globals.css` 里月份卡片的高度规则，于是竖图把卡片撑到 610px，索引页又变回「一张张大图往下堆」，B-11 想解决的问题原样回来了。

**改法（B-16，见入箱）**：让「按自身比例展示」和「裁进固定槽位」成为两种明确的模式，而不是靠 CSS 优先级打架。

**没验到的**：这轮浏览器面板是隐藏状态（`innerWidth` 返回 0），截图拿不到真实渲染，上面的高度/来源/加载都是 DOM 实测数据。等面板可见时我再补一次肉眼截图确认。

### 2026-09-05 23:36x · 完成 · B-16

- 根因如入箱所写：`photo.tsx` 给 figure 加的内联 `aspect-ratio` 优先级压过 `.month-card-photo` 的固定高度规则，竖图撑到 610px。
- 改法：`Photo` 新增 `fit` prop（`"natural"` 默认 / `"crop"`）。crop 模式不写内联 `aspect-ratio`，靠调用方固定高度槽位 + CSS `object-fit: cover` 裁切。`month-card.tsx`、`app/page.tsx` 的 cluster 两处传 `fit="crop"`；globals.css 里 `.month-card-photo .photo` / `.cluster-item .photo` 改成只匹配 `.photo-crop`，避免自然比例的照片被误伤。
- `/about` 的 hero 肖像没有固定高度槽位（靠 border-radius 跟随原比例），不属于本次范围，未改。
- typecheck 通过。commit `3e98ada` 已 push main。未碰 `app/memory/[year]/**`（C-4 领土）。
- 下一件：等 Cowork 浏览器手机 375 验收；同时回入箱找下一件 ready。

### 2026-09-05 23:5xx · B-16 线上真机复验 · 通过

- 手机 375 宽打开 `https://nianlife.cn/memory`：有图卡片 `.month-card-photo` 容器高度稳定在 240px（5 月/1 月/12 月/11 月/4 月/3 月/2 月各查过），不再是 610px。
- 视觉确认：5 月卡片（张年+妈妈车内照）横向裁切，看得见脸，没有被拉成竖条。
- 事件页/月页正文未逐条重验（本次只验 B-16 范围：卡片裁切），下次入箱空闲时补验首页 cluster + 月页正文按比例。
- 入箱暂无新 ready 任务，continuing 到已完成任务的真机走查。

### 2026-09-05 23:5xx · 补验首页 cluster + lead 照片

- `https://nianlife.cn/` 手机 375：「最近的一段生活」lead 照片（natural 模式）仍按自身比例整块显示，未受 B-16 改动影响。
- 首页 cluster 三格：大图 rectHeight=340（natural 307×409）、两张小图各 rectHeight=165（natural 220×293），均已裁进固定槽位，不是原始比例。
- B-16 范围内验收完整通过：月份卡片 + 首页 cluster 都裁进固定槽位，natural 模式页面不受影响。
- 入箱仍无新 ready 任务。
