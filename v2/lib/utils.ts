import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Tailwind 4 prefixes precede variants: ui:hover:bg-primary.
const merge = extendTailwindMerge({ prefix: "ui" });

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
