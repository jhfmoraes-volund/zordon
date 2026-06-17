"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePageTitle } from "./page-title-context";

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** When set, a back button to this href appears before the title in the shell header. */
  backHref?: string | null;
  /**
   * When true, the title stays suppressed in the shell header while this page's
   * hero is on screen, and fades in only after the hero scrolls out of view.
   * The component renders a 0-size sentinel anchored to the bottom of its nearest
   * positioned ancestor — render <PageTitle> as the LAST child of a `relative`
   * hero. Avoids showing the project name twice at the top (notably on mobile,
   * where the sticky header and the hero stack vertically).
   */
  revealOnScroll?: boolean;
};

// Aproxima a altura do ShellHeader (h-12 mobile / md:h-14). O reveal não precisa
// ser pixel-perfect — é só o ponto em que o hero passa por baixo do header sticky.
const HEADER_OFFSET = 56;

/**
 * Declares the title shown in the shell header for the current page.
 * Mounting the component sets it; unmounting clears it (next page falls back
 * to its own <PageTitle> or to the route-derived label).
 */
export function PageTitle({ title, subtitle, backHref, revealOnScroll }: Props) {
  const { set, clear, setHidden } = usePageTitle();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    set({
      title,
      subtitle: subtitle ?? null,
      backHref: backHref ?? null,
    });
    return () => clear();
  }, [title, subtitle, backHref, set, clear]);

  useEffect(() => {
    if (!revealOnScroll) {
      setHidden(false);
      return;
    }
    const el = sentinelRef.current;
    if (!el) return;
    // Começa escondido: ao montar, o hero está visível no topo.
    setHidden(true);
    const observer = new IntersectionObserver(
      ([entry]) => setHidden(entry.isIntersecting),
      { rootMargin: `-${HEADER_OFFSET}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      setHidden(false);
    };
  }, [revealOnScroll, setHidden]);

  if (revealOnScroll) {
    // Absolute + bottom-0: ancora no rodapé do hero sem ocupar espaço no fluxo.
    return (
      <div
        ref={sentinelRef}
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 h-px w-px"
      />
    );
  }
  return null;
}
