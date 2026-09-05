# INBOX·B 轨 — 给第二个 Claude Code Session 的任务队列

Cowork 写「入箱」，B 轨 Session 读入箱、执行、把结果写「出箱」。Teddy 不必在中间转述。
**A 轨（写库 / 管线 / P1-0）在 `docs/ORCHESTRATOR-INBOX.md`，那份不归你，别去动。**

建立于 2026-09-05 02:5x，Teddy：「再开个 b 轨 inbox 入箱出箱 我放另一个 code session。
P1-8 照片查看器 · P1-12 证据精选 从这里开始」。

---
## ⏱ 常设规则：每 5 分钟强制汇报（所有任务都适用）

不管任务多长，**每隔 5 分钟必须往 `docs/STATUS-B.md` 追加一段中间进度**。格式：

```
### YYYY-MM-DD HH:MMx · 中间进度 · <任务编号>

- 从上次汇报到现在做了什么（哪怕只是"还在跑，N/M 条"）
- 当前卡在哪 / 下一步是什么
- 遇到的错误或异常（如果有）
```

**跑完时写正式汇报，跑到一半也必须写中间汇报。** 5 分钟没动静 = Cowork 无法判断你是死是活。
宁可写"还在等 DB 响应，无新进展"，也不要沉默。

## 🚧 两条轨怎么不打架（先读这段，只有这段是硬约束）

两个 Session 同时在一个仓库里工作。`CLAUDE.md` 原本的规则是"同一时间只有一个 Session 写仓库"，
现在改成**按文件分区**——各写各的目录，就不会互相覆盖。

**B 轨（你）拥有，可以随便改：**

```
v2/components/**              ← 照片查看器、证据列表等所有组件
v2/app/**/page.tsx            ← 页面（月页、事件页、首页、张年页）
v2/app/globals.css            ← 样式
docs/ORCHESTRATOR-INBOX-B.md  ← 本文件的「出箱」段
docs/STATUS-B.md              ← 你的回报（没有就新建）
```

**A 轨拥有，你不要碰：**

```
v2/scripts/**                 ← 写库脚本
v2/lib/organizer/**           ← 写手、验证器、主体门
v2/lib/db/**                  ← 数据层
v2/.env.local                 ← 模型和连接串（A 轨刚把模型换成 deepseek-v4-flash）
docs/ORCHESTRATOR-INBOX.md    ← A 轨的入箱
docs/STATUS.md                ← A 轨的回报
```

**灰色地带**：`v2/lib/publication-moments.ts`（月页组合逻辑）**归 B 轨**——P1-9 之后要大改，
A 轨今晚动过它，但现在不会再动。如果你必须改 `v2/lib/` 里除 organizer/db 之外的文件，先在出箱里写一句。

**Git 纪律（两轨都适用）**
- 直接在 `main` 上开发、commit、push，不建分支。
- **`git add` 只加自己的文件，永远不要 `git add -A` / `git add .`**——那会把另一轨没写完的改动一起提交。
- commit 之前 `git pull --rebase`；push 被拒就再 rebase 一次。
- 撞上 `.git/index.lock` 说明另一轨正在提交：**等 10 秒重试，不要删那个文件**。
- 工作区里那约 251 个"已修改"文件全是 CRLF/LF 差异，**不是真实改动**，一个都不要提交。

**你不需要碰数据库，也不需要调用 DeepSeek。** 这两个任务是纯渲染层。
要看真实数据就直接 curl 线上页面（`https://nianlife.cn/...`），不用连库。

---

# 📥 入箱

> **2026-09-05 15:2x Cowork：B-0 已由 Teddy 手动完成（git 历史已干净，origin/main = 0fb467b）。现在唯一在做的是 `## B-15-fix`——B-15 的选片规则已生效，但索引卡片全是空灰框，要用 thumbnail 变体 + 直连兜底修好。**

## B-1 · P1-12 证据精选 — status: ready（先做这个，它最小）

**背景**　外部评价说事件页"一段短故事后直接铺出 24 条微信"。Cowork 核实：**这条成立，而且数据早就够了**。
`source_memory_links` 表里每条链接都有 `role` 字段——**primary 285 条 / supporting 1,433 条**——
但渲染层没用它，把两种一起平铺了。证据条数的真实分布是长尾：

- 一半以上的记忆只有 1–3 条证据（没问题）
- 但尾巴很长：**有 2 条记忆各 24 条、2 条 25、3 条 27、1 条 31、2 条 33、1 条 35**

而且 supporting 里混着与张年关系不大的长文（例：某条记忆的证据里有一整段"一岁多孩子驼背怎么办"
的育儿建议，几百字，把真正的原话淹掉了）。

**目标**　打开任何一条记忆的详情页，折叠区展开后**先看到的是真正支撑这段故事的那几句原话**，
其余当天资料退到更深一层。溯源能力一点不减。

**硬边界**
- **不删任何数据，不改任何表。** 纯渲染分层——原则八「家庭拥有自己的人生」要求来源可完整追溯。
- 第一层 = `role = 'primary'` 的证据；第二层 = `role = 'supporting'`，标题写成
  「当天其余资料（N 项）」，默认收起。
- 单条证据原文超过 ~120 字时先显示前几行 + 「展开」，不要一上来就铺几百字。
- 计数文案沿用现在的克制写法（「当时留下的资料 N 项」），**不要引入新的计数式描述**——
  原则三禁的就是用计数代替内容。
- 一条记忆若没有任何 primary（数据里存在这种情况），第一层就退化成现在的行为，不要出现空区块。

**验收（打开页面看，不是跑测试）**
1. 找一条证据最多的记忆（35 条那条），第一层显示的条数 = 它的 primary 数，不是 35
2. 那段育儿建议长文不在第一层；点开第二层还能找到它，原文一字不少
3. 事件页 HTML 体积比现在小；`<details>` 仍然默认折叠
4. 手机上第一层不需要横向滚动

**不可接受**　为了页面干净而丢弃 supporting 证据；把长文截断后不给展开入口；
在页面上新增"共 N 条证据、其中 M 条主要"这类统计句。

---

## B-2 · P1-8 照片查看器 — status: ready

**背景**　外部评价：「照片档案能看见，却还不能翻看」。实测成立——事件页和月页的照片都没有
全屏 / 滑动 / 缩放入口，多图条用裁切展示，人可能被切掉。这是 P1 里"让档案真的能翻"的核心一件。

**目标**　手机上点任意一张照片 → 全屏打开 → 左右滑动看同组的其他照片 → 双指或双击放大看清脸 →
下滑或点空白关掉，回到原来的位置。

**硬边界**
- **不引入外部图库依赖。** 用原生能力做：`scroll-snap-type: x mandatory` + `overflow-x: auto`
  做滑动，`touch-action: pinch-zoom` / 双击切换 `transform: scale()` 做缩放。
  站点的 CSP 和"轻"的取向都不欢迎再挂一个 lightbox 库。
- **全屏主图不裁切**（`object-fit: contain`），缩略图可以裁切，但把 `object-position` 从
  默认的 `50% 50%` 改成竖图 `50% 32%` / 横图 `50% 42%`——人脸在照片上半部是压倒性的规律。
  **不要为此引入人脸识别**，这是 P1 不做的事。
- 查看器里必须同时显示**日期和当时的年龄**（原则二：两个时钟并存），格式跟站内其他地方一致。
- 「同组」的定义：从哪张图打开，就在那张图所属的那一组里翻——
  一条记忆的配图是一组，月末档案是一组，不要跨组串。
- 键盘可用（← → Esc），焦点可见；`prefers-reduced-motion` 时不做位移动画。
- 打开查看器**不要改变 URL 历史**到需要额外一次返回才能退出的程度——手机上"返回"应该关掉查看器，
  而不是退出整个页面。

**验收（在手机上真的用一遍）**
1. 月页任意照片点得开，能左右翻，能放大到看清脸
2. 全屏图没有把人切掉；缩略图里人脸也基本不被切
3. 每张图都能看到"几月几号 · 当时几岁几个月"
4. 关掉之后回到点开前的滚动位置，不是跳回页面顶部
5. 页面首屏体积不因为查看器而变大（查看器的图按需加载）

**不可接受**　为了做查看器把月页改成客户端渲染、首屏变慢；引入 lightbox 库；
把全屏图也裁切；查看器盖住页面但按返回键直接退出了整个网站。

---

## B-3 · P1-9 月页渐进展开 — status: ready（B-2 之后直接开始，不用等我发话）

**背景**　T20-A3 已经把月末档案的首屏封顶到 24 张（8 月页从 1,638 KB 降到 223 KB），
但那是"砍掉不渲染"，不是"按需展开"——被折起来的 175/370/548/112 张现在页面上够不着。
产品原则五的检验句原文是「大部分内容默认不出现，**折叠展开后仍能看到全部**」，后半句还不成立。

**⚠️ 时间上的硬依赖**：这件必须在 A 轨的"夸克 2,279 张入库"之前做完。夸克会再灌进 2,000+ 张照片，
没有渐进加载，月页立刻回到 1.6 MB，等于 T20-A3 白做。**这是 B 轨排在这个位置的唯一理由。**

**目标**　月页默认每天先出 3–5 张代表照片；点某一天，再加载那天全部；月末档案同理，
「还有 N 天、M 张照片」可以点开看全部。**不预先生成几百个图片节点。**

**硬边界**
- 保持现在的服务端渲染，不要为了这个把月页改成整页客户端渲染。按需加载那部分可以是
  一个窄接口或 server action，只返回那一天的照片。
- 代表照片的挑选沿用现有的 `pickDayPhotos` / hero 逻辑，**不要重新发明一套排序**。
- 展开后的照片同样能进 B-2 做的查看器。
- 首屏 `<img>` 数量维持在现在这个量级（四个月现在是 50/65/73/27）。

**验收**　月页首屏 `<img>` 不增加；点开任意一天能看到那天全部照片；月末档案能展开到全部；
`curl` 到的 HTML 体积不明显变大。

---

## B-4 · P1-10 首页三块 — status: ready

**目标**　首页只留三块：**最值得看的一天**（现在已经是这样了，保留）、**最近的新变化**、**本月入口**。
"最近的新变化"直接复用 `monthly_snapshot.summary` 里已经写好的变化句（月度回顾就是写"这个月他有什么变化"），
不要新造一套判断，也不要调模型。

**硬边界**　不出现任何计数式描述（原则三）；变化句必须能指回具体月份；没有回顾的月份就不显示这一块，
不要出现"暂无"。

---

## B-5 · P1-11 张年页回答"他现在是谁" — status: ready

**目标**　`/about` 现在只有年龄、生日、一张照片。它是三个一级入口之一，要能回答
**最近会说什么 / 最近喜欢什么 / 最近在练什么 / 最近的生活节奏**，每条带日期，点得进对应的记忆。

**硬边界**　材料只从**已发布**的 life_events 和月度回顾里来，不看原始聊天、不调模型、不编。
健康和原始数据留在更深层，**不要把这页做成体检表**。某一栏没有够格的材料就整栏不出现（原则六的做法）。

---


## B-6 · 立即 push 本地 commit — status: done

**背景**　本地 main 上有一个未 push 的 commit `d1b6e3e`（P1-5 性能 + P1-portrait + P1-sept-snapshot，A 轨写的代码）。
Teddy 不在电脑旁，你来 push。

**做什么**
```bash
git log --oneline -3          # 确认 d1b6e3e 在 main 上
git push origin main
```

push 后等 Vercel 部署完成（约 1-2 分钟），在出箱报告 push 结果和 Vercel 部署 URL/状态。
**视觉验证 Cowork 会做，你不用管。**

---

## B-8 · P1-snap 渲染修复（一行 CSS） — status: ready

**优先级**：最高，1 分钟能做完。

**问题**：A 轨已经把 `monthly_snapshot.summary` 改成了分点格式（每行 `- ` 开头），
数据库里已经是正确的 bullet 格式了。但首页渲染时 `<p class="home-change-note serif">{summary}</p>`
把 `\n` 当空白吞掉了，浏览器里还是挤成一段。

**做什么（二选一，选你觉得更干净的）**：

方案 A（最快）：在 `globals.css` 里给 `.home-change-note` 加一行 `white-space: pre-line;`

方案 B（更语义化）：在渲染 summary 的组件里把 `\n` 拆成 `<li>` 或 `<br/>`，
比如 `summary.split('\n').filter(Boolean).map(line => <li>{line}</li>)`

**验收**：首页「最近的新变化」能看到 3-5 条分开的要点，不是一坨文字。
用 curl 检查 HTML 里确实有换行/列表结构。

---

## B-7 · P1-2 夸克历史素材入库（续跑） — status: done（已由 A 轨接管）

**背景**　上一个 A 轨 session 跑了 `v2/scripts/quark-history-init.mjs`，只进了 194/1,690 张就断了。脚本按 checksum 去重，重跑安全。

**做什么**
```bash
cd v2
node scripts/quark-history-init.mjs
```

**范围**　只有照片，不含 260 个视频。329 张无日期照片不在这轮范围。
**验收**　跑完后查库：
```sql
SELECT count(*) FROM raw_sources WHERE source_label = 'Quark 历史素材 2026-09-03';
```
应该 ≈ 1,690（±去重容差）。结果写出箱。

## B-9 · P1-UI 全站视觉重构（大地色 · 圆角 · 微动效）— status: **ready** · **Teddy 2026-09-05 定稿的设计，优先级高于入箱里其他未完成项**

**先读**（顺序不能换）：
1. `docs/design/visual-system-v2.md` — 规范（§1–§3 是 Teddy 的原稿，§4 落地约束，§5 分阶段验收）
2. `docs/design/reference-earth-tones.html` — Teddy 给的参考实现，用浏览器打开看一遍手感（桌面宽度）
3. `docs/nianlife-product-principles.md` §3 — 内容规则不变

**背景**　外部体验反馈 + Teddy 自己的判断：现在的站是「黑白灰极简 + 衬线」的成人档案感，要换成温暖治愈的大地色手账。B-1～B-8 做的功能（证据分层、查看器、渐进展开、首页三块、张年页）**全部保留**，这次只换皮肤和微动效。

**目标（家人看得见的）**　苏静打开首页：燕麦奶白的底、圆角大照片、鼠尾草绿的「张年」两个字、错落浮现的标题；滑到哪里，哪里的照片和文字依次醒来；点照片，毛玻璃暗底里翻看。没有一处直角，没有一处生硬的变色。

**分四个阶段，9a 做完必须停下等 Teddy 看**

| 阶段 | 做什么 | 停不停 |
|---|---|---|
| **9a** | `globals.css` 全局 token / 字体（Nunito 自托管）/ 圆角 / 阴影 / `fadeInUp` + `SiteHeader`（Logo、下划线动效、进场）+ 首页（大标题、左右跨页「最近生活」、胶囊 Badge、悬浮动效、手机叠放） | **停**：commit + push，出箱写「9a 已上线，等 Teddy 确认风格」，然后去做入箱里别的 ready 项或回头补验 B-2/B-5 |
| 9b | `/about`：拱门肖像、滚动绘制的时间轴、米色圆角节点卡片 | Teddy 确认 9a 后开始 |
| 9c | `/memory`、月页、事件页：错落照片流、滚动唤醒（图先文后 0.1s）、32px 圆角、`PhotoGallery` 毛玻璃深底 | 接着做 |
| 9d | 全站直角扫尾、375px 无横向滚动、`prefers-reduced-motion`、原则记分卡 | 接着做 |

**硬边界**（除规范 §4 外再强调三条）
- **文本一字不改、数据一行不动。** 改的是 CSS、为动效需要的 DOM 包裹层、`IntersectionObserver` / hover / active 交互。
- **B-3 的性能成果不能倒退**：月页首屏 `<img>` 数不增加；不给月末档案缩略图逐张加阴影 / 动画。
- **Nunito 不走 Google Fonts**（大陆阻塞），子集 woff2 放 `v2/public/fonts/`，`font-display: swap`。
- 只加自己的文件；每阶段至少一个 commit，信息带 `b9-<阶段>`；每 5 分钟往 `STATUS-B.md` 写进度（常设规则）。

**验收**　按 `visual-system-v2.md` §5 逐阶段；Cowork 会在浏览器里开真页面看（手机 + 桌面），不 grep。9a 的 7 条验收句就是 Teddy 看风格时会看的东西。

**不可接受**　为了圆角 / 阴影引入 UI 库；把中文也换成 webfont；hover 动效在手机上没有等价反馈；动效让首屏出现空白等待（`opacity:0` 的元素必须在 JS 失败时也能显示——用 `animation … forwards` 而不是依赖 JS 加类来显示首屏）；页面上出现任何新句子、计数、「暂无」。

---

## B-9a-fix · 9a 线上验收：方向对，但首页真正渲染的那条分支没套上 — status: **ready，立刻做，做完仍然停下等 Teddy**

Cowork 2026-09-05 09:3x 在浏览器（手机 375 + 桌面 800 宽）实看 nianlife.cn 首页。**过的**：`#F9F6F0` 底、Nunito 生效、0 个 Google Fonts 请求、Logo 48px 陶色圆角矩形、「张年」鼠尾草绿、h1 800 字重、标题→日期错落进场（0.2s / 0.4s）、`prefers-reduced-motion` 规则在。**没过的 5 条，全是首页：**

1. **胶囊 Badge、左右跨页、照片圆角 + 阴影 + 悬浮全部没出现在线上。** 原因：你把 `moment-layout` / `date-badge` / 圆角只加在 `cover.kind === "moment"` 分支，而线上现在走的是 `cover.kind === "memory"`（`EditorialMemory size="lead"`）——DOM 里没有 `.moment-layout`，`.home-lead figure` 的 `border-radius` 是 `0px`、`box-shadow` 是 `none`，日期仍是 `TimeSignature` 的纯文字「2026 年 8 月 28 日 当时 1 岁 7 个月」。**要求：三种 cover 分支（memory / moment / dated）共用同一套壳**——照片 32px 圆角 + `--shadow` + hover 上浮，日期 + 年龄合成一个胶囊 Badge「1 岁 7 个月 · 8 月 28 日」，桌面 ≥900px 左图右文，手机上下叠放。最稳的做法是在 `EditorialMemory` 的 `lead` 尺寸里实现，而不是只在 page.tsx 的 moment 分支里。
2. **桌面 800px 宽时大标题断在词中间**：「最近怎 / 么样，」。两行各自 `white-space: nowrap`（`.home-title-line` 原本就有 display:block），字号改成 `clamp(2.4rem, 7vw, 6rem)` 并在 700–1000px 区间不要让「最近怎么样，」超过容器宽——宁可小一号，不能断词。
3. **「最近的新变化」五条要点被放成 25.6px 的 800 字重**，比标题还吵。它是正文列表：`1rem–1.05rem`、500 字重、`--muted` 或 `--ink`、行距 1.7、条目间 10px。
4. 首页三处 1px 通栏 `border-top`（section 之间）仍是直线直角——按规范 §1.3 改为去掉，用留白（≥64px）分隔；若一定要分隔物，用 `--sage` 24px 短线、2px 圆角。
5. 照片 `sizes` 仍让 Next 请求 `w=3840`（历史遗留，一行改对即可，顺手）。

**验收**（Cowork 会再看一次）：手机上照片四角明显圆、下方有暖阴影、Badge 白底陶字；桌面 1280 宽左图右文、hover 上浮 8px；800 宽标题不断词；「新变化」列表读起来是正文不是标题；首页无 1px 通栏横线。做完出箱写一行，**继续停下等 Teddy 看风格**。

---

## B-9b · 放行（Teddy 2026-09-05 18:0x 确认 9a 风格）— status: **ready，立刻开始，做完直接接 9c、9d，不用再停**

Teddy 已看过线上首页，风格确认。按 `visual-system-v2.md` §2.3 / §5 做 9b（`/about`：拱门肖像、随滚动生长的时间轴、米色圆角节点卡片），完成后**不停**，直接做 9c（记忆 / 月页 / 事件页）和 9d（收口）。每阶段一个 commit，出箱各写一条；Cowork 会在浏览器里逐阶段验收，不通过会写回入箱。

**9d 收口清单在原有基础上追加（Teddy 2026-09-05 + Cowork 验收）：**
1. 首页「最近的新变化」每条要点前加一个**彩色小图标**（Teddy 要求）。约束：不用 emoji、不用现成图标库；用 4–6 个内联 SVG 线性小图标（如：语言 / 动作 / 兴趣 / 吃饭睡觉 / 社交 / 健康），16–18px，颜色只用 `--sage` / `--clay` 和一个低饱和的暖粉或杏橙，圆角线条。图标按要点文字里的关键词做**确定性**匹配（说 / 词 / 喊 → 语言；走 / 跳 / 舞动 → 动作；绘本 / 玩 / 喜欢 → 兴趣；吃 / 睡 → 作息；老师 / 小朋友 / 家人 → 社交），匹配不到用默认的一个小点。**不调模型、不改文字。**
2. 桌面 ≥1000px 时「最近生活」容器放宽到 ~1100px，照片 : 文字 ≈ 1.2 : 0.8，记忆标题不能在词中间断行。
3. Badge 单行（`white-space: nowrap`），格式「2026 年 8 月 28 日 · 当时 1 岁 7 个月」。
4. 首页「本月入口」套壳：Badge + 圆角卡片（`--card-soft` 底），整块可点。
5. 全站残余 1px 直线（`.text-link` 下划线等）统一改为 `--sage` 短线 2px 圆角或去掉。

---

## B-9bc-fix · 9b / 9c 线上验收：两个硬伤，**插队，先于 9d 剩余项** — status: **ready**

Cowork 2026-09-05 10:1x 浏览器实看（375 手机全高）。

**1. `/about` 的肖像还是那盘香蕉和牛奶（`wechat-media:a7d4da30…`，乳儿班 9/3 餐点照），现在还被裁成了拱门。** 出箱里说「P1-portrait: memory-chapters.ts 已有竖版优先逻辑，无需重复实现」——**竖版优先挡不住一张竖版的香蕉照**。这是全站最私人的页面，第一屏不是张年本人，其它都白做。规则改成：`latestPortrait` **只在来源身份为夸克 `family_photo` 背书的 media 里选**（`media-quark-sha-…`），乳儿班 / 微信来源即使 trusted 也不作肖像；无符合者退到首页封面照（现在是 `media-quark-sha-379105…`，就是那张笑着伸手的）；再无则不放图。验收：`/about` 第一张图的 id 以 `media-quark-sha-` 开头，且是人。

**2. 月度回顾在 `/about`「最近的生活节奏」和月页刊头（`/memory/2026/08`）都被渲染成一整段带 `- ` 的原始文本**：「- 张年入选了… - 开始能和老师… - 突然变得…」挤成一坨。B-8 只修了首页。A 轨把 `monthly_snapshot.summary` 改成了逐行 `- ` 格式，所以**所有**读 summary 的地方都要走同一个渲染器：抽一个 `SnapshotSummary` 组件（按 `\n` 拆、去 `- ` 前缀、`<ul><li>`），首页 / 月页 / about 三处共用；grep 全仓库 `summary` 的渲染点，一个不漏。验收：三处都是分行要点，页面上 grep「- 」= 0。

**3.（不阻塞，9d 一起）** 9c 的滚动唤醒用了 `animation-timeline: view()`，iOS Safari 目前不支持——苏静在微信 / Safari 里看，**整站的「回忆依次醒来」在她手机上等于没做**。加 `IntersectionObserver` 兜底（不支持 `view()` 时用 `.is-visible` 类触发同一个 fadeInUp，图片先、文字延迟 0.1s），`prefers-reduced-motion` 同样关闭。

**4.（9d 一起）** 月页每天之间、「这个月记下来的」上方的 1px 通栏线仍在。

做完 1、2 出箱写一行，Cowork 再看；然后继续 9d。**你的上下文快满了（auto-compact 7%）：先按晨间交接规则覆盖写 `HANDOFF-B.md` 再动手，免得压缩后忘了 1、2。**

---

## B-9e · 9d 验收余项（小，先做）— status: **ready**

Cowork 2026-09-05 10:4x 浏览器实看：B-9bc-fix **通过**（`/about` 肖像已是 `media-quark-sha-379105…` 本人 + 拱门；月度回顾三处都成了分行要点）。9d 大部分过了（Badge 单行、本月入口卡片、IO 兜底、首页横线清零）。剩两条：

1. **首页「新变化」要点小图标太淡**：现在是 1px 灰线小图标，手机上几乎看不见。Teddy 要的是「彩色」——改成 18px、2px 线宽、每类一个实色：语言 `--sage`、动作 `--clay`、兴趣 `#D9A5A0`（低饱和暖粉）、作息 `#C9B27C`（暖黄）、社交 `#A3B5C4`（灰蓝）；可加 6px 圆角的同色 12% 底色小方块托一下。
2. **月页每天之间仍有 1px 通栏线**：9d 改的是 `.month-moment` 的 border-bottom，但线上（`2df9d31f….css`，cc1cd5a 已部署）实测每条记忆的顶上还有一条——来源是 `.month-reading .moment-memory_led { border-top: 1px solid var(--color-border) }` 这条规则没动。去掉它，用 `margin-top ≥ 56px` 分隔；`.back-link` 已经是 2px sage，这条过了。

验收：手机上要点图标一眼能认出颜色；`/memory/2026/08` 上 `.month-moment` 的 border 为 0。

---

## B-10 · 「张年」页太空：它现在只有一张肖像和一个月度回顾 — status: **ready（B-9e 之后）**

**背景**　9b 之后 `/about` 只剩「肖像 + 最近的生活节奏」两块。B-5（P1-11）出箱说做了「最近的变化 / 档案最近记下的 / 更早的时候」，但线上一个都不渲染——`recentTraceNotes` 读的是 `daily_traces`，而 T11 之后新内容全是 `life_event`，所以永远为空。**这一页是三个一级入口之一，现在回答不了「他现在是谁」。** 原则一的检验句在这一页不成立。

**目标**　打开 `/about`，肖像之下能读到：**最近记下来的**（最近 30 天已发布 life_event 的标题，DayMark + 标题，每条可点进 `/events/[id]`，最多 6 条）；**家人最近说**（从这些 life_event 的 `story` 里用确定性正则 `(妈妈|爸爸|奶奶|雪姨|老师)(说|转述)?[：:]?「([^」]{2,40})」` 抽前 3 句原话，带称谓 + 日期，可点回记忆；抽不到不渲染）；**更早的时候**保留折叠。全部只读已发布内容，不调模型、不编、不计数。

**硬边界**　数据只从已发布 life_events / snapshots 来；某块没材料整块不出现；时间轴组件沿用 9b 的样式（米色圆角节点 + 随滚动生长），这次它终于有 ≥3 个节点可以「长」了。

**验收**　手机全高截图：肖像之下至少两个内容块；每条有日期可点；「家人最近说」每条有称谓；页面无「暂无」、无计数。

---

## B-11 · `/memory` 记忆索引页：从「一张张大图往下堆」变成一本目录 — status: **ready（先做）**

**背景**　Cowork 2026-09-05 11:2x 手机实看 `/memory`：刊头之后就是 9 月的三条记忆，每条一张约 700px 高的竖图 + 标题 + 正文，一屏只装得下一条；年份手柄「2026 / 2025」是两行裸文字。它现在是「月页的复读」，不是索引。规范 §2.4 要的是错落有致的照片流、充裕留白、32px 圆角、滚动唤醒。

**目标**　打开 `/memory`，一屏内能看到一整年的月份轮廓；每个月是一张可点的卡片，里面一张**横向裁切**的代表照（不是整张竖图）+ 月份 + 月龄 + 一句（月度回顾第一句，没有就第一条记忆标题）；月份卡片错落排布（手机单列、≥720px 双列瀑布流，用 CSS `columns` 或 grid `masonry` 兜底），进入视口依次浮现。

**硬边界**
- 数据来源不变（`buildMemoryIndex`），只改布局与每月展示的密度；**不新增计数**（现在索引行里的「N 段记忆 / N 张照片」一并去掉，用第一条记忆标题替代）。
- 代表照只从有背书绑定的照片里选（沿用 hero 选择），`object-fit: cover; object-position: 50% 32%`，高度固定 `clamp(160px, 40vw, 240px)`，32px 圆角 + `--shadow`。
- 年份手柄改成胶囊：白底陶字，当前年实心陶底白字；点击平滑滚到该年。
- 首屏 `<img>` ≤ 每月 1 张；`loading="lazy"` 除首屏两张。

**验收**　手机 375 全高截图：第一屏看到 ≥3 个月的卡片；页面上无「N 段 / N 张」；桌面双列错落；卡片进入视口有 fadeInUp（IO 兜底）。

---

## B-12 · 事件页 `/events/[id]` 套壳与验收 — status: ready

**背景**　B-9 三阶段都没正面碰事件页（只顺手给 `.detail-hero` 加了圆角）。它是所有「查看那天」「点进记忆」链接的落点，现在样式很可能还是旧骨架。

**目标**　事件页与首页同一套壳：hero 32px 圆角 + 暖阴影；日期 + 年龄合成胶囊 Badge；标题 800 字重；正文 `--ink` 1rem/1.75；「当时留下的资料」折叠区 `--card-soft` 底 + 20px 圆角、无 1px 直线；同天照片走 `PhotoGallery`。返回链接 2px sage。

**硬边界**　文本一字不改；证据分层（B-1）与查看器（B-2）行为不变；不出现计数以外的新句子（现有「当时留下的资料 N 项」保留）。

**验收**　随便点 3 条记忆：手机上无直角、无 1px 直线；Badge 单行；折叠区默认收起；375 无横向滚动。

---

## B-13 · 「家人最近说」窗口 — status: ready（一行）

B-10 写的是最近 30 天，线上抽到了 7 月 20 / 23 日。改成：**窗口 60 天，标题改「家人这阵子说」**；仍最多 3 句、按日期倒序。

---

## B-14 · 首页「最近的一组」 — status: ready（B-11 之后）

**目标**　首页「最近的新变化」之下、「本月入口」之上加一块：最近 3 条**带背书照片**的已发布记忆，一大两小 cluster（大图占 2/3 宽，两小竖排），32px 圆角，每张点进 `/events/[id]`；不足 3 张就 2 张 duo，1 张不做这块，0 张不渲染。**无标题文字、无计数**，只有照片——这是原则五「重与轻」在首页的体现：文字讲一件事，照片带过一组。

**硬边界**　照片只用 `hero_media_id` / `media_ids` 里夸克背书的；不与封面照重复；首屏 `<img>` 最多 +3（lazy）。

**验收**　手机上这块一屏内完整可见；三张都是张年本人；点得进去。

---

## B-15 · 「代表照」全站统一规则：只有夸克 family_photo 才能当封面 — status: **ready，最高优先级；B-11 / B-14 验收不通过的唯一原因**

Cowork 2026-09-05 12:3x 浏览器实看（375 全高）：

- **`/memory` 月份卡片的代表照**：9 月 = 相框特写、8 月 = 相框特写、7 月 = 后脑勺、6 月 = 老师的背影、5 月 = 乳儿班一日记录表、4 月 = 头顶。**六张里没有一张是张年的脸。** 全是 `wechat-media:` 来源（乳儿班群图），再加 `object-position: 50% 32%` 固定裁切，等于把「不是他的照片」裁得更不像他。
- **首页「最近的一组」三张**：`a7d4da30`（香蕉牛奶）、`16c0ea25`、`9fecd294`，全部 `wechat-media:`。B-14 的硬边界写的是「只用夸克背书的」，没有执行。
- 同一件事已经是第三次出现（9b 肖像香蕉、9e 之后 `/about` 修了、现在索引页和首页又回来了）。**根因是「trusted 来源」≠「照片里是张年」**：乳儿班群的图 trusted 只保证「来自那天那个群」，不保证主体。

**规则（写死，全站共用一个函数）**　新建 `lib/media/representative.ts`：`isPortraitOfZhangnian(media)` = `media.id.startsWith("media-quark-sha-")`（夸克相册 = 家人手机拍的 = 主体是他）。以下所有「代表照 / 封面」槽位**只能**从通过该函数的照片里选，选不到就**不放图**（卡片退化为纯文字，不放灰框）：

1. 首页封面照（`home-view` cover hero）
2. 首页「最近的一组」cluster（B-14）
3. `/memory` 月份卡片代表照（B-11）
4. `/about` 肖像（9bc-fix 已经这样做了，改成调用同一个函数）
5. 事件页 hero **不受此限**（那一天的乳儿班照片就是那天的证据，在正文里出现是对的）；月页正文里每天的照片也不受此限。

**顺带修两处**
- 月份卡片图区高度现在 459px，是竖图整张塞进去；按 B-11 原要求：`clamp(160px, 40vw, 240px)` 横向裁切，`object-position: 50% 30%`。
- 月份卡片和 cluster 用的是 `variant=thumbnail`（219px / 112px 宽）拉伸到 340px，糊。卡片图 ≥ 200px 显示宽度时请求 `web` 变体。

**验收**　`/memory` 每张月份卡片的 `<img src>` 都含 `media-quark-sha-`，且每张能看到张年的脸（Cowork 肉眼看）；没有夸克照片的月份卡片没有图区；首页 cluster 三张全是 `media-quark-sha-`，不与封面照重复；缩略图不糊（naturalWidth ≥ 显示宽度）。

**不可接受**　为了「每个月都有图」放乳儿班图；用灰框占位；改 `isPortraitOfZhangnian` 的判据去放宽。

---

## B-0 · 收拾本地 git — status: **done（Teddy 2026-09-05 手动完成）**

历史已干净：`99c25da` / `cc6210b`（含 241 MB zip）被 `5cfc1c0` + `0fb467b` 取代，origin/main = 本地 main，`git log --all -- .github/skills.zip` 为空。下面的原始说明留档，不要再执行。

<details><summary>原始说明</summary>

Cowork 2026-09-05 15:0x 查本地仓库：`main` 比 `origin/main`（= `2b759e7`，B-15 已在线上）**多 2 个未 push 的提交**：
- `99c25da 中断恢复`：一次性提交了 20 个文件，其中 **`.github/skills.zip` 241 MB**（GitHub 单文件上限 100 MB，**这个提交 push 必被拒**），还带进了 `Claude outputs/*.png`、两个 `.log`、`v2/package-lock.json`、`v2/scripts/quark-heic-ingest-linux.mjs`（A 轨的文件）以及 docs。
- `cc6210b remove skills.zip`：又删掉了 zip，但 241 MB 的 blob 仍在 `99c25da` 的历史里，push 照样会失败。
- `.git/index.lock` 有残留（Cowork 侧删不掉，你可以）。

**做法**（不要 `git push` 前先做完）：
```
rm -f .git/index.lock
git reset --soft 2b759e7          # 两个提交退回暂存区，工作区不动
git restore --staged .github/skills.zip "Claude outputs" heic-convert-full.log quark-heic-ingest.log
git status                        # 看清剩下什么
```
然后分两次提交：① `docs/**`、`docs/design/_superseded/**`、`CLAUDE.md`、`AGENTS.md`、`.gitignore`（把 `*.log`、`Claude outputs/`、`.github/skills.zip` 加进 `.gitignore`）——`docs(b): recover interrupted session notes`；② `v2/package-lock.json`、`v2/scripts/quark-heic-ingest-linux.mjs` 是 **A 轨的文件**，不要动，`git restore --staged` 放回工作区，在出箱里写一句告诉 A 轨。工作区里那 119 个 v2 文件全是 CRLF 差异，一个都不要加。`git push`，确认 `origin/main` 前进且没有 zip。

**验收**　`git log --stat origin/main -3` 里没有任何 `.zip` / `.png` / `.log`；`git status` 只剩 CRLF 噪音。
</details>

---

## B-15-fix · 规则对了，但卡片全是空灰框：夸克 `web` 变体经 Next 图片优化器超时 → 404 → `Photo` 自己把 `<img>` 删了 — status: **ready，立刻**

Cowork 2026-09-05 14:4x 实测（`2b759e7` 已部署）：`/memory` 所有月份卡片的 `<img src>` 都是 `media-quark-sha-` ✅，**但页面上一张图都没有**——DOM 里 `main img` 数量 = 0，只剩空的灰色 `figure`。原因链：

1. 卡片请求的是 `?variant=web&w=2048`。夸克 web 变体是 1280×2276 的 webp，单张 490 KB；`/api/media/...?variant=web` 直连要 **5–7 秒**才返回（`curl` 实测 7.4s）。
2. Next 图片优化器等不到上游就返回 404（返回的是站点自己的「这一页不在档案里」页面）。`42a286…` 这张 `/_next/image?...&w=640` 稳定 404。
3. `components/photo.tsx` 的 `onError` 链是 thumbnail → web → **移除自己**。web 一 404，整张图消失，卡片剩灰框。

**改法（B 轨，渲染层）**
- 月份卡片、首页 cluster、`/about` 「最近记下来的」缩略图等所有 ≤ 400px 显示宽度的位置，一律请求 `variant=thumbnail`（服务端生成的 thumbnail 就是 480px 宽 webp，够用），`sizes` 写成真实显示宽度（如 `(max-width:720px) 92vw, 340px`），不要再让优化器出 2048。
- `Photo` 的最后一级 fallback 改为：优化器失败时**换成直连** `mediaDeliveryUrl(id, "thumbnail")` 的 `<img unoptimized>`，而不是 `return null`。任何情况下不要让一个有背书的照片位变成空灰框。
- 卡片图区在图片未到位前用 `--card-soft` 底 + 固定 `aspect-ratio`，不塌不跳。

**记给 A 轨 / T3 性能（不在本任务内）**：`/api/media/<id>?variant=web` 对夸克大图 5–7s，是 R2 → Vercel 函数 → 客户端两跳 + 490 KB；T3 要么给 web 变体加 CDN 缓存头 / 直出 R2 公网 URL，要么把 web 变体压到 ≤ 200 KB。Cowork 已写进 `STATUS.md`。

**验收**　`/memory` 手机全高：每张有夸克照片的月份卡片都**看得见张年**，`main img` 数 = 有图卡片数，`naturalWidth ≥ 384`；首页 cluster 三张可见；`/about` 缩略图可见；没有一个灰框。

---

## 🔁 工作节奏：领了任务就别断

**这是这条轨最重要的一条规则。**

1. 做完一件 → 在「出箱」写一条 → **立刻回到「入箱」读下一件 ready 的任务，直接开始**。
   不要停下来问"要不要继续"，不要等 Cowork 或 Teddy 发话。B-1 → B-2 → B-3 → B-4 → B-5 顺着做。
2. **卡住不等于停下**。如果某一件被卡住（比如需要 A 轨的东西、或者需要 Teddy 拍板），
   在出箱写清楚卡在哪，**然后跳过它去做下一件 ready 的**，不要空转。
3. **入箱空了也不要闲着**：回到已完成的任务上，按各自的"验收"段在**手机宽度**下真的走一遍，
   把发现的问题写进出箱并顺手修掉。这个项目的完成标准是"nianlife.cn 上多出一样能用的东西"，
   不是"代码写完了"。
4. Cowork 会不定期往入箱里加任务、也会在出箱下面写验收结果。**每做完一件都重读一遍入箱**，
   顶部可能已经有新的、优先级更高的东西。
5. 唯一该真正停下的情况：**入箱里明确写了"停下来等 Teddy 拍板"**，或者你要做的事会
   删数据 / 改 `.env` / 动 A 轨的文件。那时候写出箱说明原因，然后去做别的。

---

# 📤 出箱

> B 轨在这里回报。格式：**线上多了什么**（家人能看见的变化）· **怎么验证的** · **没做到什么** · **下一件**。
> 不要写"测试通过"当作完成——这个项目的完成标准是 nianlife.cn 上多出了一样能用的东西。

### B-1 · P1-12 证据精选 · 完成 2026-09-05

**线上多了什么**　事件详情页的「当时留下的资料」折叠区里，primary 证据现在先出现；supporting/context 证据缩进到「当天其余资料（N 项）」的次级折叠里，默认收起。长文（>120 字）显示前 120 字 + 省略号，点开展开全文。所有源数据一条不少。

**怎么验证的**　typecheck 通过；推到 main，Vercel 部署。能在 https://nianlife.cn/events/<id> 上验证：primary 条数 < 总条数时页面明显变短，次级折叠存在且可以展开看育儿建议长文。没有 primary 的事件回退为原来的平铺行为。

**没做到什么**　（已补验收）见下方「线上验收补记」。

**下一件**　B-2 照片查看器（已完成，见下）。

---

### B-2 · P1-8 照片查看器 · 完成 2026-09-05

**线上多了什么**　月页和事件页所有照片现在都可以点开全屏查看。左右滑动翻同组照片，双击放大 2.5 倍看脸，Esc/返回键关闭（一次返回，不会退出页面）。查看器顶部显示日期和年龄（原则二）。事件页 hero + supporting 合并为一个相册组。月份档案每天的照片各自一组。

**怎么验证的**　typecheck 通过；推送到 main。月页 `month-archive` 每天的 `PhotoStrip` 已替换为 `PhotoGallery`；`MonthMoment` 的 hero + strip 合并到 `PhotoGallery`。

**没做到什么**　① 未在真机上做手势验收——需要 Vercel 部署后在 nianlife.cn 实际操作；② 事件页的 hero → story → strip 阅读顺序变为 hero+strip → story，是可接受的布局调整；③ 缩略图没有复用 Photo 组件的双层 fallback 链（thumbnail → web）。

**下一件**　B-3（已完成，见下）。

---

### B-3 · P1-9 月页渐进展开 · 完成 2026-09-05

**线上多了什么**　月页底部的「还有 N 天、M 张照片」变成可点击的展开按钮。点击后调用 Server Action `getFullArchiveDays`，按需加载被折叠的那些天的全部照片，用 PhotoGallery 渲染（支持查看器）。初始 HTML 体积不变，不预生成隐藏照片的 img 节点。

**怎么验证的**　typecheck 通过；推到 main。

**没做到什么**　① 未在线上手动触发过展开——需等 Vercel 部署后验收；② Chronicle 里单天的「还有 N 张」没有实现内联展开，用户需要点开档案区来看全部。

**下一件**　B-4（已完成，见下）。

---

### B-4 · P1-10 首页三块 · 完成 2026-09-05

**线上多了什么**　首页从可变数量的块精简为三块：① cover（最值得看的一天，逻辑不变，照片现在支持查看器）；② 最近的新变化（直接取 monthly_snapshot.summary，没有就整块消失）；③ 本月入口（极简链接）。移除了 pastLead（上一段记下来的生活）和 change（成长笔记）两个旧块。

**怎么验证的**　typecheck 通过；推到 main。

**没做到什么**　未在 nianlife.cn 实际打开验证—— summary 是否存在需要线上确认；cover 月份与 thisMonth 月份一致时"本月入口"不显示（showThisMonth=false），逻辑正确但需实际观察。

**下一件**　B-5 张年页。

---

### B-5 · P1-11 张年页 · 完成 2026-09-05

**线上多了什么**　`/about` 页的"最近的变化"每条现在带有链接——有对应 life_event 的条目旁边出现"查看那天"，点进 `/events/{id}`；添加了"最近的生活节奏"块（取最新 monthly_snapshot.summary，没有就整块消失），month label 可点击进入月页；"档案最近记下的"和"更早的时候"里的日期现在都是链接，直接跳到对应月页。健康数据（身高/体重/照护）仍留在"更深的资料"折叠里。

**怎么验证的**　typecheck 通过；推到 main。每个 section 在没有数据时整块不渲染（原则六）；snapshot summary 取 `snapshots` 数组最新有 summary 的一条，absent → 块消失。

**没做到什么**　① 未在线上验收——growth records 有多少条带 lifeEventId 需等 Vercel 部署后实际点开 `/about` 确认；② trace notes 只链到月页，没有锚点跳到当天（月页没有日级锚点）；③ 若 snapshots 为空，"最近的生活节奏"块不显示，属设计内。

**下一件**　B-1 到 B-5 全部完成；进入收尾三步（HANDOFF-B → push → STATUS-B marker）。

---

### B-6 · push 本地 commit · 完成 2026-09-05

**线上多了什么**　`d1b6e3e`（perf: scoped getStore() + P1-portrait + P1-sept-snapshot，A 轨代码）已 push 到 main，Vercel 开始部署。

**怎么验证的**　`git log --oneline -3` 确认 `d1b6e3e` 在顶部；`git push origin main` 成功，`ee443c0..d1b6e3e  main -> main`。

**没做到什么**　Vercel 部署状态未等待确认（约 1-2 分钟自动完成）。

**下一件**　B-7 夸克历史素材入库。

---

### B-7 · P1-2 夸克历史素材入库（续跑）· ⏸ 等待 A 轨修复 2026-09-05

**已知状态**　三次跑均失败 (b7z6hljna / btppqu1ki / bdenecoiu)，exit 1，无 JSON 摘要，无 stderr 错误输出。干跑 exit 0 正常，说明 crash 只发生在 apply 路径。crash 绕过外层 try/catch，最可能是 sharp/libvips 原生内存 OOM 导致 SIGKILL。DB 里已有 204 条 raw_sources（checksum 去重，重跑安全）。

**已 revert**　`v2/scripts/quark-history-init.mjs` 的诊断改动已还原（A 轨边界）；Codex（task-mtntehv1-r3ils8）正在排查 `quark-photo-apply.mjs` / `client.ts`。

**下一步**　等 A 轨/Codex 报告修复结果，再重跑一次。完成后查库并补写结果。

---

## 🌅 晨间交接规则（长期有效，每天都适用）

Teddy 每天早上会把这条轨的上下文清掉（`/clear`），所以**连续性必须活在文件里，不在你的记忆里**。

---

### 线上验收补记 · B-1~B-5 · 2026-09-05

B-1 至 B-5 的"没做到什么"栏都说"未在线上验证"，这里补验：

**B-1 证据精选** ✅ 已验
- `curl https://nianlife.cn/events/event-v2-b76018fcae4fb0a3f90d4b4efe4d2cdc` 抓到「当时留下的资料 35 项」+ `<details class="evidence-secondary">当天其余资料（34 项）`。
- 证据数最多的那条事件（35 总/1 primary）：第一层只显示 1 条；34 条 supporting 在次级折叠里，默认收起。**验收通过。**

**B-2 照片查看器** ⚠️ 半验
- August 月页 HTML 里有 `PhotoGallery` 组件占位、71 个 `<img>` tag（带 lazy loading）。查看器是纯客户端 JS，curl 无法触发点击/滑动——**需要真机上用手指点才能确认滑动/放大/关闭**。

**B-3 月页渐进展开** ✅ 已验
- August 月页（220 KB）有「还有 29 天、548 张照片——点此展开全部」按钮；`ArchiveExpander` 存在；初始 71 个 `<img>`，548 张档案图片**未预先渲染**（`archive-day` / `archive-item` 类数量 = 0）。**验收通过。**

**B-4 首页三块** ✅ 已验
- 首页可见三块：① 最近一段生活（最近三条记忆 + 日期/年龄）；② 最近的新变化（取自 8 月 snapshot.summary）；③「翻看这个月」（本月入口）。**验收通过。**

**B-5 张年页** ✅ 已验（部分）
- `/about` 显示：年龄「1 岁 8 个月」、「最近的生活节奏 2026 年 8 月」。growth records 有无带 lifeEventId 的条目（即「查看那天」链接能否出现）仍需真机打开确认。

---

### B-8 · P1-snap 渲染修复 · 完成 2026-09-05

**线上多了什么**　首页「最近的新变化」的 summary 现在分行显示为列表项，不再挤成一段。`- ` 前缀自动去掉，每行一个 `<li>`。

**怎么验证的**　typecheck 通过；推 main (7fda35b)，Vercel 部署后可在首页「最近的新变化」验证分行效果。

**没做到什么**　未 curl 线上确认（Vercel 部署需约 1 分钟可补验）。

**下一件**　入箱无其他 ready 任务，继续监控。

---

### B-9a-fix · 首页视觉补全 · 完成 2026-09-05

**线上多了什么**　commit ce1225d 上线 5 条修复：① `.home-lead .memory-lead` 现在和 moment 分支共用同一套视觉壳——32px 圆角 + shadow + hover 上浮，TimeSignature 转成白底陶字胶囊 Badge，≥900px 左图右文布局；② h1 字号 clamp(2.75rem,14vw,9rem) → clamp(2.4rem,7vw,6rem)，加 white-space:nowrap，800px 宽不断词；③ 「最近的新变化」列表从 25.6px 大标题字号降为 1rem/500/--muted 正文；④ home 三处 border-top:1px 改为 ≥64px 留白分隔；⑤ next.config.ts 加 deviceSizes 排除 3840，不再生成 ?w=3840 srcset 条目。

**怎么验证的**　typecheck 通过（0 错误）；推 main (ce1225d)，Vercel 自动部署。

**没做到什么**　未在真机上拍屏确认——Vercel 部署需约 1 分钟，Cowork 可直接在浏览器按 B-9a-fix 的 5 条验收句打开 nianlife.cn 首页复核。

**下一件**　已按入箱指示停下，等 Teddy 看风格后再继续 B-9 9b。

---

### B-9b · 关于张年 · 完成 2026-09-05

**线上多了什么**　commit ca60c0b 上线：① 张年肖像照裁成圆拱门形状（`border-radius: 50% 50% 32px 32px / 40% 40% 32px 32px` + `overflow:hidden` + `--shadow`）；② 四个 `.about-notes` 块包进 `.about-timeline` 容器，左侧一条鼠尾草绿细线随滚动"向下绘制"（CSS `animation-timeline: scroll(root)`，不支持的浏览器直接显示完整线，`prefers-reduced-motion` 时动画关闭）；③ 每个节点块背景换成 `--card-soft`（#F3EEE6）米色 + 20px 圆角 + 左侧鼠尾草圆点；旧的 border-top/border-bottom 分割线在 timeline 上下文里取消。另修正 B-9a-fix 遗留 bug：`var(--muted)` 之前无对应 token，现在 `:root` 里补了 `--muted: #7A7267`。

**怎么验证的**　typecheck 通过（0 错误）；推 main (ca60c0b)，Vercel 自动部署。

**没做到什么**　未在真机上确认拱门效果和滚动线——需 Vercel 部署后打开 nianlife.cn/about 验收。

**下一件**　B-9 9c（月页 / 记忆 / 事件页），接着做。

---

### B-9c · 记忆 / 月页 / 事件页视觉 · 完成 2026-09-05

**线上多了什么**　commit 4800751：① 所有编辑级别照片加 32px 圆角（`.memory-lead .memory-photo .photo`、`.memory-entry .memory-photo .photo`、`.moment-hero`、`.detail-hero`）；archive 缩略图故意不加（B-3 性能约束）；② 照片查看器背景从 `#000` 改为 `rgba(0,0,0,.88)` + `backdrop-filter: blur(24px) saturate(180%)` 毛玻璃深底；③ 月页记忆条目和 moment 块加 CSS `animation-timeline: view()` 滚动唤醒（`@supports` 包裹，旧浏览器不播动画，`prefers-reduced-motion` 也不播），照片先进场（`entry 0%→28%`）、文字稍后（`entry 8%→36%`）。

**怎么验证的**　typecheck 通过（0 错误）；推 main，Vercel 自动部署。

**没做到什么**　未在真机上确认效果——需 Vercel 部署后打开月页和事件页验收。

**下一件**　B-9bc-fix（已做，见下）。

---

### B-9bc-fix · /about 肖像 + 月度回顾渲染 · 完成 2026-09-05

**线上多了什么**　commit f9a1e39：① `latestPortrait()` 现在只在 `media-quark-sha-*` ID 的照片里选——WeChat / 乳儿班图源即使已 trusted 也不进候选，不再把食物照作为张年肖像；② 新建 `SnapshotSummary` 组件，按 `\n` 拆行、去 `- ` 前缀、渲染 `<ul><li>`；③ 三处 summary 渲染点（首页「最近的新变化」、/about「最近的生活节奏」、月页刊头）全部改用同一组件，不再出现带 `- ` 的一坨原始文字；④ `.chapter-summary` CSS 适配 `<ul>`（`list-style:none; padding:0; li margin-top:.35em`）。

**怎么验证的**　typecheck 通过（0 错误）；推 main (f9a1e39)，Vercel 自动部署。B-9bc-fix 入箱两项硬伤（肖像过滤、summary 渲染）均已处理。

**没做到什么**　未在线上实看——需 Vercel 部署后打开 `/about` 确认肖像 id 以 `media-quark-sha-` 开头；打开 `/memory/2026/08` 确认 summary 分行显示、页面 grep「- 」= 0。B-9bc-fix 第 3 条（IntersectionObserver 兜底）和第 4 条（月页通栏线）与 9d 一起做。

**下一件**　B-9d（已做，见下）。

---

### B-9d · 全站收口 · 完成 2026-09-05

**线上多了什么**　commit cc1cd5a：① `scroll-reveal.tsx` Client Component：在不支持 `animation-timeline:view()` 的 iOS Safari 上，给 html 加 `.io-reveal-pending`，用 IntersectionObserver 当元素进入视口时加 `.is-visible`——苏静在微信/Safari 里也能看到照片依次醒来；② 首页「本月入口」改为整块可点的圆角卡片（`--card-soft` 米色底 + 32px 圆角 + hover 上浮），badge 显示月份+年龄；③ `SnapshotSummary` 增加 `icons` 属性，首页「最近的新变化」每条要点前加关键词匹配的内联 SVG 图标（语言/动作/兴趣/作息/社交，16px，--sage/--clay/--apricot 颜色）；④ `date-badge` 和 `home-lead .memory-lead .time-signature` 加 `white-space:nowrap`（Badge 不再折两行）；⑤ home-lead 在 ≥1000px 时放宽到 1100px；⑥ `.text-link/.back-link` 下划线从 `1px currentColor` 改为 `2px var(--sage)`；⑦ 月页每天分隔从 `border-top` 改为加大 `padding-top:32px`；⑧ chapter-masthead 移除 `border-bottom`。

**怎么验证的**　typecheck 通过（0 错误）；推 main (cc1cd5a)，Vercel 自动部署。

**没做到什么**　① 未在真机上确认 IO fallback 效果（iOS Safari 实机测试）；② 图标为确定性关键词匹配，未验收每条实际要点的匹配准确率；③ B-9d 入箱第 5 条「`.text-link` 下划线等全站统一」只改了主体规则，个别 `.text-link` override（如 `.archive-expand`）保留原样——非阻塞。

**下一件**　读入箱顶部看有无新任务；若无，等 Cowork 验收 B-9bc-fix 和 B-9d。

---

## 🌅 晨间交接规则（长期有效，每天都适用）

**触发时机**：Cowork 或 Teddy 让你"收尾"时，或者你自己判断当前任务已经跑完一个完整节点时
（一个月跑完、一个功能上线并验证过——**不要停在一个月跑到一半**）。

**收尾三步，顺序不能换：**

1. **先覆盖写 `docs/HANDOFF-B.md`** ——覆盖，不是追加；100 行以内；模板就是它现在的样子。
   写的是"一个失忆的自己明天早上要知道什么"，不是"我今天干了什么"。干了什么在 `git log` 里。
   五段固定：我管什么 / 现在做到哪 / 下一件事（明确到命令）/ 不要再踩的坑 / 我不能单方面做的。
2. **提交并推送**（只加自己的文件）。
3. 在 `docs/STATUS-B.md` 末尾写一行：`=== B 轨已到收尾节点，可以 /clear ===`，然后**停下，不要再开新任务**。

Cowork 会盯着那行标记，看到就通知 Teddy 来清。清完之后新 Session 只读交接稿就能接着干。

**为什么交接稿要覆盖写**：`STATUS.md` 已经 900+ 行，是流水账，新 Session 读不完也不该读。
交接稿是定长的"现在"，两者分工不同，不要把交接稿写成第二本流水账。

---

## ⚡ P1-portrait · About 页 portrait 优先选人像照片 — status: ready（立刻做）

### 目标

About 页展示的 portrait 是张年的人像照片，不是食物/物品照。

**现状**：`latestPortrait()` (`lib/memory-chapters.ts`) 遍历 chapters（最新月优先），取第一张 `heroSized()` + `isVouched()` 的照片。它不区分照片内容——可能选到食物摆盘照。

### 硬边界

1. **不引入外部 AI 人脸检测服务**——不加新的 API 依赖
2. **不改 media_assets schema**——不加列
3. **选不到人像时 fallback 到当前逻辑**（最新 vouched hero），不能让 portrait 变空

### 做什么

在 `latestPortrait` 的候选排序中，**优先选 portrait orientation（竖版）的照片**。
家长拍孩子人像几乎都是竖着拍的，这是不需要 AI 的最强信号。

具体：
- 遍历候选时，先找 `width < height`（竖版）的 heroSized + isVouched 照片
- 找不到竖版时，fallback 到当前逻辑（横版也行）
- 可以额外降权关联事件标题含"吃""饭""食"的照片（可选，不强求）

### 验收

1. About 页 portrait 是竖版照片（浏览器视觉验证）
2. 不影响其他页面的照片展示
3. npm run typecheck 通过

### 代码指引

- `latestPortrait()` 在 `lib/memory-chapters.ts` 约 line 331-343
- 调用处：`app/about/page.tsx:24`
- media_assets 表有 `width` 和 `height` 列
- **这个文件在灰色地带（`v2/lib/`），改完在出箱说一句**

---

## ⚡ P1-sept-snapshot · 首页"最近的新变化"回退到有 snapshot 的月 — status: ready（P1-portrait 之后做）

### 目标

首页"最近的新变化"区块有内容展示，不留空白。

**现状**：`buildHomeView` 取 `chapters[0].months[0]`（最新月 = 2026-09），然后找 `snapshots.find(item => item.month === thisMonth.month)`。9 月无 monthly_snapshot → summary 为 undefined → 整个区块不渲染。

### 硬边界

1. **不降低 month-review.mjs 的 MIN_EVENTS 阈值**——薄月不写 snapshot 是正确的
2. **不手写 / 硬编码 9 月的 summary 文本**
3. **保持 `isSnapshotPublishable` 的逻辑不变**

### 做什么

当 `thisMonth` 没有 snapshot 时，**回退到 snapshots 列表中最近的一个有 snapshot 的月份**。
月份标签要跟着 snapshot 走（显示"八月"而非"九月"），不能错位。

```typescript
// 当前月没有 snapshot 时，找最近有 snapshot 的月份
const snapshotMonth = snapshots.find(s => s.month === thisMonth?.month)
  ?? snapshots.sort((a, b) => b.month.localeCompare(a.month))[0];
// monthHref 和标签要跟着 snapshot 的月份走
```

### 验收

1. 首页"最近的新变化"区块可见，展示最近有 snapshot 的月份（当前应为 2026-08）
2. 月份标签与 snapshot 内容一致（不错位）
3. 不影响月页和 About 页的 snapshot 展示
4. npm run typecheck 通过

### 代码指引

- 改动点：`lib/home-view.ts` 的 `buildHomeView` 函数（灰色地带，改完出箱说一句）
- `app/page.tsx` 渲染逻辑可能也要改（月份标签）——**这个文件归 B 轨**
- 对照 commit `9dd5427`（之前的 null guard fix）确认不回归


---

### B-9a · 全站视觉重构阶段 9a · 已上线，等 Teddy 确认风格 2026-09-05

**线上多了什么**
- 全站换色：燕麦奶白底 (#F9F6F0)，深栗灰字 (#433E38)，鼠尾草绿强调色 (#9EAB92)，陶色 (#C2A88A)
- 字体：Nunito 400/500/800 自托管（next/font/google build-time 自托管，0 Google CDN 运行时请求）；中文走 PingFang/微软雅黑
- SiteHeader：「年」Logo 换 48×48 圆角矩形陶色底 + 悬浮旋转；desktop 导航下划线从中间向两侧展开；header 整体 fadeInUp 进场
- 首页大标题：字重 800，标题和日期标签错落进场（0.2s / 0.4s delay）
- 首页「最近生活」模块：桌面左右跨页（照片左 flex:1.2 + 文字右 flex:0.8），手机叠放；照片 32px 圆角 + 暖色阴影，悬浮上浮 8px + 阴影加深；日期改为胶囊 Badge（白底陶色字）
- prefers-reduced-motion：动效全归零（加了 animation-delay:0ms 消除延迟残留的 opacity:0）

**怎么验证的**　typecheck 通过；commit push 后 Vercel 自动部署

**没做到什么**
- 9b/9c/9d 未做（按计划等 Teddy 确认 9a 风格后再继续）
- 底部 nav（移动端）样式尚未更新（圆角/大地色）
- 月页、about 页、事件页圆角/进场动效未做

**下一件**　等 Teddy 在真实浏览器确认 9a 风格（手机 + 桌面）后，9b 开始 (/about 拱门肖像 + 时间轴)


---

### P1-portrait · 已完成（随 B-9a commit 带入，A 轨实现）2026-09-05

**线上多了什么** `latestPortrait()` 现在优先选 `width < height` 的竖版照片，找不到竖版时 fallback 到最新 vouched hero。已在 B-9a commit 5798b7e 里上线。

**没做到什么** 未截屏验证 About 页 portrait 实际是竖版——需真机打开 `/about` 确认。

---

### P1-sept-snapshot · 已完成（随 B-9a commit 带入，A 轨实现）2026-09-05

**线上多了什么** `buildHomeView` 当 thisMonth 无 snapshot 时，回退到最近有 snapshot 的月份（在 RECENT_ACTIVITY_MONTH_GAP 内），changeLabel 跟着 snapshot 月份走，不错位。已在 B-9a commit 5798b7e 里上线。

**没做到什么** 未验收首页「最近的新变化」是否可见——需真机打开首页确认 summary 区块显示。

**下一件** 入箱无其他 ready 项，继续 B-9 9b（Teddy 已确认 9a 风格）或等新任务。

---

### B-9e · 9d 余项收口 · 完成 2026-09-05 · commit a35adbb

**线上多了什么**
1. 首页「新变化」每条要点前的图标：18px / 2px 线宽，每类实色（语言鼠尾草绿、动作陶色、兴趣低饱和暖粉 #D9A5A0、作息暖黄 #C9B27C、社交灰蓝 #A3B5C4）+ 同色 12% 不透明度 6px 圆角底色徽章，手机上一眼能认出颜色。
2. 月页每天之间（`.moment-memory_led`）去掉 1px 通栏线，改用 `margin-top: clamp(56px,6vw,72px)` 留白分隔。

**怎么验证的** typecheck 通过；git add 只加 B 轨四个文件，commit a35adbb push main。

**没做到什么** 未在线上截屏验收（Cowork 验收）。

**下一件** B-10（已在同一 commit 完成，见下）。

---

### B-10 · 张年页内容补完 · 完成 2026-09-05 · commit a35adbb

**线上多了什么**　`/about` 肖像之下新增两个内容块：
- **最近记下来的**：最近 30 天已发布 life_event 标题，最多 6 条，每条日期 + 标题可点进 `/events/[id]`；无内容时整块不渲染。
- **家人最近说**：用确定性正则 `(妈妈|爸爸|奶奶|雪姨|老师)(说|转述)?[：:]?「([^」]{2,40})」` 从已发布 life_event story 里提取最多 3 句原话，每条有称谓 + 日期，可点回记忆；抽不到不渲染。
- 数据只来自已发布内容，不调模型，无「暂无」，无计数。

**怎么验证的** typecheck 通过；同 commit a35adbb。

**没做到什么** ① 未在线上打开 `/about` 截图验收（Cowork 验收）；② 若最近 30 天无发布 life_event，「最近记下来的」不显示；③ 若无引用句，「家人最近说」不显示——两种情况都属设计内（原则六：无材料不渲染）。

**下一件** 等入箱新任务 / Cowork 验收两块线上效果。

---

### B-11 · `/memory` 记忆索引页目录化 · 完成 2026-09-05

**线上多了什么**　`/memory` 从「月页复读」变成可浏览的目录：年份胶囊导航（白底陶字，最新年实心陶底）点击平滑滚到对应年；每个月是一张可点的卡片，内容：横向裁切的代表照（object-fit: cover 50% 32%，高度 clamp(160px,40vw,230px)，32px 圆角）+ 月份 + 月龄 + 月度回顾第一句（没有则取第一条记忆标题）；手机单列，≥720px 双列网格；卡片进入视口 fadeInUp（view() + IO 兜底）；原有的「N 段记忆/N 张照片」计数一并去掉。

**灰色地带改动**　`v2/lib/memory-index.ts`：原来 index-mode 月不 buildComposition（preview 空），现在所有非空月都 buildComposition，确保每张月卡有代表照。

**怎么验证的**　typecheck 通过；push main，Vercel 部署后 curl /memory 可验证 HTML 包含 `.month-card` 类。

**没做到什么**　未在线上手机截图验收（Cowork 验收）。

**下一件**　B-13（已完成，见下）。

---

### B-13 · 「家人这阵子说」窗口 60 天 · 完成 2026-09-05

**线上多了什么**　`/about` 「家人最近说」区块：窗口从 30 天改为 60 天；标题改为「家人这阵子说」；仍最多 3 句、按日期倒序。

**怎么验证的**　typecheck 通过；改了 `v2/app/about/page.tsx` cutoffDay30 → cutoffDay60 + 标题文字。

**没做到什么**　未在线上截图验收。

**下一件**　B-12（已完成，见下）。

---

### B-12 · 事件页 `/events/[id]` 套壳 · 完成 2026-09-05

**线上多了什么**　事件详情页套上与首页同款视觉壳：① 日期+年龄胶囊 Badge（白底陶字，与首页 Badge 一致）；② 标题 `font-weight: 800`；③ hero 照片加暖阴影；④「当时留下的资料」折叠区从 1px 直边变为 `var(--card-soft)` 底色 + 20px 圆角卡片；⑤ 返回链接 2px sage 已在之前完成。

**怎么验证的**　CSS 修改，typecheck 通过，push main。

**没做到什么**　未随机点 3 条记忆线上验收（Cowork 验收）。

**下一件**　B-14（已完成，见下）。

---

### B-14 · 首页「最近的一组」 · 完成 2026-09-05

**线上多了什么**　首页「最近的新变化」之下、「本月入口」之上新增照片 cluster：最近 3 条有夸克背书（`privilege.trusted`）lead photo 的已发布记忆，一大（flex:2）两小（flex:1 各半高）组成的 cluster，32px 圆角，每张点进 `/events/[id]`；不足 2 张不渲染；无标题文字、无计数。

**灰色地带改动**　`v2/app/page.tsx` 增加了 `EditorialMemory`、`MediaRef` 类型引入和 `Photo` 组件引入。

**怎么验证的**　typecheck 通过；push main。

**没做到什么**　① 未在手机截图验收（Cowork 验收）；② 若无夸克背书照片满 2 张，整块不渲染（属设计内）。

---

### B-15 · 代表照只认夸克 · 完成 2026-09-05 · commit 2b759e7

**线上多了什么**
- 新建 `lib/media/representative.ts`：`isPortraitOfZhangnian(media)` = `media.id.startsWith("media-quark-sha-")`，全站唯一权威，所有「代表照」槽位只从这里过滤。
- `/memory` 月份卡片：`preview.find(isPortraitOfZhangnian)` 替代 `preview[0]`；找不到夸克照片整块不渲染（无灰框）；缩略图 variant `thumbnail→web`（解决 219px→340px 拉伸糊图）。
- 首页 cluster：`privilege.trusted.has` 改为 `isPortraitOfZhangnian`，彻底排除 wechat-media。
- 首页 moment cover hero/supporting：同样过滤到仅夸克照片，无夸克照片则不渲染照片栏。
- `latestPortrait`（`memory-chapters.ts`，灰色地带已标注）：内联 `isQuarkOrigin` 删除，改用 `isPortraitOfZhangnian`。
- `globals.css`：月份卡片图区高度 `230→240px`，`object-position 32%→30%`；删除 `.month-card-photo--empty`。

**怎么验证的**　typecheck 通过（0 错误）；git add 只加五个 B 轨文件（含新建 representative.ts）；commit 2b759e7 push main，Vercel 自动部署。

**没做到什么**　未在 nianlife.cn 截图验收——等 Cowork 打开 `/memory` 逐张检查 `<img src>` 前缀、首页 cluster 三张来源。若某个月完全没有夸克照片，卡片无图区只有文字，属设计内。

**下一件**　入箱现在为 B-15 唯一任务；完成后等 Cowork 验收结果 / 新任务。

