"use client";

import { useEffect, type ReactNode } from "react";
import { usePageTitle } from "./page-title-context";

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
};

/**
 * Declares the title shown in the shell header for the current page.
 * Mounting the component sets it; unmounting clears it (next page falls back
 * to its own <PageTitle> or to the route-derived label).
 */
export function PageTitle({ title, subtitle }: Props) {
  const { set, clear } = usePageTitle();

  useEffect(() => {
    set({ title, subtitle: subtitle ?? null });
    return () => clear();
  }, [title, subtitle, set, clear]);

  return null;
}
