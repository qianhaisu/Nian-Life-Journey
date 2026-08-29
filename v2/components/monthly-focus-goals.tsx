import type { MonthlyFocusGoal, MonthlyFocusGoalCategory, MonthlyFocusGoalStatus } from "@/lib/types";
import { monthLabel } from "@/lib/monthly-focus";

const categoryLabels: Partial<Record<MonthlyFocusGoalCategory, string>> = {
  sleep: "睡眠",
  language: "语言",
  reading: "阅读",
  health: "健康观察",
};

const statusLabels: Record<MonthlyFocusGoalStatus, string> = {
  watching: "关注中",
  progress: "有新进展",
  completed: "已留存",
  deferred: "延后观察",
};

function categoryLabel(category: MonthlyFocusGoalCategory) {
  return categoryLabels[category] ?? category;
}

export function MonthlyFocusGoals({ goals, snapshotMonth, variant = "home" }: { goals: MonthlyFocusGoal[]; snapshotMonth: string; variant?: "home" | "review" }) {
  if (!goals.length) return null;
  const targetMonth = goals[0]?.targetMonth ?? "";
  return <section className={`monthly-focus monthly-focus--${variant} ${variant === "home" ? "reading-wrap" : ""}`} aria-labelledby={`monthly-focus-title-${variant}`}>
    <div className="monthly-focus-heading">
      <div>
        <span className="section-mark">为 {monthLabel(targetMonth)} 留下</span>
        <h2 id={`monthly-focus-title-${variant}`} className="serif">下个月，我们想关注这些</h2>
      </div>
      <p>不是要完成的任务，只是接下来一个月，值得慢慢留意和记下的变化。</p>
    </div>
    <ol className="monthly-focus-list">
      {goals.map((goal) => <li key={goal.id} className={`monthly-focus-item monthly-focus-item--${goal.category}`}>
        <div className="monthly-focus-meta"><span>{categoryLabel(goal.category)}</span><small>{statusLabels[goal.status]}</small></div>
        <h3 className="serif">{goal.title}</h3>
        <p>{goal.description}</p>
      </li>)}
    </ol>
    {variant === "review" ? <p className="monthly-focus-origin">这些关注是在 {monthLabel(snapshotMonth)} 留下的。</p> : null}
  </section>;
}
