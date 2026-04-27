"use client";

import { motion } from "framer-motion";

const SQUADS = [
  { label: "Squad Alpha", color: "from-rose-500/30 to-orange-500/20", angle: -18 },
  { label: "Squad Beta", color: "from-violet-500/30 to-fuchsia-500/20", angle: 6 },
  { label: "Squad Gamma", color: "from-emerald-500/30 to-cyan-500/20", angle: 24 },
];

export function WelcomeScene() {
  return (
    <div className="relative flex h-full w-full items-center justify-center p-10">
      {/* Backdrop blur radial */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-3xl"
      />

      {/* Fan de cards de squad */}
      <div className="relative h-[360px] w-[360px]">
        {SQUADS.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 40, scale: 0.85, rotate: 0 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotate: s.angle }}
            transition={{
              type: "spring",
              damping: 14,
              stiffness: 120,
              delay: 0.15 + i * 0.1,
            }}
            className="absolute left-1/2 top-1/2 -ml-[110px] -mt-[140px] h-[280px] w-[220px] origin-bottom"
            style={{ zIndex: i }}
          >
            <div
              className={`h-full w-full rounded-2xl border border-border bg-gradient-to-br ${s.color} p-5 shadow-xl backdrop-blur-sm`}
            >
              <div className="flex h-full flex-col">
                <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/70">
                  Squad
                </div>
                <div className="mt-1 text-lg font-bold tracking-tight">
                  {s.label}
                </div>
                <div className="mt-auto space-y-1.5">
                  <div className="h-1.5 w-3/4 rounded-full bg-foreground/20" />
                  <div className="h-1.5 w-1/2 rounded-full bg-foreground/10" />
                </div>
              </div>
            </div>
          </motion.div>
        ))}

        {/* Badge "AgentOps" no centro */}
        <motion.div
          initial={{ scale: 0, rotate: -180, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{
            type: "spring",
            damping: 12,
            stiffness: 100,
            delay: 0.6,
          }}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          <div className="flex size-20 items-center justify-center rounded-full border border-primary/30 bg-background/80 shadow-2xl backdrop-blur">
            <span className="font-display text-xl font-bold tracking-tight">
              ops
            </span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
