// Adapted from shadcn/ui new-york-v4 (MIT), retrieved 2026-09-19.
// Local changes: ui: prefix, scoped reset, warm theme, explicit transitions and touch targets.
"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"
import * as DialogPrimitive from "@radix-ui/react-dialog"

import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-nl-ui="" data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-nl-ui="" data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-nl-ui="" data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-nl-ui="" data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-nl-ui="" data-slot="dialog-overlay"
      className={cn(
        "ui:fixed ui:inset-0 ui:z-50 ui:bg-foreground/50",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal data-nl-ui="" data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-nl-ui="" data-slot="dialog-content"
        className={cn(
          "ui:fixed ui:top-[50%] ui:left-[50%] ui:z-50 ui:grid ui:w-full ui:max-w-[calc(100%-2rem)] ui:translate-x-[-50%] ui:translate-y-[-50%] ui:gap-4 ui:rounded-lg ui:border ui:bg-background ui:p-6 ui:shadow-lg ui:duration-200 ui:outline-none ui:sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-nl-ui="" data-slot="dialog-close"
            className="ui:absolute ui:top-2 ui:right-2 ui:inline-flex ui:size-11 ui:items-center ui:justify-center ui:rounded-xs ui:opacity-70 ui:ring-offset-background ui:transition-opacity ui:hover:opacity-100 ui:focus:ring-2 ui:focus:ring-ring ui:focus:ring-offset-2 ui:focus:outline-hidden ui:disabled:pointer-events-none ui:data-[state=open]:bg-accent ui:data-[state=open]:text-muted-foreground ui:[&_svg]:pointer-events-none ui:[&_svg]:shrink-0 ui:[&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon aria-hidden="true" />
            <span className="ui:sr-only">关闭</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-nl-ui="" data-slot="dialog-header"
      className={cn("ui:flex ui:flex-col ui:gap-2 ui:pr-8 ui:text-center ui:sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-nl-ui="" data-slot="dialog-footer"
      className={cn(
        "ui:flex ui:flex-col-reverse ui:gap-2 ui:sm:flex-row ui:sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-nl-ui="" data-slot="dialog-title"
      className={cn("ui:text-lg ui:leading-none ui:font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-nl-ui="" data-slot="dialog-description"
      className={cn("ui:text-sm ui:text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
