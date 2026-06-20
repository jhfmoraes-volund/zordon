"use client";

import { motion } from "framer-motion";
import {
  Sparkles,
  KanbanSquare,
  CalendarRange,
  Target,
  Bot,
} from "lucide-react";

const PILLARS = [
  { icon: KanbanSquare, label: "Tasks com PFV, status e owner" },
  { icon: CalendarRange, label: "Sprints semanais com capacity" },
  { icon: Target, label: "Skills, PDI e ciclos de evolução" },
  { icon: Bot, label: "Vitor e Alpha — agentes que ajudam" },
] as const;

export function WelcomeStep({ memberName }: { memberName: string }) {
  const firstName = memberName.split(" ")[0] ?? memberName;

  return (
    <div className="flex flex-col gap-6">
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", damping: 12, stiffness: 120, delay: 0.1 }}
        className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary"
      >
        <Sparkles className="h-3 w-3" />
        Bem-vindo
      </motion.div>

      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Olá, {firstName}.
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          Esse é o <span className="font-semibold text-foreground">Zordon</span>
          {" "}— o sistema interno que orquestra squads, sprints, evolução
          técnica e os agentes que tocam a operação. Um tour rápido pra você
          ver o que tem por aqui.
        </p>
      </div>

      <ul className="hidden space-y-2 lg:block">
        {PILLARS.map((p, i) => (
          <motion.li
            key={p.label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.25 + i * 0.08, ease: "easeOut" }}
            className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2.5"
          >
            <div className="rounded-md bg-primary/10 p-1.5 text-primary">
              <p.icon className="size-4" />
            </div>
            <span className="text-sm">{p.label}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
