import type { MonthlyFocusGoal } from "@/lib/types";

export function targetMonthForSnapshot(snapshotMonth: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(snapshotMonth);
  if (!match) throw new Error(`Invalid snapshot month: ${snapshotMonth}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`Invalid snapshot month: ${snapshotMonth}`);
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}`;
}

export function focusGoalsForSnapshot(goals: MonthlyFocusGoal[], snapshotMonth: string) {
  const targetMonth = targetMonthForSnapshot(snapshotMonth);
  return goals.filter((goal) => goal.snapshotMonth === snapshotMonth && goal.targetMonth === targetMonth);
}

export function monthLabel(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return `${Number(match[1])} 年 ${Number(match[2])} 月`;
}
