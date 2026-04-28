"use client";

import { motion } from "framer-motion";
import { Bot } from "lucide-react";
import { AlphaBadge } from "@/components/alpha-chat/alpha-badge";
import { VitorBadge } from "@/components/design-session/vitor-badge";

const AGENTS = [
  {
    slug: "vitor" as const,
    role: "Design sessions",
    body: "Conduz inception e CIs. Captura decisões, dúvidas e gera as tasks da sprint.",
  },
  {
    slug: "alpha" as const,
    role: "Operações",
    body: "Toca a sprint no dia a dia. Aloca, edita tasks, monitora capacity, faz deploy.",
  },
] as const;

export function AgentsStep() {
  return (
    <div className="flex flex-col gap-6">
      <motion.div
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", damping: 12, stiffness: 120, delay: 0.1 }}
        className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary"
      >
        <Bot className="h-3 w-3" />
        Agentes
      </motion.div>

      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Dois copilots dentro do Zordon.
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          Eles têm contexto da operação inteira — squads, sprints, tasks,
          decisões de design. Você invoca quando precisar.
        </p>
      </div>

      <ul className="hidden space-y-2 lg:block">
        {AGENTS.map((a, i) => (
          <motion.li
            key={a.slug}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.25 + i * 0.1, ease: "easeOut" }}
            className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/60 p-3"
          >
            <div className="shrink-0">
              {a.slug === "vitor" ? (
                <VitorBadge size="sm" />
              ) : (
                <AlphaBadge size="sm" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {a.role}
              </div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {a.body}
              </div>
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
