"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

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
          Você acabou de entrar no AgentOps — o sistema interno que orquestra
          squads, sprints e os agentes que tocam o trabalho do dia a dia. São
          três passos rápidos pra calibrar seu perfil antes de começar.
        </p>
      </div>

      <ul className="space-y-2 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-primary" />
          Especialidade, senioridade e GitHub
        </li>
        <li className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-primary" />
          Capacidade semanal de entrega
        </li>
        <li className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-primary" />
          Tour rápido e você tá dentro
        </li>
      </ul>
    </div>
  );
}
