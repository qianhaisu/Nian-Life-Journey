"use client";

import { useEffect } from "react";

// 习惯提醒的露出上报，触发条件是**真的被看见**：
//
//   1. 那块提醒进了可见视口（IntersectionObserver，至少一半露出来）；
//   2. 页面在前台（`visibilityState === "visible"`）——后台标签页里「渲染过」不算看见；
//   3. 它在默认提醒位上。折叠在「还记着的其他事」里的根本不带 data-habit-id，
//      而且 `<details>` 关着时里面是 display:none，观察器也不会触发——两道都挡。
//
// 为什么不放在服务端渲染里：一次 GET 不等于一次露出，而配额只有两个自然日（§6.3）。
// 预热、健康检查、截图脚本都会发 GET；记错一次，这条提醒家人一次都没看见就再也看不到了。
//
// 一次页面加载里每条最多报一次；同一天报多次由数据库唯一键去重（占的是「日」不是「次」）。
//
// 关掉上报：地址后面加 `?habitReport=off`（会记住），`?habitReport=on` 恢复。
// 验收/截图用的浏览器必须显式关掉——那些会话在测量，不是在呈现。
const DISABLE_KEY = "nian-habit-report";
const ENDPOINT = "/api/internal/habit-shown";

function reportingDisabled(): boolean {
  try {
    const asked = new URLSearchParams(window.location.search).get("habitReport");
    if (asked === "off") { window.localStorage.setItem(DISABLE_KEY, "off"); return true; }
    if (asked === "on") { window.localStorage.removeItem(DISABLE_KEY); return false; }
    return window.localStorage.getItem(DISABLE_KEY) === "off";
  } catch {
    // 隐私模式下 localStorage 会抛。读不到开关就按「开着」走，和没有这条开关时一样。
    return false;
  }
}

export function HabitShownReporter({ ids }: { ids: string[] }) {
  useEffect(() => {
    if (ids.length === 0 || reportingDisabled()) return;
    const eligible = new Set(ids);
    const reported = new Set<string>();
    const waiting = new Set<string>();

    const flush = () => {
      // 前台才算看见。页面在后台时先攒着，等它回到前台再报。
      if (document.visibilityState !== "visible") return;
      const batch = [...waiting].filter((id) => !reported.has(id));
      waiting.clear();
      if (batch.length === 0) return;
      for (const id of batch) reported.add(id);
      // keepalive：家人读完就关掉标签页时，这次上报仍然发得出去。
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: batch }),
        keepalive: true,
      }).catch(() => { /* 记不上一行日志，不该影响家人看页面 */ });
    };

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.habitId;
        if (!id || !eligible.has(id) || reported.has(id)) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) waiting.add(id);
      }
      flush();
    }, { threshold: [0.5] });

    // 只观察默认位上的那几块：折叠层里的元素不带这个属性，这里也不去找它。
    document.querySelectorAll<HTMLElement>(".home-reminders > .home-reminder [data-habit-id]").forEach((node) => observer.observe(node));
    document.addEventListener("visibilitychange", flush);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", flush);
    };
  }, [ids]);

  return null;
}
