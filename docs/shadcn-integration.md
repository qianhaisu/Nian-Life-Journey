# shadcn/ui 接入

2026-09-19：Teddy 授权 Codex 直接实现并发布，优先避开妈妈月报。

## 使用

V2 使用 shadcn/ui 官方 new-york-v4 组件源码（MIT，许可随组件保留），配合现有 Tailwind 4 / React 19。组件位于 `v2/components/ui`：Button、Card、Input、Label、Dialog。按文件直接导入，避免创建组件总入口。

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

<Label htmlFor="name">称呼</Label>
<Input id="name" name="name" autoComplete="name" />
<Button type="submit">保存</Button>
```

Dialog 使用 Radix 的键盘、焦点约束与焦点返回能力；必须提供 DialogTitle 与 DialogDescription（没有说明时显式处理 aria-describedby）。默认关闭按钮中文可访问名为“关闭”。默认 Button、Input 点击高度至少 44px。

首页仅将“换一段”按钮接入 Button，保留原 memory-switch 样式和业务逻辑。妈妈月报组件、CSS、内容和数据路径均未修改。

## 样式共存约定

- 配置入口为 `v2/components.json`，样式入口为 `v2/app/shadcn.css`。
- Tailwind 前缀是 `ui`，语法为 `ui:px-6`、`ui:hover:bg-primary`；`cn()` 已配置相同前缀。额外工具类必须带前缀，现有页面类名不变。
- 不引入全局 Preflight；基础重置只匹配组件的 `data-nl-ui` 属性，因此 Portal 内也有效。
- 不声明无前缀的 shadcn `--muted`、`--color-*` 等变量。Tailwind 主题带 `--ui-` 前缀，引用现有暖色变量；不得把月报和既有页面的文字色变量改成 shadcn 背景色。
- 工具类不放在 CSS layer 内，以便覆盖旧的无 layer 元素规则；重置使用低优先级 `:where`。加入组件时必须实际检查边框、颜色、字体、焦点和 Portal。
- 原版默认 transition-all 已改为明确属性；未引入暗色主题。尊重减少动态效果设置。
- 此次接入不修改全站字重、圆角或品牌色，不批量转换既有页面。

## 新增组件

在 `v2` 中可用官方 CLI `npx shadcn@latest add <组件名>`，使用现有配置；先看差异，不对已定制组件使用 overwrite。CLI 生成后要补 `data-nl-ui` 标记、复用 `@/lib/utils`、使用独立 Radix 包，并检查 `ui:` 前缀和主题变量，不能直接写入上游默认全局主题。

官方参考：[Next.js 接入](https://ui.shadcn.com/docs/installation/next)、[手动接入](https://ui.shadcn.com/docs/installation/manual)、[关闭全局 Preflight](https://tailwindcss.com/docs/preflight)。

## 验证

`npm run test:ui` 用无私人数据的本地浏览器夹具覆盖手机/桌面：旧月报布局和样式不变、暖色按钮、前缀类合并、Input/Label 关联、禁用态、可见键盘焦点、Dialog 视口适配/焦点约束/Escape/焦点返回。无需访问数据库或启动应用服务器。

发布前还执行 typecheck、lint、全量测试和生产构建；发布记录另列生产 SHA、回滚点及真实页面前后对比。
