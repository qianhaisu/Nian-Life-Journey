"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { WeekendPlanView as WeekendPlanViewComponent } from "@/components/weekend-plan-view";

const DynamicWeekendPlanView = dynamic(() =>
  import("@/components/weekend-plan-view").then((mod) => mod.WeekendPlanView),
);

export function WeekendPlanView(props: ComponentProps<typeof WeekendPlanViewComponent>) {
  return <DynamicWeekendPlanView {...props} />;
}
