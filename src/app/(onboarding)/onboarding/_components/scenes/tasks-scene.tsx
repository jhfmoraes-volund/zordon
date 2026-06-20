"use client";

import { motion } from "framer-motion";

type Card = {
  id: string;
  title: string;
  fp: number;
  column: 0 | 1 | 2;
  delay: number;
  type: "feat" | "fix" | "chore";
};

const COLUMNS = [
  { label: "Todo", tone: "bg-slate-500/15 text-slate-600 border-slate-500/25" },
  { label: "Doing", tone: "bg-amber-500/15 text-amber-700 border-amber-500/30" },
  { label: "Done", tone: "bg-green-500/15 text-green-700 border-green-500/25" },
] as const;

const CARDS: Card[] = [
  { id: "ZRD-21", title: "Auth proxy 16", fp: 5, column: 2, delay: 0.15, type: "feat" },
  { id: "ZRD-22", title: "Sprint deploy panel", fp: 8, column: 2, delay: 0.22, type: "feat" },
  { id: "ZRD-23", title: "Capacity widget", fp: 3, column: 1, delay: 0.32, type: "feat" },
  { id: "ZRD-24", title: "Skill bars hover", fp: 2, column: 1, delay: 0.4, type: "fix" },
  { id: "ZRD-25", title: "PDI cycle UI", fp: 5, column: 0, delay: 0.5, type: "feat" },
  { id: "ZRD-26", title: "Markdown render", fp: 1, column: 0, delay: 0.58, type: "chore" },
];

const TYPE_TONE: Record<Card["type"], string> = {
  feat: "text-primary",
  fix: "text-amber-600 dark:text-amber-400",
  chore: "text-muted-foreground",
};

export function TasksScene() {
  return (
    <div className="relative flex h-full w-full items-center justify-center p-4 sm:p-10">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
      />

      {/* Kanban */}
      <div className="relative grid w-full max-w-md grid-cols-3 gap-3">
        {COLUMNS.map((col, ci) => (
          <div key={col.label} className="flex flex-col gap-2">
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: ci * 0.08, ease: "easeOut" }}
              className={`rounded-md border px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.15em] ${col.tone}`}
            >
              {col.label}
            </motion.div>
            <div className="flex min-h-[220px] flex-col gap-2 rounded-lg border border-dashed border-border/50 bg-background/30 p-2">
              {CARDS.filter((c) => c.column === ci).map((card) => (
                <motion.div
                  key={card.id}
                  initial={{ opacity: 0, y: 12, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{
                    type: "spring",
                    damping: 16,
                    stiffness: 180,
                    delay: card.delay,
                  }}
                  className="rounded-md border border-border bg-card p-2.5 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-mono text-[10px] tracking-wider ${TYPE_TONE[card.type]}`}
                    >
                      {card.id}
                    </span>
                    <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-primary">
                      {card.fp} PFV
                    </span>
                  </div>
                  <div className="mt-1.5 text-[11px] font-medium leading-tight text-foreground">
                    {card.title}
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="h-1 w-full rounded-full bg-muted" />
                    <div className="h-1 w-2/3 rounded-full bg-muted" />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
