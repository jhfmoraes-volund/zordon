"use client";

import { motion } from "framer-motion";
import { TrendingUp } from "lucide-react";

const FEATURES = [
  "Ciclos de PDI ligados às torres mais fracas",
  "Ações concretas com prazo e status",
  "Acompanhamento de evolução por sprint",
  "Conversa direta com seu líder no contexto",
] as const;

export function PdiStep() {
  return (
    <div className="flex flex-col gap-6">
      <motion.div
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", damping: 12, stiffness: 120, delay: 0.1 }}
        className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary"
      >
        <TrendingUp className="h-3 w-3" />
        PDI
      </motion.div>

      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Plano de evolução real.
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          Cada ciclo de PDI vira um conjunto de ações com prazo. Saídas
          medíveis, ligadas às torres do scorecard — o caminho fica concreto.
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
