"use client";

import { Sparkles, Keyboard, Gauge } from "lucide-react";
import { TOWERS } from "@/lib/memberSkills";

type Props = {
  hasPrevious: boolean;
};

export function IntroStep({ hasPrevious }: Props) {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs text-primary">
          <Sparkles className="h-3 w-3" />
          Auto-avaliação de skills
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          {hasPrevious ? "Atualize sua avaliação" : "Vamos mapear suas forças"}
        </h1>
        <p className="text-sm text-muted-foreground max-w-prose">
          São {TOWERS.length} torres + 1 passo de objetivos profissionais. Em cada torre você
          marca subskills e conta um caso prático. O score 0-100 é calculado a partir das
          marcações — replicável e justo. Tudo é salvo automaticamente.
        </p>
      </div>

      <div className="rounded-xl border border-foreground/10 p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="h-4 w-4 text-primary" /> Como o score é calculado
        </div>
        <ul className="text-sm text-muted-foreground space-y-1.5 pl-5 list-disc">
          <li>Cada subskill marcada como <span className="text-foreground">"sei usar"</span> conta 1 ponto.</li>
          <li>Cada subskill marcada como <span className="text-foreground">"sou referência"</span> conta 1.5 pontos.</li>
          <li>O score é o seu total dividido pelo máximo da torre, em 0-100.</li>
          <li>Não há agente avaliando — fórmula determinística, mesma pra todos.</li>
        </ul>
      </div>

      <div className="rounded-xl border border-foreground/5 bg-muted/30 p-5 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Keyboard className="h-4 w-4" /> Atalhos
        </div>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li><kbd className="rounded border border-foreground/15 bg-background px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd> · próximo · <kbd className="rounded border border-foreground/15 bg-background px-1.5 py-0.5 font-mono text-[10px]">Shift</kbd>+<kbd className="rounded border border-foreground/15 bg-background px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd> · voltar</li>
          <li><kbd className="rounded border border-foreground/15 bg-background px-1.5 py-0.5 font-mono text-[10px]">⌘</kbd>+<kbd className="rounded border border-foreground/15 bg-background px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd> · avança quando estiver digitando</li>
          <li><kbd className="rounded border border-foreground/15 bg-background px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd> · sair (continua de onde parou)</li>
        </ul>
      </div>
    </div>
  );
}
