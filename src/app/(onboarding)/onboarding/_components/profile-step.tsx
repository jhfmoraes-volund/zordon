"use client";

import { motion } from "framer-motion";
import { GitBranch } from "lucide-react";
import { SPECIALTIES, SPECIALTY_LABELS } from "@/lib/roles";
import type { ProfileInput } from "../_actions";

const SENIORITIES = [
  { value: "junior", label: "Júnior" },
  { value: "pleno", label: "Pleno" },
  { value: "senior", label: "Sênior" },
  { value: "principal", label: "Principal" },
] as const;

type Props = {
  value: ProfileInput;
  onChange: (next: ProfileInput) => void;
};

export function ProfileStep({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Conta um pouco sobre você
        </h1>
        <p className="text-sm text-muted-foreground">
          Esses três campos vão pro seu perfil e ajudam a alocar tasks que
          fazem sentido pra você.
        </p>
      </div>

      <FieldGroup label="Especialidade">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SPECIALTIES.map((s, i) => {
            const active = value.specialty === s;
            return (
              <motion.button
                key={s}
                type="button"
                onClick={() => onChange({ ...value, specialty: s })}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 + i * 0.04, ease: "easeOut" }}
                className={[
                  "rounded-lg border px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                ].join(" ")}
              >
                {SPECIALTY_LABELS[s]}
              </motion.button>
            );
          })}
        </div>
      </FieldGroup>

      <FieldGroup label="Senioridade">
        <div className="grid grid-cols-4 gap-2">
          {SENIORITIES.map((s, i) => {
            const active = value.seniority === s.value;
            return (
              <motion.button
                key={s.value}
                type="button"
                onClick={() =>
                  onChange({ ...value, seniority: s.value })
                }
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.04, ease: "easeOut" }}
                className={[
                  "rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                ].join(" ")}
              >
                {s.label}
              </motion.button>
            );
          })}
        </div>
      </FieldGroup>

      <FieldGroup label="GitHub">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card pl-3 focus-within:border-foreground/30">
          <GitBranch className="size-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">@</span>
          <input
            value={value.githubUsername}
            onChange={(e) =>
              onChange({ ...value, githubUsername: e.target.value })
            }
            placeholder="seu-handle"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            className="flex-1 bg-transparent py-2.5 pr-3 text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </FieldGroup>
    </div>
  );
}

function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
