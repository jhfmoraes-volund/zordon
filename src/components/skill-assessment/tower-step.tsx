"use client";

import { icons } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { SubskillChip } from "./subskill-chip";
import {
  type Tower,
  type SubskillState,
  type SubskillMap,
} from "@/lib/memberSkills";

type Props = {
  tower: Tower;
  subskills: SubskillMap;
  cases: string;
  onSubskillCycle: (subskillKey: string, next: SubskillState) => void;
  onCasesChange: (next: string) => void;
};

export function TowerStep({
  tower,
  subskills,
  cases,
  onSubskillCycle,
  onCasesChange,
}: Props) {
  const Icon = (icons as Record<string, React.ComponentType<{ className?: string }>>)[tower.icon];

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex items-start gap-4">
        {Icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
            <Icon className="h-6 w-6" />
          </div>
        )}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{tower.label}</h1>
          <p className="text-sm text-muted-foreground mt-1">{tower.summary}</p>
        </div>
      </div>

      {/* 2 columns: subskills + cases */}
      <div className="grid lg:grid-cols-12 gap-x-10 gap-y-8">
        <div className="lg:col-span-7 space-y-3">
          <div>
            <p className="text-sm font-medium">Em quais áreas você atua?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Clique pra ciclar:{" "}
              <span className="text-foreground">não conheço → sei usar → sou referência</span>.
              Marque tudo que se aplica.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {tower.subskills.map((s) => (
              <SubskillChip
                key={s.key}
                label={s.label}
                state={subskills[s.key] ?? "none"}
                onCycle={(next) => onSubskillCycle(s.key, next)}
              />
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 space-y-3">
          <div>
            <p className="text-sm font-medium">Conta um caso prático</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Projetos, problemas que você resolveu nessa torre, ferramentas que dominou.
              Quanto mais concreto, melhor — esse texto vai pro agente que define seu nível.
            </p>
          </div>
          <Textarea
            value={cases}
            onChange={(e) => onCasesChange(e.target.value)}
            rows={10}
            placeholder={`Ex.: "Implementei o RLS multi-tenant no projeto X usando claims do JWT. Otimizei queries com índice parcial em Y..."`}
            className="resize-none text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            Opcional — pode pular se não atua nessa torre.
          </p>
        </div>
      </div>
    </div>
  );
}
