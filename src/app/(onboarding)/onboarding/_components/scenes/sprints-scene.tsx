"use client";

import { motion } from "framer-motion";

const MEMBERS = [
  { name: "Marina", position: "Frontend", used: 32, capacity: 40, delay: 0.2 },
  { name: "Caio", position: "Backend", used: 28, capacity: 36, delay: 0.32 },
  { name: "Lia", position: "Fullstack", used: 18, capacity: 32, delay: 0.44 },
];

export function SprintsScene() {
  const totalUsed = MEMBERS.reduce((s, m) => s + m.used, 0);
  const totalCap = MEMBERS.reduce((s, m) => s + m.capacity, 0);
  const totalPct = Math.round((totalUsed / totalCap) * 100);

  return (
    <div className="relative flex h-full w-full items-center justify-center p-4 sm:p-10">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative w-full max-w-md space-y-4">
        {/* Sprint header card */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, ease: "easeOut" }}
          className="rounded-xl border border-border bg-card p-4 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Sprint 12
              </div>
              <div className="mt-1 text-sm font-bold tracking-tight">
                28 abr → 4 mai
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-2xl font-bold tabular-nums">
                {totalUsed}
                <span className="text-sm text-muted-foreground">/{totalCap}</span>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                FP alocados
              </div>
            </div>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${totalPct}%` }}
              transition={{ delay: 0.7, duration: 0.9, ease: "easeOut" }}
              className="h-full rounded-full bg-gradient-to-r from-primary to-primary/60"
            />
          </div>
        </motion.div>

        {/* Members capacity */}
        <div className="space-y-2.5">
          {MEMBERS.map((m) => {
            const pct = (m.used / m.capacity) * 100;
            return (
              <motion.div
                key={m.name}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: m.delay, ease: "easeOut" }}
                className="rounded-lg border border-border bg-card/80 p-3"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="flex size-6 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] font-bold text-primary">
                      {m.name[0]}
                    </div>
                    <span className="font-medium">{m.name}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {m.position}
                    </span>
                  </div>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {m.used}/{m.capacity} FP
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{
                      delay: m.delay + 0.15,
                      duration: 0.7,
                      ease: "easeOut",
                    }}
                    className={`h-full rounded-full ${
                      pct > 90
                        ? "bg-red-500"
                        : pct > 70
                        ? "bg-amber-500"
                        : "bg-primary"
                    }`}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
