// Adapted from shadcn/ui new-york-v4 (MIT), retrieved 2026-09-19.
// Local changes: ui: prefix, scoped reset, warm theme, explicit transitions and touch targets.
import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-nl-ui="" data-slot="input"
      className={cn(
        "ui:min-h-11 ui:w-full ui:min-w-0 ui:rounded-md ui:border ui:border-input ui:bg-transparent ui:px-3 ui:py-1 ui:text-base ui:shadow-xs ui:transition-[color,box-shadow] ui:outline-none ui:selection:bg-primary ui:selection:text-primary-foreground ui:file:inline-flex ui:file:h-7 ui:file:border-0 ui:file:bg-transparent ui:file:text-sm ui:file:font-medium ui:file:text-foreground ui:placeholder:text-muted-foreground ui:disabled:pointer-events-none ui:disabled:cursor-not-allowed ui:disabled:opacity-50 ",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
