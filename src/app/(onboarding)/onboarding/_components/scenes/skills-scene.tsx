"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Layout, Server, Palette, Cog } from "lucide-react";
import { PixelBar, pixelBarLabel } from "@/components/ui/pixel-bar";

type Tower = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  target: number;
  delay: number;
};

const TOWERS: Tower[] = [
  { key: "frontend", label: "Frontend", icon: Layout, target: 82, delay: 0.2 },
  { key: "backend", label: "Backend", icon: Server, target: 64, delay: 0.4 },
  { key: "ux-ui", label: "UX / UI", icon: Palette, target: 47, delay: 0.6 },
  { key: "ops", label: "Ops", icon: Cog, target: 35, delay: 0.8 },
];

const SUBSKILLS = [
  "React / Next.js",
  "TypeScript avançado",
  "Animações & motion",
  "Performance",
];

function useAnimatedScore(target: number, delayMs: number, durationMs = 900) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start = 0;
    const startTimer = setTimeout(() => {
      const tick = (t: number) => {
        if (!start) start = t;
        const elapsed = t - start;
        const pct = Math.min(1, elapsed / durationMs);
        const eased = 1 - Math.pow(1 - pct, 3);
        setValue(Math.round(target * eased));
        if (pct < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      clearTimeout(startTimer);
      cancelAnimationFrame(raf);
    };
  }, [target, delayMs, durationMs]);
  return value;
}

function TowerRow({ tower }: { tower: Tower }) {
  const score = useAnimatedScore(tower.target, tower.delay * 1000);
  const { label: hud, fg } = pixelBarLabel(score);
  const Icon = tower.icon;

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: tower.delay - 0.05, ease: "easeOut" }}
      className="grid items-center gap-3"
      style={{ gridTemplateColumns: "1.25rem 6rem 1fr 3rem 2.5rem" }}
    >
      <Icon className="size-4 shrink-0 text-foreground" />
      <span className="truncate text-sm font-medium">{tower.label}</span>
      <PixelBar score={score} cells={18} height={12} />
      <span
        className="font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-right leading-none"
        style={{ color: fg }}
      >
        {hud}
      </span>
      <span className="font-mono text-base tabular-nums text-right leading-none">
        {score}
      </span>
    </motion.div>
  );
}

export function SkillsScene() {
  return (
    <div className="relative flex h-full w-full items-center justify-center p-4 sm:p-10">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative w-full max-w-md space-y-5">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, ease: "easeOut" }}
          className="flex items-center justify-between"
        >
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Scorecard · você
            </div>
            <div className="mt-1 text-sm font-bold tracking-tight">
              4 torres · 28 subskills
            </div>
          </div>
          <div className="font-mono text-[10px] tracking-wider text-muted-foreground">
            ZRD/v3
          </div>
        </motion.div>

        <div className="rounded-xl border border-border bg-card/80 p-4 shadow-sm">
          <div className="space-y-2.5">
            {TOWERS.map((t) => (
              <TowerRow key={t.key} tower={t} />
            ))}
          </div>
        </div>

        {/* Subskills cloud */}
        <div className="flex flex-wrap gap-1.5">
          {SUBSKILLS.map((s, i) => (
            <motion.span
              key={s}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                type: "spring",
                damping: 14,
                stiffness: 200,
                delay: 1.1 + i * 0.07,
              }}
              className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-medium text-muted-foreground"
            >
              {s}
            </motion.span>
          ))}
        </div>
      </div>
    </div>
  );
}
