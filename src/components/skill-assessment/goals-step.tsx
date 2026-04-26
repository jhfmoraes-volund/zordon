"use client";

import { Target } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  goals: string;
  onChange: (next: string) => void;
};

export function GoalsStep({ goals, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs text-primary">
          <Target className="h-3 w-3" />
          Objetivos
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Para onde você quer crescer?</h1>
        <p className="text-sm text-muted-foreground max-w-prose">
          Conta seus objetivos profissionais — onde quer chegar, em quais torres quer aprofundar,
          que tipo de problema quer resolver. Esse texto vai alimentar o agente de PDI que
          vai sugerir um plano de desenvolvimento personalizado.
        </p>
      </div>

      <Textarea
        value={goals}
        onChange={(e) => onChange(e.target.value)}
        rows={12}
        placeholder={`Ex.: "Quero virar referência em Backend e Arquitetura de dados, especialmente em Postgres e modelagem de eventos. No próximo ano, gostaria de liderar tecnicamente uma feature complexa de RAG. Também tenho interesse em crescer em Gestão de projetos pra eventualmente coordenar squads."`}
        className="resize-none text-sm"
      />

      <div className="rounded-xl border border-foreground/5 bg-muted/30 p-4 space-y-2">
        <p className="text-xs font-semibold">Algumas perguntas pra te ajudar</p>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5">
          <li>Em quais torres você quer ser referência nos próximos 6-12 meses?</li>
          <li>Que tipo de projeto quer pegar e ainda não pegou?</li>
          <li>Tem alguma especialização que quer construir (ex: Security, IA, Infra)?</li>
          <li>Quer crescer mais técnico, mais de gestão, ou os dois?</li>
        </ul>
      </div>
    </div>
  );
}
