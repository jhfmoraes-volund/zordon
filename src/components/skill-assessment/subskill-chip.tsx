"use client";

import { Star } from "lucide-react";
import { motion } from "framer-motion";
import {
  cycleSubskillState,
  SUBSKILL_STATE_LABELS,
  type SubskillState,
} from "@/lib/memberSkills";

type Props = {
  label: string;
  state: SubskillState;
  onCycle: (next: SubskillState) => void;
};

export function SubskillChip({ label, state, onCycle }: Props) {
  const isKnows = state === "knows";
  const isRef = state === "ref";

  const base =
    "group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors text-left select-none";
  const styles = isRef
    ? "border-primary bg-primary text-primary-foreground"
    : isKnows
    ? "border-primary/40 bg-primary/10 text-primary"
    : "border-foreground/10 bg-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground";

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      transition={{ duration: 0.1 }}
      onClick={() => onCycle(cycleSubskillState(state))}
      className={`${base} ${styles}`}
      aria-label={`${label}: ${SUBSKILL_STATE_LABELS[state]}`}
      title={SUBSKILL_STATE_LABELS[state]}
    >
      {isRef && <Star className="h-3 w-3 fill-current" />}
      <span>{label}</span>
    </motion.button>
  );
}
