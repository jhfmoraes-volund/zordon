"use client";

import { motion } from "framer-motion";

const BARS = [
  { label: "Seg", h: 0.65, delay: 0.1 },
  { label: "Ter", h: 0.85, delay: 0.18 },
  { label: "Qua", h: 0.95, delay: 0.26 },
  { label: "Qui", h: 0.7, delay: 0.34 },
  { label: "Sex", h: 0.55, delay: 0.42 },
];

export function CapacityScene() {
  return (
    <div className="relative flex h-full w-full items-center justify-center p-10">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/12 blur-3xl"
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative z-10 w-[340px] rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Capacidade
            </div>
            <div className="mt-1 font-display text-3xl font-bold tracking-tight">
              40 <span className="text-base text-muted-foreground">FP/sem</span>
            </div>
          </div>
          <motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", damping: 12, stiffness: 140, delay: 0.55 }}
            className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500"
          >
            +12% vs. média
          </motion.div>
        </div>

        {/* Barras */}
        <div className="mt-6 flex h-32 items-end gap-3">
          {BARS.map((b) => (
            <div key={b.label} className="flex flex-1 flex-col items-center gap-2">
              <div className="relative flex h-full w-full items-end overflow-hidden rounded-md bg-muted">
                <motion.div
                  initial={{ height: "0%" }}
                  animate={{ height: `${b.h * 100}%` }}
                  transition={{
                    delay: b.delay,
                    duration: 0.7,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="w-full rounded-md bg-gradient-to-t from-primary to-primary/60"
                />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {b.label}
              </span>
            </div>
          ))}
        </div>

        {/* Linha de meta */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.7, duration: 0.5, ease: "easeOut" }}
          style={{ originX: 0 }}
          className="mt-4 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent"
        />

        <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Sprint atual</span>
          <span className="font-mono">38 / 40 FP</span>
        </div>
      </motion.div>
    </div>
  );
}
