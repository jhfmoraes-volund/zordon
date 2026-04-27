"use client";

import { motion } from "framer-motion";
import type { CapacityInput } from "../_actions";

type Props = {
  value: CapacityInput;
  onChange: (next: CapacityInput) => void;
};

export function CapacityStep({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Sua capacidade
        </h1>
        <p className="text-sm text-muted-foreground">
          Quanto você consegue entregar por semana e quanto do tempo você dedica
          ao AgentOps. Não trava nada — dá pra ajustar depois no profile.
        </p>
      </div>

      <SliderField
        label="Capacidade semanal"
        unit="FP / semana"
        value={value.fpCapacity}
        min={0}
        max={120}
        step={5}
        onChange={(n) => onChange({ ...value, fpCapacity: n })}
        hint="Function Points: tamanho médio do que você fecha numa semana."
      />

      <SliderField
        label="Dedicação"
        unit="%"
        value={value.dedicationPercent}
        min={10}
        max={100}
        step={5}
        onChange={(n) => onChange({ ...value, dedicationPercent: n })}
        hint="Quanto do seu tempo é AgentOps. 100% = full-time."
      />
    </div>
  );
}

type SliderProps = {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
  hint?: string;
};

function SliderField({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: SliderProps) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
        <motion.div
          key={value}
          initial={{ scale: 1.1, opacity: 0.7 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.18 }}
          className="font-mono text-base font-semibold tabular-nums text-foreground"
        >
          {value}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {unit}
          </span>
        </motion.div>
      </div>

      <div className="relative h-8">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        <motion.div
          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary"
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", damping: 22, stiffness: 240 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background"
          aria-label={label}
        />
      </div>

      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
