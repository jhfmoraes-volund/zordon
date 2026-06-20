"use client";

import { motion } from "framer-motion";
import { AgentBadge } from "@/components/ui/conversation";

type AgentSlug = "vitor" | "alpha";

type Bubble = {
  agent: AgentSlug;
  text: string;
  delay: number;
  shimmer?: boolean;
};

const BUBBLES: Bubble[] = [
  { agent: "vitor", text: "Inception capturada — 8 decisões, 3 dúvidas abertas.", delay: 0.5 },
  { agent: "alpha", text: "Sprint 12 alocada · 78/108 PFV", delay: 1.0 },
  { agent: "vitor", text: "Gerando tasks a partir do briefing…", delay: 1.5, shimmer: true },
  { agent: "alpha", text: "Deploy staging concluído ✓", delay: 2.0 },
];

export function AgentsScene() {
  return (
    <div className="relative flex h-full w-full items-center justify-center p-4 sm:p-10">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-3xl"
      />

      <div className="relative w-full max-w-md space-y-4">
        {/* Badges no topo */}
        <div className="flex items-center justify-center gap-4">
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", damping: 14, stiffness: 140, delay: 0.1 }}
            className="flex flex-col items-center gap-1.5"
          >
            <AgentBadge agent="vitor" size="md" showDot />
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Design sessions
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", damping: 14, stiffness: 140, delay: 0.22 }}
            className="flex flex-col items-center gap-1.5"
          >
            <AgentBadge agent="alpha" size="md" showDot />
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Operações
            </div>
          </motion.div>
        </div>

        {/* Stream de mensagens */}
        <div className="space-y-2.5 pt-2">
          {BUBBLES.map((b, i) => (
            <BubbleRow key={i} bubble={b} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BubbleRow({ bubble }: { bubble: Bubble }) {
  const isVitor = bubble.agent === "vitor";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        type: "spring",
        damping: 16,
        stiffness: 200,
        delay: bubble.delay,
      }}
      className={`flex ${isVitor ? "justify-start" : "justify-end"}`}
    >
      <div
        className={`flex max-w-[85%] flex-col gap-1.5 rounded-2xl border px-3 py-2 text-xs shadow-sm ${
          isVitor
            ? "rounded-bl-sm border-[oklch(0.74_0.18_55/0.30)] bg-[oklch(0.74_0.18_55/0.10)]"
            : "rounded-br-sm border-primary/30 bg-primary/10"
        }`}
      >
        <AgentBadge agent={bubble.agent} size="sm" showDot={false} />
        <div className={bubble.shimmer ? "shimmer-text" : ""}>{bubble.text}</div>
      </div>
    </motion.div>
  );
}
