"use client";

import { motion } from "framer-motion";
import { CalendarRange } from "lucide-react";

const FEATURES = [
  "Sprints fixos de 1 semana",
  "Capacity por pessoa em FP/semana × dedicação",
  "Auto-allocation respeita disponibilidade",
  "Burn em tempo real conforme tasks fecham",
] as const;

export function SprintsStep() {
  return (
    <div className="flex flex-col gap-6">
      <motion.div
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", damping: 12, stiffness: 120, delay: 0.1 }}
        className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary"
      >
        <CalendarRange className="h-3 w-3" />
        Sprints & capacity
      </motion.div>

      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Cadência semanal.
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          Sprint = container da entrega. O Zordon sabe quanto FP cada um
          aguenta na semana e usa isso pra distribuir tasks sem estourar.
        </p>
      </div>

      <ul className="hidden space-y-2 lg:block">
        {FEATURES.map((f, i) => (
          <motion.li
            key={f}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.25 + i * 0.07, ease: "easeOut" }}
            className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/60 p-3"
          >
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="text-sm">{f}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
