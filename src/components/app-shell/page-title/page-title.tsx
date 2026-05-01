"use client";

import { useEffect, type ReactNode } from "react";
import { usePageTitle } from "./page-title-context";

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** When set, a back button to this href appears before the title in the shell header. */
  backHref?: string | null;
};

/**
 * Declares the title shown in the shell header for the current page.
 * Mounting the component sets it; unmounting clears it (next page falls back
 * to its own <PageTitle> or to the route-derived label).
 */
export function PageTitle({ title, subtitle, backHref }: Props) {
  const { set, clear } = usePageTitle();

  useEffect(() => {
    set({
      title,
      subtitle: subtitle ?? null,
      backHref: backHref ?? null,
    });
    return () => clear();
  }, [title, subtitle, backHref, set, clear]);

  return null;
}
