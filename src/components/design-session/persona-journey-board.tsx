"use client";

import { useState } from "react";
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Trash2, User } from "lucide-react";
import type { JourneyStep, Persona } from "@/lib/agent/schemas";
import { genId } from "@/lib/utils";

import { BoardColumn, BoardLayout, BoardSection, Chip, StickyCard } from "./board";
import { avatarFor } from "./persona-avatar";

export type { Persona, JourneyStep };

type PersonaJourneyBoardProps = {
  personas: Persona[];
  onAdd: (persona: Persona) => void;
  onUpdate: (personaId: string, persona: Partial<Persona>) => void;
  onDelete: (personaId: string) => void;
  onAddJourneyStep: (
    personaId: string,
    type: "asIs" | "toBe",
    step: JourneyStep,
  ) => void;
  onUpdateJourneyStep: (
    personaId: string,
    type: "asIs" | "toBe",
    stepId: string,
    step: Partial<JourneyStep>,
  ) => void;
  onDeleteJourneyStep: (
    personaId: string,
    type: "asIs" | "toBe",
    stepId: string,
  ) => void;
};

export function PersonaJourneyBoard({
  personas,
  onAdd,
  onUpdate,
  onDelete,
  onAddJourneyStep,
  onUpdateJourneyStep,
  onDeleteJourneyStep,
}: PersonaJourneyBoardProps) {
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");

  const handleAddPersona = () => {
    if (!newName.trim()) return;
    onAdd({
      id: genId(),
      name: newName.trim(),
      role: newRole.trim(),
      context: "",
      asIsSteps: [],
      toBeSteps: [],
    });
    setNewName("");
    setNewRole("");
  };

  return (
    <BoardLayout cols="double" stack gap={4}>
      {personas.map((persona) => (
        <PersonaSection
          key={persona.id}
          persona={persona}
          onUpdate={(data) => onUpdate(persona.id, data)}
          onDelete={() => onDelete(persona.id)}
          onAddJourneyStep={(type, step) =>
            onAddJourneyStep(persona.id, type, step)
          }
          onUpdateJourneyStep={(type, stepId, step) =>
            onUpdateJourneyStep(persona.id, type, stepId, step)
          }
          onDeleteJourneyStep={(type, stepId) =>
            onDeleteJourneyStep(persona.id, type, stepId)
          }
        />
      ))}

      <BoardSection
        accent="neutral"
        icon={<User className="size-4" />}
        title="Nova persona"
        subtitle="Quem mais sofre com esse problema?"
      >
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="grid gap-1">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Nome
            </Label>
            <Input
              placeholder="Ex: Maria, gestora de vendas"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddPersona()}
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Papel
            </Label>
            <Input
              placeholder="Ex: Gestora de vendas B2B"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddPersona()}
            />
          </div>
          <Button onClick={handleAddPersona} disabled={!newName.trim()}>
            Adicionar
          </Button>
        </div>
      </BoardSection>
    </BoardLayout>
  );
}

// ─── PersonaSection ─────────────────────────────────────────

function PersonaSection({
  persona,
  onUpdate,
  onDelete,
  onAddJourneyStep,
  onUpdateJourneyStep,
  onDeleteJourneyStep,
}: {
  persona: Persona;
  onUpdate: (data: Partial<Persona>) => void;
  onDelete: () => void;
  onAddJourneyStep: (type: "asIs" | "toBe", step: JourneyStep) => void;
  onUpdateJourneyStep: (
    type: "asIs" | "toBe",
    stepId: string,
    step: Partial<JourneyStep>,
  ) => void;
  onDeleteJourneyStep: (type: "asIs" | "toBe", stepId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const totalSteps = persona.asIsSteps.length + persona.toBeSteps.length;
  const avatar = avatarFor(persona.id);
  const [imgError, setImgError] = useState(false);
  const initial = (persona.name || "?").trim().charAt(0).toUpperCase();

  const leading = (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-indigo-500/30 to-violet-500/30 ring-1 ring-border/60 transition-transform hover:scale-[1.02]"
      aria-label={expanded ? "Recolher persona" : "Expandir persona"}
    >
      {imgError ? (
        <span className="flex size-full items-center justify-center font-heading text-lg font-semibold text-indigo-700 dark:text-indigo-200">
          {initial}
        </span>
      ) : (
        <Image
          src={avatar}
          alt={persona.name || "Persona"}
          width={48}
          height={48}
          className="size-full object-cover"
          onError={() => setImgError(true)}
          unoptimized
        />
      )}
    </button>
  );

  const titleNode = persona.name || (
    <span className="italic text-muted-foreground">Sem nome</span>
  );

  return (
    <BoardSection
      accent="indigo"
      leading={leading}
      title={typeof titleNode === "string" ? titleNode : persona.name}
      subtitle={persona.role || "—"}
      headerAside={
        <div className="flex items-center gap-1">
          {!expanded && totalSteps > 0 ? (
            <Chip tone="indigo" mono>
              {persona.asIsSteps.length}d · {persona.toBeSteps.length}g
            </Chip>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Recolher" : "Expandir"}
          >
            {expanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label="Excluir persona"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      }
      bodyClassName={expanded ? "space-y-4 pt-2" : "hidden"}
    >
      <div className="grid gap-1">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Contexto — quem e essa pessoa?
        </Label>
        <Textarea
          placeholder="Ex: Gerencia uma equipe de 8 vendedores, precisa acompanhar pipeline diariamente..."
          value={persona.context}
          onChange={(e) => onUpdate({ context: e.target.value })}
          rows={2}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <JourneyColumn
          title="Jornada Atual (AS-IS)"
          subtitle="Como vive o problema hoje?"
          placeholder="Onde perde tempo? Onde erra? Onde desiste?"
          accent="rose"
          steps={persona.asIsSteps}
          onAdd={(step) => onAddJourneyStep("asIs", step)}
          onUpdate={(stepId, step) =>
            onUpdateJourneyStep("asIs", stepId, step)
          }
          onDelete={(stepId) => onDeleteJourneyStep("asIs", stepId)}
        />
        <JourneyColumn
          title="Jornada Futura (TO-BE)"
          subtitle="Como sera com a solucao?"
          placeholder="O que muda? O que some? O que fica automatico?"
          accent="emerald"
          steps={persona.toBeSteps}
          onAdd={(step) => onAddJourneyStep("toBe", step)}
          onUpdate={(stepId, step) =>
            onUpdateJourneyStep("toBe", stepId, step)
          }
          onDelete={(stepId) => onDeleteJourneyStep("toBe", stepId)}
        />
      </div>
    </BoardSection>
  );
}

// ─── JourneyColumn ──────────────────────────────────────────

function JourneyColumn({
  title,
  subtitle,
  placeholder,
  accent,
  steps,
  onAdd,
  onUpdate,
  onDelete,
}: {
  title: string;
  subtitle: string;
  placeholder: string;
  accent: "rose" | "emerald";
  steps: JourneyStep[];
  onAdd: (step: JourneyStep) => void;
  onUpdate: (stepId: string, step: Partial<JourneyStep>) => void;
  onDelete: (stepId: string) => void;
}) {
  return (
    <BoardColumn
      accent={accent}
      icon={
        <User
          className={
            accent === "rose"
              ? "size-5 text-rose-600 dark:text-rose-400"
              : "size-5 text-emerald-600 dark:text-emerald-400"
          }
        />
      }
      title={title}
      subtitle={subtitle}
      count={steps.length}
      countLabel="passo"
      emptyIcon={User}
      emptyTitle="Sem passos ainda"
      emptyHint={placeholder}
      onAdd={(desc) =>
        onAdd({ id: genId(), description: desc, painOrGain: "" })
      }
      addPlaceholder={placeholder}
    >
      {steps.map((step, i) => (
        <StickyCard
          key={step.id}
          accent={accent}
          onDelete={() => onDelete(step.id)}
          chips={
            <Chip tone={accent} mono>
              #{i + 1}
            </Chip>
          }
          collapsed={
            <Textarea
              value={step.description}
              onChange={(e) =>
                onUpdate(step.id, { description: e.target.value })
              }
              className="resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
              placeholder="Descreva o passo..."
              rows={2}
            />
          }
        />
      ))}
    </BoardColumn>
  );
}
