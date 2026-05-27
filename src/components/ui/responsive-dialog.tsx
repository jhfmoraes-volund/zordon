"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"

type RootProps = React.ComponentProps<typeof Dialog>

type ContextValue = {
  isMobile: boolean
}

const ResponsiveDialogContext = React.createContext<ContextValue>({
  isMobile: false,
})

function useResponsiveDialogContext() {
  return React.useContext(ResponsiveDialogContext)
}

function ResponsiveDialog({ children, ...props }: RootProps) {
  const isMobile = useIsMobile()
  const ctx = React.useMemo(() => ({ isMobile }), [isMobile])
  const Root = isMobile ? Sheet : Dialog
  return (
    <ResponsiveDialogContext.Provider value={ctx}>
      <Root {...props}>{children}</Root>
    </ResponsiveDialogContext.Provider>
  )
}

type TriggerProps = React.ComponentProps<typeof DialogTrigger>

function ResponsiveDialogTrigger(props: TriggerProps) {
  const { isMobile } = useResponsiveDialogContext()
  const Trigger = isMobile ? SheetTrigger : DialogTrigger
  return <Trigger {...props} />
}

type ContentProps = React.ComponentProps<typeof DialogContent>

function ResponsiveDialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: ContentProps) {
  const { isMobile } = useResponsiveDialogContext()

  if (isMobile) {
    return (
      <SheetContent
        side="bottom"
        showCloseButton={showCloseButton}
        className={cn(
          "max-h-[90vh] gap-0 overflow-y-auto overscroll-contain rounded-t-xl p-0",
          "flex flex-col",
          className
        )}
        {...(props as React.ComponentProps<typeof SheetContent>)}
      >
        <div
          aria-hidden="true"
          className="mx-auto mt-2 mb-3 h-1.5 w-12 shrink-0 rounded-full bg-muted"
        />
        {children}
      </SheetContent>
    )
  }

  // Desktop: cap dialog at 85vh and let the popup itself scroll. Both Header
  // and Footer are not sticky on desktop (just plain divs), so a single
  // scrollable container is the simplest fit — no nested scroll regions,
  // works the same whether the consumer uses ResponsiveDialogBody or just
  // passes children directly.
  return (
    <DialogContent
      showCloseButton={showCloseButton}
      className={cn(
        "max-h-[85vh] overflow-y-auto overscroll-contain",
        className,
      )}
      {...props}
    >
      {children}
    </DialogContent>
  )
}

type HeaderProps = React.ComponentProps<typeof DialogHeader>

function ResponsiveDialogHeader({ className, ...props }: HeaderProps) {
  const { isMobile } = useResponsiveDialogContext()

  if (isMobile) {
    return (
      <SheetHeader
        className={cn(
          "shrink-0 border-b bg-popover px-4 pt-2 pb-4",
          className
        )}
        {...props}
      />
    )
  }

  return <DialogHeader className={className} {...props} />
}

type FooterProps = React.ComponentProps<typeof DialogFooter>

function ResponsiveDialogFooter({ className, ...props }: FooterProps) {
  const { isMobile } = useResponsiveDialogContext()

  if (isMobile) {
    return (
      <div
        data-slot="responsive-dialog-footer"
        className={cn(
          "sticky bottom-0 mt-auto flex shrink-0 flex-col-reverse gap-2 border-t bg-popover px-4 pt-3 pb-safe sm:flex-row sm:justify-end",
          className
        )}
        {...props}
      />
    )
  }

  return <DialogFooter className={className} {...props} />
}

type TitleProps = React.ComponentProps<typeof DialogTitle>

function ResponsiveDialogTitle(props: TitleProps) {
  const { isMobile } = useResponsiveDialogContext()
  const Title = isMobile ? SheetTitle : DialogTitle
  return <Title {...props} />
}

type DescriptionProps = React.ComponentProps<typeof DialogDescription>

function ResponsiveDialogDescription(props: DescriptionProps) {
  const { isMobile } = useResponsiveDialogContext()
  const Description = isMobile ? SheetDescription : DialogDescription
  return <Description {...props} />
}

/**
 * Optional scrollable body wrapper for use inside ResponsiveDialogContent.
 * In mobile (sheet) it scrolls; in desktop (dialog) it just passes through.
 */
function ResponsiveDialogBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const { isMobile } = useResponsiveDialogContext()

  // The scroll responsibility now lives on ResponsiveDialogContent itself
  // (max-h + overflow-y-auto). Body becomes a layout slot for padding and
  // gap control on mobile, no scroll of its own — avoids nested scroll.
  if (isMobile) {
    return (
      <div
        data-slot="responsive-dialog-body"
        className={cn("px-4 py-4", className)}
        {...props}
      />
    )
  }

  return (
    <div
      data-slot="responsive-dialog-body"
      className={className}
      {...props}
    />
  )
}

export {
  ResponsiveDialog,
  ResponsiveDialogTrigger,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogBody,
}
