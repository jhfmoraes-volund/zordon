"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Circle, Clock } from "lucide-react";

type Action = {
  id: string;
  title: string;
  tower: string;
  due: string;
  status: "done" | "doing" | "todo";
  delay: number;
};

const ACTIONS: Action[] = [
  {
    id: "a1",
    title: "Estudar Server Components em produção",
    tower: "Frontend",
    due: "5 mai",
    status: "done",
    delay: 0.25,
  },
  {
    id: "a2",
    title: "Pair com Caio em arquitetura de RLS",
    tower: "Backend",
    due: "12 mai",
    status: "doing",
    delay: 0.4,
  },
  {
    id: "a3",
    title: "Curso Refactoring UI — capítulos 1-4",
    tower: "UX / UI",
    due: "26 mai",
    status: "todo",
    delay: 0.55,
  },
];

const STATUS_VISUAL: Record<
  Action["status"],
  { icon: typeof Check; cls: string; label: string }
> = {
  done: { icon: Check, cls: "text-green-500 bg-green-500/15", label: "Concluído" },
  doing: { icon: Clock, cls: "text-amber-500 bg-amber-500/15", label: "Em andamento" },
  todo: { icon: Circle, cls: "text-muted-foreground bg-muted", label: "A fazer" },
};

function ActionCard({ action }: { action: Action }) {
  const [bounced, setBounced] = useState(false);
  const visual = STATUS_VISUAL[action.status];
  const Icon = visual.icon;

  // Bounce the checkmark on done items pra dar a sensação de "concluiu agora"
  useEffect(() => {
    if (action.status !== "done") return;
    const t = setTimeout(() => setBounced(true), (action.delay + 0.6) * 1000);
    return () => clearTimeout(t);
  }, [action.delay, action.status]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: action.delay, ease: "easeOut" }}
      className="rounded-lg border border-border bg-card p-3 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <motion.div
          animate={
            bounced
              ? { scale: [1, 1.25, 1], rotate: [0, 8, 0] }
              : { scale: 1, rotate: 0 }
          }
          transition={{ duration: 0.4, ease: "easeOut" }}
          className={`mt-0.5 flex size-6 items-center justify-center rounded-full ${visual.cls}`}
        >
          <Icon className="size-3.5" strokeWidth={3} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {action.tower} · vence {action.due}
          </div>
          <div
            className={`mt-0.5 text-sm font-medium leading-tight ${
              action.status === "done"
                ? "text-muted-foreground line-through"
                : "text-foreground"
            }`}
          >
            {action.title}
          </div>
        </div>
        <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          {visual.label}
        </span>
      </div>
    </motion.div>
  );
}

export function PdiScene() {
  const total = ACTIONS.length;
  const done = ACTIONS.filter((a) => a.status === "done").length;
  const pct = Math.round((done / total) * 100);

  return (
    <div className="relative flex h-full w-full items-center justify-center p-4 sm:p-10">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative w-full max-w-md space-y-4">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, ease: "easeOut" }}
          className="rounded-xl border border-border bg-card p-4 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Ciclo PDI · Q2 2026
              </div>
              <div className="mt-1 text-sm font-bold tracking-tight">
                3 ações · até 31 mai
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-2xl font-bold tabular-nums">
                {done}
                <span className="text-sm text-muted-foreground">/{total}</span>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                concluídas
              </div>
            </div>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ delay: 0.9, duration: 0.8, ease: "easeOut" }}
              className="h-full rounded-full bg-gradient-to-r from-primary to-primary/60"
            />
          </div>
        </motion.div>

        <div className="space-y-2.5">
          {ACTIONS.map((a) => (
            <ActionCard key={a.id} action={a} />
          ))}
        </div>
      </div>
    </div>
  );
}
