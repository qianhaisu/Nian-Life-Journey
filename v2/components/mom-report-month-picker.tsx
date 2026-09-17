"use client";

import { useRouter } from "next/navigation";
import { formatMonth } from "@/lib/time-signature";

// Lists only months that actually have a real 苏静月报 (lib/mom-report-content.ts) — never a demo
// range of the last N months. One entry today reads as one entry, not a disabled placeholder.
export function MomReportMonthPicker({ month, months }: { month: string; months: string[] }) {
  const router = useRouter();
  return <div className="mr-month-picker">
    <label htmlFor="mom-report-month">翻到这一月</label>
    <select
      id="mom-report-month"
      name="month"
      value={month}
      onChange={(event) => router.push(`/mom-reports?month=${event.target.value}`)}
    >
      {months.map((item) => <option key={item} value={item}>{formatMonth(item)}</option>)}
    </select>
    {months.length <= 1 ? <span>其他月份还没有月报</span> : null}
  </div>;
}
