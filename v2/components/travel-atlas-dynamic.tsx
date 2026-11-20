"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { TravelAtlas as TravelAtlasComponent } from "@/components/travel-atlas";

const DynamicTravelAtlas = dynamic(() =>
  import("@/components/travel-atlas").then((mod) => mod.TravelAtlas),
);

export function TravelAtlas(props: ComponentProps<typeof TravelAtlasComponent>) {
  return <DynamicTravelAtlas {...props} />;
}
