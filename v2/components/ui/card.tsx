// Adapted from shadcn/ui new-york-v4 (MIT), retrieved 2026-09-19.
// Local changes: ui: prefix, scoped reset, warm theme, explicit transitions and touch targets.
import * as React from "react"
import { cn } from "@/lib/utils"

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-nl-ui="" data-slot="card"
      className={cn(
        "ui:flex ui:flex-col ui:gap-6 ui:rounded-xl ui:border ui:bg-card ui:py-6 ui:text-card-foreground ui:shadow-sm",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-nl-ui="" data-slot="card-header"
      className={cn(
        "ui:@container/card-header ui:grid ui:auto-rows-min ui:grid-rows-[auto_auto] ui:items-start ui:gap-2 ui:px-6 ui:has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-nl-ui="" data-slot="card-title"
      className={cn("ui:leading-none ui:font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-nl-ui="" data-slot="card-description"
      className={cn("ui:text-sm ui:text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-nl-ui="" data-slot="card-action"
      className={cn(
        "ui:col-start-2 ui:row-span-2 ui:row-start-1 ui:self-start ui:justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-nl-ui="" data-slot="card-content"
      className={cn("ui:px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-nl-ui="" data-slot="card-footer"
      className={cn("ui:flex ui:items-center ui:px-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
