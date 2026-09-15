import type { HomeReminderState } from "@/lib/home-feed";

// PAGE-0915-FULL-REMEDIATION-R1 A2：首页不重复印状态机词。`whenText`（deadlineLabel）没有期限时
// 本来就写着「时间待确认」——数据轨已经定好、专门为"不生成一个日期"设计的自然说法。再在后面加一个
// HOME_REMINDER_LABEL 的「待核实」/「待定」，等于同一件事在首页说了两遍，第二遍还更像一个状态
// 徽标而不是一句话。这两档因此跟 active 一样，在首页不显示 statusLabel。
//
// HOME_REMINDER_LABEL（lib/home-feed.ts）本身不改——那是数据轨给的文案表，完整待办清单
// （components/upcoming-tasks.tsx）等别处仍然照常用它；这里只决定首页这一处"要不要再念一遍"。
//
// 独立成这个文件，不放进 app/page.tsx：那边顶部 `import "./home.css"` 会让直接引用它的测试
// 连带把一份 CSS 当 JS 解析报错——纯逻辑判断放这里，两边都干净。
export const HOME_QUIET_STATES = new Set<HomeReminderState>(["active", "needs_confirmation", "tentative"]);
