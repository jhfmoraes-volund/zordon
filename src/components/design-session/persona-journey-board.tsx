"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, User, ChevronDown, ChevronRight } from "lucide-react";
import type { Persona, JourneyStep } from "@/lib/agent/schemas";

export type { Persona, JourneyStep };

type PersonaJourneyBoardProps = {
  personas: Persona[];
  onAdd: (persona: Persona) => void;
  onUpdate: (personaId: string, persona: Partial<Persona>) => void;
  onDelete: (personaId: string) => void;
  onAddJourneyStep: (personaId: string, type: "asIs" | "toBe", step: JourneyStep) => void;
  onUpdateJourneyStep: (personaId: string, type: "asIs" | "toBe", stepId: string, step: Partial<JourneyStep>) => void;
  onDeleteJourneyStep: (personaId: string, type: "asIs" | "toBe", stepId: string) => void;
};

import { genId } from "@/lib/utils";

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
    <div className="space-y-6">
      {personas.map((persona) => (
        <PersonaCard
          key={persona.id}
          persona={persona}
          onUpdate={(data) => onUpdate(persona.id, data)}
          onDelete={() => onDelete(persona.id)}
          onAddJourneyStep={(type, step) => onAddJourneyStep(persona.id, type, step)}
          onUpdateJourneyStep={(type, stepId, step) => onUpdateJourneyStep(persona.id, type, stepId, step)}
          onDeleteJourneyStep={(type, stepId) => onDeleteJourneyStep(persona.id, type, stepId)}
        />
      ))}

      <Card className="border-dashed">
        <CardContent className="pt-6">
          <div className="flex items-end gap-3">
            <div className="flex-1 grid gap-2">
              <Label className="text-sm">Nome da persona</Label>
              <Input
                placeholder="Ex: Maria, gestora de vendas"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddPersona()}
              />
            </div>
            <div className="flex-1 grid gap-2">
              <Label className="text-sm">Papel</Label>
              <Input
                placeholder="Ex: Gestora de vendas B2B"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddPersona()}
              />
            </div>
            <Button onClick={handleAddPersona} disabled={!newName.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Persona
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PersonaCard({
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
  onUpdateJourneyStep: (type: "asIs" | "toBe", stepId: string, step: Partial<JourneyStep>) => void;
  onDeleteJourneyStep: (type: "asIs" | "toBe", stepId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const totalSteps = persona.asIsSteps.length + persona.toBeSteps.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <button
            type="button"
            className="flex items-center gap-3 text-left cursor-pointer"
            onClick={() => setExpanded((v) => !v)}
          >
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div className="flex items-center gap-2">
              <div>
                <CardTitle className="text-base">{persona.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{persona.role}</p>
              </div>
              {!expanded && totalSteps > 0 && (
                <Badge variant="secondary" className="text-xs ml-2">
                  {persona.asIsSteps.length} dor · {persona.toBeSteps.length} ganho
                </Badge>
              )}
            </div>
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label className="text-sm">Contexto — quem e essa pessoa?</Label>
            <Textarea
              placeholder="Ex: Gerencia uma equipe de 8 vendedores, precisa acompanhar pipeline diariamente..."
              value={persona.context}
              onChange={(e) => onUpdate({ context: e.target.value })}
              rows={2}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <JourneyColumn
              title="Jornada Atual (AS-IS)"
              subtitle="Como vive o problema hoje?"
              placeholder="Onde perde tempo? Onde erra? Onde desiste?"
              steps={persona.asIsSteps}
              onAdd={(step) => onAddJourneyStep("asIs", step)}
              onUpdate={(stepId, step) => onUpdateJourneyStep("asIs", stepId, step)}
              onDelete={(stepId) => onDeleteJourneyStep("asIs", stepId)}
            />
            <JourneyColumn
              title="Jornada Futura (TO-BE)"
              subtitle="Como sera com a solucao?"
              placeholder="O que muda? O que some? O que fica automatico?"
              steps={persona.toBeSteps}
              onAdd={(step) => onAddJourneyStep("toBe", step)}
              onUpdate={(stepId, step) => onUpdateJourneyStep("toBe", stepId, step)}
              onDelete={(stepId) => onDeleteJourneyStep("toBe", stepId)}
            />
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function JourneyColumn({
  title,
  subtitle,
  placeholder,
  steps,
  onAdd,
  onUpdate,
  onDelete,
}: {
  title: string;
  subtitle: string;
  placeholder: string;
  steps: JourneyStep[];
  onAdd: (step: JourneyStep) => void;
  onUpdate: (stepId: string, step: Partial<JourneyStep>) => void;
  onDelete: (stepId: string) => void;
}) {
  const [newDesc, setNewDesc] = useState("");

  const handleAdd = () => {
    if (!newDesc.trim()) return;
    onAdd({ id: genId(), description: newDesc.trim(), painOrGain: "" });
    setNewDesc("");
  };

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-medium">{title}</h4>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>

      <div className="space-y-2">
        {steps.map((step, i) => (
          <div key={step.id} className="rounded-md border p-3 space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-xs font-mono text-muted-foreground mt-1">{i + 1}.</span>
              <Textarea
                value={step.description}
                onChange={(e) => onUpdate(step.id, { description: e.target.value })}
                className="text-sm"
                placeholder="Descreva o passo..."
                rows={2}
              />
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onDelete(step.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder={placeholder}
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="text-sm"
        />
        <Button variant="outline" size="sm" onClick={handleAdd} disabled={!newDesc.trim()}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
