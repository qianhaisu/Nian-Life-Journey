# 妈妈月报实施交接 · 2026-09-17

## 一、这轮做了什么

把导航第三项从「张年」换成「妈妈月报」，新页面 `/mom-reports` 完整接替旧张年页（拱形肖像、旧测量区、学会了什么、解锁的体验全部移除，`/about` 只保留一个 307→308 永久重定向）。数据库、历史记录、照片、故事本身一律未动。

## 二、内容真实来源（不是新事实）

「妈妈月报」这个栏目本身就是苏静的原始月报——这份内容在根目录 V1 `index.html`（2026-08 版本，已提交在仓库历史里）已经存在，是 Teddy 早年手工把苏静的月报搬进 V1 静态站的结果，2026-09-16/17 的设计稿（`docs/nianlife-zhangnian-design-2026-09-16.md`）在此基础上做了文字校订（比如把「当前关注」改成「那时的关注」这类避免混淆现在/当时的措辞）。

这一轮把这份**已经存在、已经校订过**的真实文本转写进 `v2/lib/mom-report-content.ts`，逐条标注来源（文件头注释写明白：不是 Organizer 输出，不是自动生成）。没有新增事实、没有编造数值。具体：

- 六个方面、本月总结、健康记录 7 项细节、睡眠 5 阶段、下月关注 4 条：来自 V1 index.html 原文 + 设计稿校订版，两边有细节差异时取信息更完整的一边（例如呼吸道症状的历史部分保留了 V1 更完整的既往史）。
- 身高体重曲线（2025-11 → 2026-08，5 个点，2026-02 身高缺测）：与 V1、设计稿的图表数值逐字核对一致。**这组数据和当前 `growth_records` 表不是同一份证据**——数据库里当前只有婴儿期两个身高点、四个体重点（月报的成长记录已经在 `about-view.ts` 时代的注释里写明），两者不冲突是因为旧 about 页已经整页移除，不会再有两条曲线互相打架。
- 封面照片：**真实、走完整套审核链路**，不是写死的图片文件。`lib/mom-report-view.ts` 复用 `buildMonthComposition()`（`/memory` 月页同一套逻辑）取该月真正经过 subject-check 审核、可交付的照片；本地开发环境（mock 数据）该月没有这样的照片，所以本地看到的是诚实的空态「这个月还没有可以展示的照片」——这是预期行为，不是 bug。生产环境是否有该月合格封面照片，需要在生产环境实际打开验证（见下方「尚未验证事项」）。

## 三、路由与导航

- 新增 `v2/app/mom-reports/page.tsx`，读 `?month=YYYY-MM`（缺省或非法值回退到最新一期真实月报），走 `renderOnDemand()` + `loadFamilyArchiveOnDemand()`，与 `/`、`/memory` 同一套按需渲染与 300s 缓存约定。
- `v2/app/about/page.tsx` 改为 `permanentRedirect("/mom-reports")`，不再读取任何档案数据。
- `v2/components/site-header.tsx`：导航第三项文案「张年」→「妈妈月报」，链接指到 `/mom-reports`。
- `v2/lib/render-on-demand.ts` 的 `ON_DEMAND_ARCHIVE_PATHS` 用 `/mom-reports` 替换 `/about`；`v2/lib/archive-refresh.ts`、`v2/lib/family-archive.ts` 里对应的注释同步更新，保证 worker 写入后的 revalidate 通知能正确清掉这个页面的缓存。
- 旧张年页专用代码确认无其他调用方后删除：`v2/lib/about-view.ts`、`v2/components/growth-chart.tsx`、`v2/lib/memory-chapters.ts` 里的 `latestPortrait()`、`v2/lib/growth-notes.ts` 里的 `Measurement`/`measurements()`/`MEASURED_KINDS`（均已核实无其他消费者）、`v2/app/globals.css` 里对应的死样式块（`.about-*`、`.measure-*`、`.health-*`、`.learned-*`、`.unlocked-*`、`.chart-*`、`.growth-chart`）。
- 旧测试 `test/about-growth.test.mjs`、`test/about-health-fold.test.mjs` 随之删除（测的是已删除的纯函数/DOM 结构），新增 `test/mom-report.test.mjs` 覆盖真实行为：内容模块不变量、月份回退逻辑、封面照片的审核门禁（含一个「没有合格照片时诚实留空」的用例和一个「真正通过 subject-check 的照片会被选中」的用例）。

## 四、视觉与交互

新样式全部限定在 `v2/app/mom-reports.css`，只被 `app/mom-reports/page.tsx` 引入（同 `home.css` 只被首页引入的模式），不影响首页、记忆页。配色用设计稿的暖纸白 `#F5F3EC`、墨色 `#282621`、陶土 `#984D34`（深一档到 `#7A3D2A` 做小字文本色，同站内既有 `--clay`/`--clay-ink` 的做法），标题用站内已自托管的霞鹜文楷（`app/fonts-wenkai.css`，未新增字体资源）。

交互点：身高/体重曲线做成真正的 ARIA tablist（点击 + 方向键切换，两条独立量纲的曲线，2026-02 身高缺测断开连线，不插值）；健康记录用原生 `<details>` 手风琴；月份选择是真实 `<select>`，切换会更新 URL（当前只有一期，其余月份会诚实提示「还没有月报」，不是禁用占位）。

## 五、发现并顺带修复的一个真实缺陷

`components/mom-report-growth.tsx` 最初按原型思路给 SVG 用了 `<title>`/`<desc>` 子元素做可访问名称。实测触发 Next.js App Router 的一个已知坑：流式 SSR 会把页面里任何叫 `<title>` 的元素当成 `<head>` 标题候选处理，导致服务端渲染出的 SVG `<title>` 是空的，客户端却是正常文字，产生 hydration mismatch（浏览器控制台报错，图表短暂重渲染）。已改成和站内既有 `GrowthChart` 组件一致的做法——直接在 `<svg>` 上写 `aria-label`，不用 `<title>`/`<desc>` 子元素。已验证 SSR 输出正确、hydration 无报错。

## 六、检查结果

在 `v2/` 目录执行：

- `npx tsc --noEmit` — 通过
- `npx eslint .` — 通过
- `node --import tsx --test test/*.test.mjs` — 1324 passed / 0 failed / 11 skipped（跳过项与本轮无关，是既有的、需要真实数据库连接才能跑的契约测试）
- `npx next build` — 通过，18 个路由全部生成成功；`/mom-reports` 是按需渲染（ƒ），`/about` 是纯静态重定向（○）

## 七、浏览器验收（本机 dev server，1440 / 390 / 360 三个宽度）

用一个 iframe 测试台在真实宽度下验证（本机 `resize_window` 工具在这台机器上失效，物理窗口卡在约 501 CSS px，改用固定宽高的 iframe + 真实浏览器渲染绕过）：

- 三个宽度下 `document.documentElement.scrollWidth === clientWidth`，**没有横向溢出**。
- 桌面导航（`.desktop-nav`）三个链接文案正确，「妈妈月报」高亮 `is-active`，正确指向 `/mom-reports`；手机底部导航同样正确，四字文案没有被压缩挤出。
- `/about` 返回 308，`location: /mom-reports`；旧张年页任何字样在新页面里都不出现。
- 闪光时刻、给爷爷奶奶的外出小抄两个模块及其入口在新页面里不存在（从未写入过）。
- 身高/体重 tab 用键盘和点击都能切换；健康记录手风琴能展开/收起，展开后文字是真实的历史细节；月份选择器是可用的原生 `<select>`。
- 控制台无报错、无 hydration 警告；网络请求全部 200/304（唯一的非 200 是浏览器扩展自己的一个不相关请求，跟本页面无关）。
- 正文字号统一到 ≥16px（原来六个方面/健康详情/下月关注几处是 14–15px，已按设计稿「Review corrections」那版的口径改到 16px；来源说明、图表坐标轴一类说明性文字保持设计稿本来定的 12px，这类文字设计稿本身也没有拉到 16px）；触控目标（tab 按钮、月份选择器、导航链接）均 ≥44px。

截图（桌面 1440、手机 390、手机 360 各一张首屏）已保存在本机私有目录，未提交仓库：
`C:\Users\teddy\NianlifeOps\mom-reports-screenshots-2026-09-17\`

## 八、一个和本任务无关、但过程中发现的活跃问题（已顺带解决）

排查中发现：另一个并行 session 当天早些时候提交的 `3273d25 feat(首页)...` 误把我这次编辑到一半的 `v2/app/globals.css` 一并提交推送了（单一共享 worktree 下两个 session 同时改同一个文件的已知风险）。结果是**生产环境从那次推送起，`/about` 页面用到的 CSS 类已经从样式表里消失，但当时的 `/about` 页面代码还在用这些类**——线上短暗地渲染成无样式版本。已用 `curl` 核实到刚才这一刻仍是这个状态（HTML 里有 `about-portrait` 等类名，但当前部署的三个 CSS bundle 里都搜不到 `.about-portrait` 规则）。

这次 push 会自然解决它：`/about` 改成纯重定向后不再依赖那些 CSS 类。**这不是我本轮新引入的问题，是本轮工作被意外提前拆分推送后暴露出的空窗期**，如实记录，不归为本任务的新增缺陷，但建议 Teddy 知晓「单一 worktree + 多 session 同时改同一文件」这类风险确实发生过一次。

## 九、状态区分

- **代码已完成**：路由、导航、内容模块、新组件、CSS、测试均已写完。
- **本机检查已通过**：typecheck / lint / test / build 全绿，浏览器三宽度手动验收通过。
- **已提交，未 push**：本地已 commit（`f0fdca3`，见下方提交记录），已 `git fetch` 确认与
  `origin/main` 没有分叉、只是领先 1 个提交，可以直接 push、不需要处理冲突。push 这一步被
  运行环境的 Auto Mode 分类器拦下（判定为 "Out-of-Place Publication"，把 `git push` 归类为需要
  额外确认的发布类动作），不是仓库权限问题、也不是 CLAUDE.md 授权范围的问题——Teddy 的长期
  授权（"push main 不需要反复询问"）在仓库层面是有效的，但这道拦截是工具运行时的独立一层，
  需要 Teddy 自己执行 `git push origin main`，或在设置里给这个动作放行后由 Session 代执行。
- **尚未部署**：push 之后 Vercel 是否自动构建、部署是否成功，需要 push 完成后另行确认。本轮
  未执行任何手动部署或生产环境变量操作。
- **第八节提到的那次意外**（`3273d25` 误吞掉本轮 globals.css 编辑、导致线上 `/about` 短暂无样式）
  只有在这次的 commit 被 push 之后才会真正解决——在那之前，线上仍然是"新 CSS 已经上线、
  旧页面代码还在用被删掉的类名"的中间状态。

## 十、尚未验证事项

1. **生产环境该月是否真的有一张合格封面照片**——本机 mock 数据没有,无法在本机验证这条路径在生产真实数据下的最终视觉效果，需要 push 部署后直接打开 `https://nianlife.cn/mom-reports` 确认。如果生产也没有合格封面，页面会诚实显示空态，这本身符合预期，但视觉上「大幅照片进首屏」这条design要求就无法在这一期里兑现，需要 Teddy 知晓并决定是否需要为 2026-08 单独补一次 subject-check 审核。
2. 未使用真实生产数据库跑过端到端渲染（本地无 `DATABASE_URL` 凭据，遵守项目「本地无凭据开发」的既有约束，未尝试获取或绕过）。
3. 本文档未包含任何家庭原文、儿童照片或健康记录的原始截图；健康记录的具体文字内容已经过审阅、公开展示（与线上此前的 V1 页面口径一致），未做额外脱敏处理。

## 十一、提交记录

本地 commit：`f0fdca3` "feat(妈妈月报): 用新页面替换旧张年页，导航第三项改名"，22 个文件，
+929/-604 行，本文档随同一次提交写入。与 `origin/main` 的关系：领先 1 个提交，无分叉、
无需 rebase。**尚未 push**，原因见第九节。
