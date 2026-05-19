"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import styles from "./deck.module.css";

type DeckStageProps = {
  /** ordered slide children — each one rendered as <section class="slide"> */
  children: React.ReactNode[];
  /** href to leave the deck (e.g. back to library) */
  exitHref: string;
  /** authored canvas size */
  width?: number;
  height?: number;
};

/**
 * <DeckStage> — fixed 1920×1080 canvas, transform-scaled to viewport.
 * Keyboard nav (←/→/Space/PgUp/PgDn/Home/End/digits), URL `?slide=N`,
 * fading HUD with slide counter, exit button.
 *
 * Slides are kept mounted (visibility-hidden) so state survives nav.
 */
export function DeckStage({
  children,
  exitHref,
  width = 1920,
  height = 1080,
}: DeckStageProps) {
  const slides = useMemo(
    () => children.filter(Boolean) as React.ReactNode[],
    [children],
  );
  const total = slides.length;

  const router = useRouter();
  const searchParams = useSearchParams();

  const initialIndex = useMemo(() => {
    const raw = searchParams.get("slide");
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) return 0;
    return Math.min(Math.max(n - 1, 0), total - 1);
  }, [searchParams, total]);

  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [hudIdle, setHudIdle] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // sync URL on slide change
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("slide", String(index + 1));
    router.replace(`?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const bumpHud = useCallback(() => {
    setHudIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setHudIdle(true), 1800);
  }, []);

  const goTo = useCallback(
    (n: number) => {
      const next = Math.min(Math.max(n, 0), total - 1);
      setIndex(next);
      bumpHud();
    },
    [total, bumpHud],
  );

  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  // scaling
  useLayoutEffect(() => {
    const recompute = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const s = Math.min(vw / width, vh / height);
      setScale(s);
    };
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [width, height]);

  // keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" ||
          e.target.tagName === "TEXTAREA" ||
          e.target.isContentEditable)
      ) {
        return;
      }
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
          e.preventDefault();
          next();
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          prev();
          break;
        case "Home":
          e.preventDefault();
          goTo(0);
          break;
        case "End":
          e.preventDefault();
          goTo(total - 1);
          break;
        case "Escape":
          // let exit button / link handle it; do nothing
          break;
        default:
          if (/^[0-9]$/.test(e.key)) {
            const digit = Number.parseInt(e.key, 10);
            if (digit === 0) goTo(9);
            else goTo(digit - 1);
          }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, goTo, total]);

  // idle HUD timer
  useEffect(() => {
    const onMove = () => bumpHud();
    bumpHud();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchstart", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchstart", onMove);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [bumpHud]);

  // click-to-advance (right half) / back (left edge)
  const onStageClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = x / rect.width;
      if (ratio < 0.15) prev();
      else if (ratio > 0.55) next();
    },
    [next, prev],
  );

  return (
    <div className={styles.host}>
      <Link href={exitHref} className={styles.exitBtn} aria-label="Sair do deck">
        <X size={14} />
        Fechar
      </Link>

      <div
        ref={wrapRef}
        className={styles.stageWrap}
        style={{ transform: `scale(${scale})` }}
        onClick={onStageClick}
      >
        <div className={styles.slidesLayer}>
          {slides.map((slide, i) => (
            <section
              key={i}
              className={styles.slide}
              data-active={i === index ? "true" : "false"}
              aria-hidden={i === index ? "false" : "true"}
            >
              {slide}
            </section>
          ))}
        </div>
      </div>

      <div className={`${styles.hud} ${hudIdle ? styles.hudIdle : ""}`}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          disabled={index === 0}
          aria-label="Slide anterior"
        >
          ←
        </button>
        <span>
          <span className="num">{String(index + 1).padStart(2, "0")}</span>
          {" / "}
          <span>{String(total).padStart(2, "0")}</span>
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          disabled={index === total - 1}
          aria-label="Próximo slide"
        >
          →
        </button>
        <span className={styles.sep} />
        <span className="hint">← → para navegar</span>
      </div>
    </div>
  );
}

export { styles as deckStyles };
