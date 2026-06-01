"use client"

import * as React from "react"

/**
 * Shared nesting depth for stacked overlays (sheets + dialogs).
 *
 * React context flows through portals, so an overlay opened from within another
 * overlay reads the incremented depth even though its DOM lives at document.body.
 * Each level bumps z-index by 10 over the base (50). Both Sheet and Dialog read
 * this context and wrap their children in a +1 provider, so sheet-on-sheet,
 * dialog-on-sheet, and sheet-on-dialog all stack in open order.
 *
 * Used e.g. for PrdDetailSheet (in-session), whose content opens edit sub-sheets
 * and an approve ConfirmDialog.
 */
export const OverlayDepthContext = React.createContext(0)

export const OVERLAY_BASE_Z = 50
export const OVERLAY_Z_STEP = 10

export function overlayZIndex(depth: number): number {
  return OVERLAY_BASE_Z + depth * OVERLAY_Z_STEP
}
