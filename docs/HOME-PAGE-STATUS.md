# HOME-20260913-PAGE · 页面 Claude Code 状态

> 本文件由页面 Claude Code 独占维护。数据轨状态见 `docs/HOME-DATA-STATUS.md`。

## ACK（真实接单）

- 任务 ID：HOME-20260913-PAGE　ACK：2026-09-13 18:15 +0800
- 接单时 HEAD：`74e76861f815f0cebf77262db7f1dafdb444a7f2`（派单卡记的 `ac90ec6` 已被取代，未回退 checkout）
- 已核对唯一视觉基准：`...\01a099d7-35aa-7531-83c8-39abce4014d9\nianlife-home-v2.html`，实测 SHA-256
  `9a046b3b5a4ee873375a27f3b969ebfedb72ddee59d7a41f4b3475ac90f755cc` = 规格记载值
- 工作区既有未提交改动（非本轮，不动、不代提交）：`docs/HANDOFF-COMMANDER.md`、`docs/ORCHESTRATOR-INBOX.md`、
  `docs/nianlife-handoff-2026-09-06-neon.md`、`v2/scripts/quark-heic-ingest-linux.mjs`

## 已做完（待跑整套检查与提交）

**1. 中文圆体自托管（真字形，不是系统回退）**

- 源：`chill-round.ttf`（ChillRoundF v3.000，OFL，14,260 码位 / 12,093 基本区汉字），仓库外，不提交。
- 生成脚本 `v2/scripts/build-round-font.py`：按 OFL 第 3 条把 name 表 1/3/4/6/16 改成 **NianRound**（不沿用保留字体名），
  许可证原文 + 修改说明放 `v2/public/fonts/nian-round/LICENSE.txt`。
- 两层分片共 37 片 3.3 MB：`cover-NN` 按码位覆盖全部汉字与中文标点（连续区间，CSS 只占几十字节）；
  `text-NN` 是按仓库中文语料词频 + GB2312 一级字排的常用字，写在 CSS 后面因而优先命中。
  `v2/app/fonts.css` 34 KB（若逐码位写全部覆盖层则是 77 KB）。**未来生僻字有覆盖，不掉回系统字体。**
- 站点字体栈：`Nunito, 'NianRound', PingFang SC…`——英文数字仍走 Nunito，汉字落圆体（`globals.css` 两行）。
- 实测（本地 Chrome，真渲染）：`document.fonts` 里 7 片 `NianRound` 状态 loaded；放大首屏标题可见圆头笔画与实心圆句号。

**2. 首页（`v2/app/page.tsx` 已切到定稿版式）**

- 结构：今天 + 今天几岁 → 一张照片和它所属的那段真实生活（换张照片 / 读读这一天）→ 至多一条近况 → 紧凑提醒。
- **已删**：底部月份与「全部记忆」入口（用户明确追加）、原首页的近况概览 / 上月回顾 / 完整待办清单 /
  同日条目 / 最近照片组 / 忽然想起。内容一条没删，各回记忆页与月页。没有「记一笔」、没有「首页设计预览」。
- 新组件：`v2/components/home-lead.tsx`（客户端：换图 + 查看器）、`v2/components/home-reminders.tsx`（`<details>`，无额外 JS）。
  作用域样式 `v2/app/home.css`。共享文件只动三处：`layout.tsx` 引入 fonts.css、`globals.css` 字体栈、
  `photo-viewer.tsx` 导出已有 `ViewerModal`（首页封面复用同一个查看器，不另造）、`upcoming-tasks.tsx` 导出三个标签常量（不重复一套文案）。
- 接的是数据轨 `home-feed/1.0.0`（`91786ad`）：`readHomeFeed()`。换图消费 `photoCandidates`（(故事, 照片) 对，
  换图必然连带换标题/日期/当时年龄/链接）；`photoAbsence` 时只留文字不画空框；`reminders.unavailable` 整块不画，
  `clear` 才写「没有要记着的事」并印出窗口起止。
- 强调色由内容驱动：只给真的带「」且不超过 10 字的引语上色（实测那段摘录有一句 27 字引语，整句上色后半段摘录全红）。
  没有硬编码的 cold/hot 模板。

**3. 本地真数据联调环境（仓库外，`.data/home-dev-rds.mjs`，不提交）**

- 发现并绕开一个真实事实：`v2/.env.local` 的 `DATABASE_URL` 指向的仍是**休眠的 Neon**，而且 `0013/0014/0015`
  三个已提交迁移没在它上面跑过（`growth_records.precision` 不存在 → 首页整张档案读 500）。
  线上私有站（`127.0.0.1:18080` 是到 ECS `47.99.243.155:3000` 的 SSH 隧道）走的是阿里云 RDS `nianlife`。
  **本轮我没有改任何数据库、没有跑迁移、没有改 `.env.local`。** 这条是给数据轨/总指挥的事实记录。
- 本地验证用单进程覆盖：ECS→RDS 隧道 + OSS 公网 endpoint（那份凭据里的是 VPC 内网地址，本机连不上，
  表现为挂 135 秒后 404）。照片因此在本地能真加载。

## 实测（本地 dev，真数据、真照片）

- 1440×900 / 1024×768 / 390×844 / 320×700 四个视口无横向溢出（`scrollWidth == clientWidth`）。
- 交互：换张照片 → 照片、标题、日期、当时年龄、`/events/<id>` 一起换（实测 9 月 7 日「他会说 cold，也会说 hot」
  ↔ 8 月 19 日「小年也扎了个小辫子」）；点封面 → 站点已有查看器，原比例 1280×959 `object-fit: contain`，
  返回键关闭；提醒展开 → 提出 / 角色 / 语气 / 记录于 / 已审核摘要 / 回到那一天。
- 触摸目标：换张照片 61×44、读读这一天 133×44、查看详情 68×44，均 ≥44。
- 窄屏修正两处：问候与「现在几岁」在 390 以下改上下排（并排会把标题折成「最近怎么 / 样，张年。」）；
  版心左右留白跟 `.header-inner` 对齐（原先品牌 x=32、照片 x=16）。

## 锁与串行

- 2026-09-13 19:0x：读到数据轨已**释放**首个 Git/构建时段。页面轨现在**持有** Git + 全量检查时段（typecheck/lint/test/build → 精确暂存本轨文件 → push main），完成后在此写「释放」。
- 共享呈现代码（`layout.tsx`、`globals.css`、`photo-viewer.tsx`、`upcoming-tasks.tsx`、新组件）**正在改 → 已改完**，
  push 后在此写「可以测了 + SHA」，数据轨再测完整呈现链。

## 未完成 / 待办

1. 整套检查（typecheck / lint / test / build）与 commit/push main。
2. 生产构建下的四视口截图与既有页面（/memory、月页、/about、故事详情）回归复验——dev 模式 HMR 多次热更后出现过
   一次 `__webpack_modules__ is not a function` 与 CSS 丢失，那是 dev 假象（重试即 200），正式证据用生产构建取。
3. 临时文件删除：`v2/public/__viewport.html`（本地视口夹具）**不得提交**。
4. `READY_FOR_REVIEW` 报 Codex；终审后按既有私有部署授权统一发布并复验。

## 下一步

跑整套检查 → 精确暂存本轨文件 → push main → 生产构建下取四视口与回归证据。
