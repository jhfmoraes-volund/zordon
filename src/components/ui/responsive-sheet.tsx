"use client"

import * as React from "react"
import { Maximize2, Minimize2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
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
 *          `expandable` adiciona o toggle de tela cheia (estilo Notion):
 *          o sheet vira página inteira com coluna de leitura centralizada.
 * Mobile:  bottom sheet, 90dvh, drag handle, scroll inside body.
 *
 * Use for: editing/creating a rich item that lives in a list (story, task,
 * project, design session). For 1-3 field decisions use `ResponsiveDialog`.
 */

type RootProps = React.ComponentProps<typeof Sheet>

type ContextValue = {
  isMobile: boolean
  /** Tela cheia (desktop + `expandable`). Sempre false no mobile. */
  expanded: boolean
}

const ResponsiveSheetContext = React.createContext<ContextValue>({
  isMobile: false,
  expanded: false,
})

function useResponsiveSheetContext() {
  return React.useContext(ResponsiveSheetContext)
}

/**
 * Modo tela cheia ativo? Pra conteúdo que quer aproveitar a largura extra
 * (ex: timeline de sprints rica no drawer de projetos).
 */
function useResponsiveSheetExpanded(): boolean {
  return React.useContext(ResponsiveSheetContext).expanded
}

function ResponsiveSheet({ children, ...props }: RootProps) {
  const isMobile = useIsMobile()
  const ctx = React.useMemo(() => ({ isMobile, expanded: false }), [isMobile])
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

type Size = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl"

const SIZE_CLASS: Record<Size, string> = {
  sm: "sm:max-w-[480px]",
  md: "sm:max-w-[640px]",
  lg: "sm:max-w-[760px]",
  xl: "sm:max-w-[1024px]",
  "2xl": "sm:max-w-[1280px]",
  "3xl": "sm:max-w-[1520px]",
}

type Side = "left" | "right"

/**
 * Gutter do modo expandido — centraliza uma coluna de leitura de 920px com
 * respiro mínimo de 2.5rem. Padding em vez de wrapper interno pra não quebrar
 * `space-y-*`/`gap-*` que os consumers aplicam direto no Header/Body.
 */
const EXPANDED_GUTTER = "px-[max(2.5rem,calc((100%-920px)/2))]"

type ContentProps = React.ComponentProps<typeof SheetContent> & {
  /** Desktop max-width preset. Default: md (640px). */
  size?: Size
  /** Desktop side anchor. Mobile is always bottom. Default: right. */
  desktopSide?: Side
  /** Liga o toggle de tela cheia no desktop (estilo Notion). Default: false. */
  expandable?: boolean
}

function ResponsiveSheetContent({
  className,
  children,
  size = "md",
  desktopSide = "right",
  showCloseButton = true,
  expandable = false,
  ...props
}: ContentProps) {
  const { isMobile } = useResponsiveSheetContext()
  // Vive no Content: fecha o sheet (unmount) → volta pra largura padrão.
  const [expanded, setExpanded] = React.useState(false)
  const isExpanded = !isMobile && expandable && expanded
  const ctx = React.useMemo(
    () => ({ isMobile, expanded: isExpanded }),
    [isMobile, isExpanded],
  )

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
      side={desktopSide}
      showCloseButton={showCloseButton}
      className={cn(
        "w-full gap-0 p-0",
        "flex flex-col",
        isExpanded
          ? "data-[side=left]:w-full data-[side=right]:w-full sm:max-w-[100vw]"
          : SIZE_CLASS[size],
        // Anima a largura sem perder o enter/exit (opacity + translate).
        expandable && "transition-[opacity,translate,width,max-width]",
        className,
      )}
      {...props}
    >
      <ResponsiveSheetContext.Provider value={ctx}>
        {children}
      </ResponsiveSheetContext.Provider>
      {expandable && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setExpanded((v) => !v)}
          aria-label={isExpanded ? "Restaurar largura padrão" : "Expandir pra tela cheia"}
          title={isExpanded ? "Restaurar" : "Expandir"}
          className={cn(
            "absolute top-3 text-muted-foreground",
            showCloseButton ? "right-11" : "right-3",
          )}
        >
          {isExpanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
      )}
    </SheetContent>
  )
}

type HeaderProps = React.ComponentProps<typeof SheetHeader>

function ResponsiveSheetHeader({ className, ...props }: HeaderProps) {
  const { isMobile, expanded } = useResponsiveSheetContext()
  return (
    <SheetHeader
      className={cn(
        "shrink-0 border-b bg-popover",
        isMobile
          ? "px-4 pt-2 pb-3"
          : expanded
            ? cn(EXPANDED_GUTTER, "py-5")
            : "px-6 py-4",
        className,
      )}
      {...props}
    />
  )
}

type FooterProps = React.ComponentProps<"div">

function ResponsiveSheetFooter({ className, ...props }: FooterProps) {
  const { isMobile, expanded } = useResponsiveSheetContext()
  return (
    <div
      data-slot="responsive-sheet-footer"
      className={cn(
        "sticky bottom-0 flex shrink-0 flex-col-reverse gap-2 border-t bg-popover sm:flex-row sm:justify-end",
        isMobile
          ? "px-4 pt-3 pb-safe"
          : expanded
            ? cn(EXPANDED_GUTTER, "py-4")
            : "px-6 py-4",
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
  const { isMobile, expanded } = useResponsiveSheetContext()
  return (
    <div
      data-slot="responsive-sheet-body"
      className={cn(
        "flex-1 overflow-y-auto",
        isMobile
          ? "px-4 py-4"
          : expanded
            ? cn(EXPANDED_GUTTER, "py-8")
            : "px-6 py-4",
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
  useResponsiveSheetExpanded,
}
