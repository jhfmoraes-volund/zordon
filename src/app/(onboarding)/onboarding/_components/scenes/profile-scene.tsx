"use client";

import { motion } from "framer-motion";
import { Code2, Palette, Database, Shield, Server, Bug } from "lucide-react";

const STACK = [
  { Icon: Code2, x: -120, y: -90, delay: 0.15, tone: "from-violet-500/40 to-indigo-500/20" },
  { Icon: Palette, x: 110, y: -110, delay: 0.25, tone: "from-rose-500/40 to-orange-500/20" },
  { Icon: Database, x: -140, y: 60, delay: 0.35, tone: "from-emerald-500/40 to-teal-500/20" },
  { Icon: Server, x: 130, y: 40, delay: 0.45, tone: "from-cyan-500/40 to-blue-500/20" },
  { Icon: Shield, x: -50, y: 130, delay: 0.55, tone: "from-amber-500/40 to-yellow-500/20" },
  { Icon: Bug, x: 70, y: 140, delay: 0.65, tone: "from-fuchsia-500/40 to-pink-500/20" },
];

export function ProfileScene() {
  return (
    <div className="relative flex h-full w-full items-center justify-center p-10">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="absolute left-1/2 top-1/2 h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/12 blur-3xl"
      />

      {/* Card de perfil central */}
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", damping: 14, stiffness: 140, delay: 0.05 }}
        className="relative z-10 w-[260px] rounded-2xl border border-border bg-card p-5 shadow-xl"
      >
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-full bg-gradient-to-br from-primary/40 to-primary/10" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-3/4 rounded-full bg-foreground/15" />
            <div className="h-2 w-1/2 rounded-full bg-foreground/8" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {["Fullstack", "Sênior", "@handle"].map((t, i) => (
            <motion.span
              key={t}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.06 }}
              className="rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary"
            >
              {t}
            </motion.span>
          ))}
        </div>
      </motion.div>

      {/* Ícones de stack flutuando ao redor */}
      {STACK.map(({ Icon, x, y, delay, tone }, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: x * 1.6, y: y * 1.6, scale: 0.4 }}
          animate={{
            opacity: [0, 1, 1],
            x: [x * 1.6, x, x],
            y: [y * 1.6, y, y + 6, y],
            scale: [0.4, 1, 1],
          }}
          transition={{
            delay,
            duration: 1.2,
            times: [0, 0.55, 1],
            ease: "easeOut",
            y: {
              delay: delay + 1.2,
              duration: 3,
              repeat: Infinity,
              ease: "easeInOut",
              repeatType: "mirror",
            },
          }}
          className={`absolute left-1/2 top-1/2 flex size-12 items-center justify-center rounded-2xl border border-border bg-gradient-to-br ${tone} shadow-lg backdrop-blur`}
        >
          <Icon className="size-5 text-foreground/80" />
        </motion.div>
      ))}
    </div>
  );
}
