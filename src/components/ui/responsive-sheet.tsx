"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

/**
 * ResponsiveSheet — long-form detail panel container.
 *
 * Desktop: right-anchored sheet that keeps the underlying list visible.
 * Mobile:  bottom sheet, 90dvh, drag handle, scroll inside body.
 *
 * Use for: editing/creating a rich item that lives in a list (story, task,
 * project, design session). For 1-3 field decisions use `ResponsiveDialog`.
 */

type RootProps = React.ComponentProps<typeof Sheet>

type ContextValue = {
  isMobile: boolean
}

const ResponsiveSheetContext = React.createContext<ContextValue>({
  isMobile: false,
})

function useResponsiveSheetContext() {
  return React.useContext(ResponsiveSheetContext)
}

function ResponsiveSheet({ children, ...props }: RootProps) {
  const isMobile = useIsMobile()
  const ctx = React.useMemo(() => ({ isMobile }), [isMobile])
  return (
    <ResponsiveSheetContext.Provider value={ctx}>
      <Sheet {...props}>{children}</Sheet>
    </ResponsiveSheetContext.Provider>
  )
}

type TriggerProps = React.ComponentProps<typeof SheetTrigger>

function ResponsiveSheetTrigger(props: TriggerProps) {
  return <SheetTrigger {...props} />
}

type Size = "sm" | "md" | "lg"

const SIZE_CLASS: Record<Size, string> = {
  sm: "sm:max-w-[480px]",
  md: "sm:max-w-[640px]",
  lg: "sm:max-w-[760px]",
}

type ContentProps = React.ComponentProps<typeof SheetContent> & {
  /** Desktop max-width preset. Default: md (640px). */
  size?: Size
}

function ResponsiveSheetContent({
  className,
  children,
  size = "md",
  showCloseButton = true,
  ...props
}: ContentProps) {
  const { isMobile } = useResponsiveSheetContext()

  if (isMobile) {
    return (
      <SheetContent
        side="bottom"
        showCloseButton={showCloseButton}
        className={cn(
          "h-[90dvh] max-h-[90dvh] gap-0 rounded-t-xl p-0",
          "flex flex-col",
          className,
        )}
        {...props}
      >
        <div
          aria-hidden="true"
          className="mx-auto mt-2 mb-1 h-1.5 w-12 shrink-0 rounded-full bg-muted"
        />
        {children}
      </SheetContent>
    )
  }

  return (
    <SheetContent
      side="right"
      showCloseButton={showCloseButton}
      className={cn(
        "w-full gap-0 p-0",
        "flex flex-col",
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      {children}
    </SheetContent>
  )
}

type HeaderProps = React.ComponentProps<typeof SheetHeader>

function ResponsiveSheetHeader({ className, ...props }: HeaderProps) {
  const { isMobile } = useResponsiveSheetContext()
  return (
    <SheetHeader
      className={cn(
        "shrink-0 border-b bg-popover",
        isMobile ? "px-4 pt-2 pb-3" : "px-6 py-4",
        className,
      )}
      {...props}
    />
  )
}

type FooterProps = React.ComponentProps<"div">

function ResponsiveSheetFooter({ className, ...props }: FooterProps) {
  const { isMobile } = useResponsiveSheetContext()
  return (
    <div
      data-slot="responsive-sheet-footer"
      className={cn(
        "sticky bottom-0 flex shrink-0 flex-col-reverse gap-2 border-t bg-popover sm:flex-row sm:justify-end",
        isMobile ? "px-4 pt-3 pb-safe" : "px-6 py-4",
        className,
      )}
      {...props}
    />
  )
}

type TitleProps = React.ComponentProps<typeof SheetTitle>

function ResponsiveSheetTitle(props: TitleProps) {
  return <SheetTitle {...props} />
}

type DescriptionProps = React.ComponentProps<typeof SheetDescription>

function ResponsiveSheetDescription(props: DescriptionProps) {
  return <SheetDescription {...props} />
}

/**
 * Scrollable body wrapper. Always `flex-1 overflow-y-auto`.
 */
function ResponsiveSheetBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { isMobile } = useResponsiveSheetContext()
  return (
    <div
      data-slot="responsive-sheet-body"
      className={cn(
        "flex-1 overflow-y-auto",
        isMobile ? "px-4 py-4" : "px-6 py-4",
        className,
      )}
      {...props}
    />
  )
}

export {
  ResponsiveSheet,
  ResponsiveSheetTrigger,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetFooter,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
  ResponsiveSheetBody,
}
