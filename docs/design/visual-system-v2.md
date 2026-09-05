# Nianlife 视觉系统 V2 — 大地色 · 圆角 · 呼吸感 · 丝滑微动效（Teddy 定稿）

> 2026-09-05。**设计方向由 Teddy 给出**（本文 §1–§3 是他的设计稿原文的规范化转写，参考实现见 `docs/design/reference-earth-tones.html`）。Cowork 只补了 §4「落地约束」和 §5「分阶段与验收」。
> 取代 `visual-system-v1.md`（已作废，移到 `_superseded/`）。
> 与 `docs/nianlife-product-principles.md` 的关系：原则文档管**内容**（人先于功能、两个时钟、媒体在前、不计数、不等权、不编），本文管**皮肤**。§4 视觉方向里「远离密集的圆角卡片」按 Teddy 2026-09-05 的决定理解为：**圆角是本站的语言，要远离的是「密集」**——靠大留白避免卡片阵列感。

## 0 · 设计理念

放弃黑白灰商务 / 极简风与衬线体档案感。目标：**大地色系、温暖、治愈、有高级呼吸感的线上手账 / 画报**。大量留白，摒弃所有直角，用丝滑微动效让页面「娓娓道来」。

## 1 · 全局规范（`:root` / `globals.css` 严格应用）

### 1.1 色彩（Earth Tones）

| token | 值 | 用途 |
|---|---|---|
| `--bg` | `#F9F6F0` | 主背景（燕麦奶白，代替纯白） |
| `--ink` | `#433E38` | 主标题 / 正文（深栗灰，代替纯黑） |
| `--sage` | `#9EAB92` | 强调点缀：高亮文字、下划线、交互反馈 |
| `--clay` | `#C2A88A` | 辅助暖色：Logo 背景、日期小标签文字 |
| `--muted` | `#7A7267` | 次要说明文字 |
| `--card` | `#FFFFFF` | 胶囊 Badge 底 |
| `--card-soft` | `#F3EEE6` | 时间轴节点卡片的极浅米色底 |
| `--shadow` | `0 16px 40px rgba(138,121,102,.08)` | 图片 / 卡片的暖色呼吸阴影 |
| `--shadow-hover` | `0 24px 48px rgba(138,121,102,.15)` | 悬浮加深 |
| `--shadow-badge` | `0 4px 12px rgba(138,121,102,.05)` | 胶囊微阴影 |

### 1.2 字体

`font-family: 'Nunito', 'PingFang SC', 'Microsoft YaHei', sans-serif;` 全站统一，**不再使用衬线体**。标题 800，正文 400–500。

### 1.3 形状

彻底移除直角。大图 / 卡片 `border-radius: 32px`；小标签 / Logo / 胶囊 `16px`–`20px`；下划线 `2px`。

### 1.4 动效

```css
@keyframes fadeInUp { from { opacity:0; transform:translateY(30px) } to { opacity:1; transform:none } }
--ease: cubic-bezier(0.2, 0.8, 0.2, 1);   /* 进场 */
--ease-hover: cubic-bezier(0.25, 1, 0.5, 1); /* 悬浮 / 下划线 */
```
进场统一用 `fadeInUp 1–1.2s var(--ease) forwards`，错落用 `animation-delay`（0.2s 步进）。

## 2 · 各页面需求（Teddy 原稿）

### 2.1 全局导航（Header）
- Logo「年」：48×48 圆角矩形（16px），背景 `--clay`，白字。悬浮 `scale(1.05) rotate(-5deg)`。
- 导航链接悬浮不生硬变色：底部出现 `--sage` 下划线，**从中间向两边展开**（`::after` 定位 `left:50%; transform:translateX(-50%); width:0→100%`）。当前页常显下划线。
- Header 本身页面加载时 fadeInUp。

### 2.2 首页（Home）
- 首屏大标题「最近怎么样，张年。」字号约 7vw、800 字重，「张年」用 `--sage` 高亮。标题先出，日期标签延迟 0.2s 出（错落进场）。
- 「最近生活」模块：**左右跨页布局**——左大照片（32px 圆角 + 暖色阴影），右文字（胶囊 Badge → 标题 → 描述）。照片触感悬浮：上移 8px、放大 1.02、阴影加深至 `--shadow-hover`，`transition .5s var(--ease-hover)`。
- 日期信息（如「1 岁 7 个月 · 8 月 28 日」）做成胶囊 Badge：白底、`--clay` 字、`--shadow-badge`、圆角 20px。
- 现有的「最近的新变化」「本月入口」两块保留（B-4 定的三块结构不变），套用同一套 Badge / 圆角 / 进场。

### 2.3 关于张年（About）
- 名片区：肖像裁成**顶部圆拱门（Arch）**形状（`border-radius: 50% 50% 32px 32px / 40% 40% 32px 32px` 或 `clip-path`），或椭圆。
- 时间轴：保留现有结构（B-5 做的「最近的变化 / 档案最近记下的 / 更早的时候」），中轴线**随滚动向下生长 / 绘制**（`IntersectionObserver` + `scaleY` 或 `height` 过渡）。节点卡片用 `--card-soft` 底 + 圆角。

### 2.4 记忆（Memory / 月页）
- 照片流错落有致（瀑布流 / 不等高网格），图片间充裕留白（gap ≥ 24px），所有照片 32px 圆角。
- 滚动唤醒：新的月份卡片 / 照片进入视口时错落 fadeInUp——**图片先，文字延迟 0.1s**（`IntersectionObserver` 加 `.is-visible`）。
- 图片查看：B-2 已做的 `PhotoGallery` 查看器，背景改为**深色 + `backdrop-filter: blur()` 毛玻璃**，过渡平滑。

## 3 · 执行要求（Teddy 原稿）

保留网站原有的所有文本内容、HTML 语义化结构与照片数据，**只重构 CSS、为动效需要的 DOM 嵌套层级、以及 JS 滚动 / 悬浮交互**。先出【全局公共 CSS】+【首页】，Teddy 确认风格后再做后续页面。

## 4 · 落地约束（Cowork 补，Code 必须遵守）

1. **内容规则不变**（原则文档）：页面上的每句话仍只能来自已发布的 life_event / snapshot 文本；主阅读层零计数；照片只用有背书绑定的；某块没材料就整块不渲染，不放「暂无」。皮肤换了，这些一条不松。
2. **Nunito 必须自托管**：站点读者在中国大陆，`fonts.googleapis.com` 会阻塞渲染。把 Nunito 拉丁子集（400/500/800，woff2，约 3×20 KB）放进 `v2/public/fonts/`，`@font-face` + `font-display: swap`。中文仍走 PingFang / 微软雅黑系统字体。
3. **手机优先**：参考稿是桌面布局（64px 内边距、左右跨页）。手机（≤720px）规则：内边距 20px；大标题 `clamp(2.4rem, 11vw, 7vw)`；「最近生活」左右布局改上下叠放（照片在上）；hover 动效在触屏上换成 `:active` 的 `scale(.98)` 反馈；Header 的导航在手机仍用现有底部 nav，样式跟随本规范（圆角、下划线）。
4. **动效有节制**：`prefers-reduced-motion: reduce` 时所有 `animation` / `transition` 归零；`fadeInUp` 只对首屏和进入视口时的元素各触发一次；**不对月末档案的几百张缩略图加 box-shadow / 独立动画**（性能），只对当天代表照片和卡片加。
5. **不引入 UI 库 / 动效库 / lightbox 库**，原生 CSS + `IntersectionObserver` 足够；不引入 Tailwind 类堆砌。
6. **不动**：`v2/lib/organizer/**`、`v2/lib/db/**`、`v2/scripts/**`、`.env`、`docs/nianlife-product-principles.md`、A 轨入箱。

## 5 · 分阶段与验收

### 阶段 9a · 全局 CSS + Header + 首页（做完停下，等 Teddy 确认风格）
验收（Cowork 在浏览器里开真页面，手机和桌面各一次）：
1. 首页第一屏：`#F9F6F0` 底、Nunito/PingFang 字体、7vw 大标题「张年」为鼠尾草绿；标题与日期错落进场可见。
2. 「最近生活」照片 32px 圆角 + 暖阴影；桌面 hover 上浮 8px；手机上下叠放不裁字。
3. 日期胶囊 Badge 白底陶色字。
4. Logo 圆角矩形陶色底；导航下划线从中间展开。
5. 页面上没有直角元素（除文字本身）；没有衬线体。
6. `prefers-reduced-motion` 下无动画；`fonts.googleapis.com` 请求数 = 0。
7. 原有文本一字不变（curl 前后对比正文文本）；无计数、无「暂无」。

### 阶段 9b · 关于张年
拱门肖像；时间轴随滚动绘制；节点卡片米色圆角；每条仍带日期与链接。

### 阶段 9c · 记忆 / 月页 / 事件页
错落照片流 + 滚动唤醒（图先文后 0.1s）；照片 32px 圆角；查看器毛玻璃深底；月页首屏 `<img>` 数不增加、HTML 体积不明显变大（B-3 的成果不能倒退）。

### 阶段 9d · 收口
全站直角扫尾（`<details>`、按钮、Badge）；手机 375px 无横向滚动；重跑原则记分卡（一、二、三、五、七）。
