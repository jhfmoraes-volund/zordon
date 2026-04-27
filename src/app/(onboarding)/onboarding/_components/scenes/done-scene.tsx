"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";

const RINGS = [
  { size: 220, delay: 0.0, opacity: 0.18 },
  { size: 320, delay: 0.15, opacity: 0.12 },
  { size: 440, delay: 0.3, opacity: 0.07 },
];

const CONFETTI = Array.from({ length: 14 }).map((_, i) => ({
  id: i,
  x: (Math.cos((i / 14) * Math.PI * 2) * 220) | 0,
  y: (Math.sin((i / 14) * Math.PI * 2) * 220) | 0,
  delay: 0.55 + (i % 7) * 0.04,
  hue: i % 4,
}));

const HUE_TONES = [
  "bg-primary",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
];

export function DoneScene() {
  return (
    <div className="relative flex h-full w-full items-center justify-center p-10">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="absolute left-1/2 top-1/2 h-[440px] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl"
      />

      {/* Anéis pulsantes */}
      {RINGS.map((r, i) => (
        <motion.div
          key={i}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: [0.6, 1.05, 1], opacity: [0, r.opacity, r.opacity] }}
          transition={{
            delay: r.delay,
            duration: 1.2,
            ease: "easeOut",
          }}
          className="absolute rounded-full border border-primary"
          style={{
            width: r.size,
            height: r.size,
            opacity: r.opacity,
          }}
        />
      ))}

      {/* Confete radial */}
      {CONFETTI.map((c) => (
        <motion.span
          key={c.id}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
          animate={{ x: c.x, y: c.y, opacity: [0, 1, 0.8], scale: [0, 1, 1] }}
          transition={{
            delay: c.delay,
            duration: 0.9,
            times: [0, 0.55, 1],
            ease: "easeOut",
          }}
          className={`absolute size-2 rounded-full ${HUE_TONES[c.hue]}`}
        />
      ))}

      {/* Check central com spring */}
      <motion.div
        initial={{ scale: 0, rotate: -45 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", damping: 11, stiffness: 130, delay: 0.2 }}
        className="relative z-10 flex size-28 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-2xl"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", damping: 10, stiffness: 200, delay: 0.5 }}
        >
          <Check className="size-12" strokeWidth={3} />
        </motion.div>
      </motion.div>
    </div>
  );
}
