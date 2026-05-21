"use client";

import { cn } from "@/lib/utils";

export type BoardLayoutCols = "single" | "double" | "triple" | "quad";

/**
 * Canonical max-widths per col budget. Shared with StepHeader so the
 * header and the board grid below it stay aligned to the same axis.
 */
export const BOARD_MAX_WIDTH: Record<BoardLayoutCols, string> = {
  single: "max-w-[720px]",
  double: "max-w-[1040px]",
  triple: "max-w-[1280px]",
  quad: "max-w-[1280px]",
};

type BoardLayoutProps = {
  /**
   * Width budget for the step. Maps to a max-width AND to an internal grid
   * (if `stack` is false) sized for that number of columns.
   *
   *   single → max-w-[720px]  (1 board, e.g. hypotheses, brainstorm in list mode)
   *   double → max-w-[1040px] (2 boards, e.g. risks_gaps, persona AS-IS/TO-BE)
   *   triple → max-w-[1280px] (3 boards, e.g. prioritization, brainstorm in grid mode)
   *   quad   → max-w-[1280px] (4 boards, e.g. scope_definition)
   *
   * BoardColumn no longer caps its own width — the wrapper is the single
   * source of truth.
   */
  cols: BoardLayoutCols;
  /**
   * When true, lays out children in a vertical stack instead of a grid.
   * Use for single-column steps that need to render extras (archived
   * section, narrative, footer) below the main board, still respecting the
   * step's max-width.
   */
  stack?: boolean;
  /** Grid/stack gap. Default 6 (1.5rem). */
  gap?: 4 | 6;
  className?: string;
  children: React.ReactNode;
};

const GRID: Record<BoardLayoutCols, string> = {
  single: "grid grid-cols-1",
  double: "grid grid-cols-1 lg:grid-cols-2",
  triple: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
  quad: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
};

export function BoardLayout({
  cols,
  stack = false,
  gap = 6,
  className,
  children,
}: BoardLayoutProps) {
  const gapCls = gap === 4 ? "gap-4" : "gap-6";
  const layoutCls = stack ? "flex flex-col" : GRID[cols];
  return (
    <div
      className={cn(
        "mx-auto w-full",
        BOARD_MAX_WIDTH[cols],
        layoutCls,
        gapCls,
        className,
      )}
    >
      {children}
    </div>
  );
}
