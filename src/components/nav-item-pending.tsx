"use client";

import { useLinkStatus } from "next/link";

/**
 * Tiny dot rendered inside a <Link> that pulses while navigation is pending.
 * Uses a 100ms animation delay so fast navigations never flash.
 */
export function NavItemPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span
      aria-hidden
      className="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse opacity-0"
      style={{ animationDelay: "100ms", animationFillMode: "forwards" }}
    />
  );
}
