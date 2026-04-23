"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Lightbulb, ChevronDown, ChevronUp } from "lucide-react";
import type { SolutionCard } from "@/lib/agent/schemas";

export type { SolutionCard };

type SolutionCardBoardProps = {
  solutions: SolutionCard[];
  onAdd: (solution: SolutionCard) => void;
  onUpdate: (id: string, data: Partial<SolutionCard>) => void;
  onDelete: (id: string) => void;
  personaNames: string[];
};

const genId = () => Math.random().toString(36).slice(2, 9);

function hasDetails(sol: SolutionCard) {
  return !!(sol.keyScreens || sol.userFlows || sol.painPointRef || sol.technicalNotes);
}

export function SolutionCardBoard({
  solutions,
  onAdd,
  onUpdate,
  onDelete,
  personaNames,
}: SolutionCardBoardProps) {
  const [newTitle, setNewTitle] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    onAdd({
      id: genId(),
      title: newTitle.trim(),
      howItSolves: "",
      targetPersona: "",
    });
    setNewTitle("");
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {solutions.map((sol) => {
          const isExpanded = expanded[sol.id] || false;
          const filled = hasDetails(sol);

          return (
            <Card key={sol.id} className="bg-yellow-500/10">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <Lightbulb className="h-4 w-4 text-yellow-600 mt-2.5 shrink-0" />
                  <Textarea
                    value={sol.title}
                    onChange={(e) => onUpdate(sol.id, { title: e.target.value })}
                    className="text-sm font-semibold flex-1 border-none! shadow-none! bg-transparent! px-2 py-1 focus-visible:ring-0 resize-none"
                    placeholder="Nome da funcionalidade"
                    rows={1}
                  />
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onDelete(sol.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>

                <div className="grid gap-2">
                  <Label className="text-xs text-muted-foreground">Detalhes da funcionalidade</Label>
                  <Textarea
                    value={sol.howItSolves}
                    onChange={(e) => onUpdate(sol.id, { howItSolves: e.target.value })}
                    placeholder="Descreva os detalhes dessa funcionalidade..."
                    rows={2}
                    className="text-sm"
                  />
                </div>

                <div className="grid gap-2">
                  <Label className="text-xs text-muted-foreground">Pra qual persona?</Label>
                  {personaNames.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {personaNames.map((name) => (
                        <Badge
                          key={name}
                          variant={sol.targetPersona === name ? "default" : "outline"}
                          className="cursor-pointer text-xs"
                          onClick={() => onUpdate(sol.id, { targetPersona: name })}
                        >
                          {name}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <Input
                      value={sol.targetPersona}
                      onChange={(e) => onUpdate(sol.id, { targetPersona: e.target.value })}
                      placeholder="Nome da persona"
                      className="h-8 text-sm"
                    />
                  )}
                </div>

                {/* Collapsible detail fields */}
                <button
                  type="button"
                  onClick={() => toggleExpand(sol.id)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {isExpanded ? "Menos detalhes" : "Mais detalhes"}
                  {filled && !isExpanded && (
                    <span className="ml-1 h-1.5 w-1.5 rounded-full bg-yellow-500 inline-block" />
                  )}
                </button>

                {isExpanded && (
                  <div className="space-y-3 border-t pt-3">
                    <div className="grid gap-1.5">
                      <Label className="text-xs text-muted-foreground">Telas / Views envolvidas</Label>
                      <Textarea
                        value={sol.keyScreens || ""}
                        onChange={(e) => onUpdate(sol.id, { keyScreens: e.target.value })}
                        placeholder="Ex: listagem + detalhe + filtros + empty state"
                        rows={2}
                        className="text-sm"
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <Label className="text-xs text-muted-foreground">Fluxos do usuario</Label>
                      <Textarea
                        value={sol.userFlows || ""}
                        onChange={(e) => onUpdate(sol.id, { userFlows: e.target.value })}
                        placeholder="Ex: usuario busca servico -> seleciona prestador -> agenda -> confirma"
                        rows={2}
                        className="text-sm"
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <Label className="text-xs text-muted-foreground">Dor que resolve (jornada AS-IS)</Label>
                      <Textarea
                        value={sol.painPointRef || ""}
                        onChange={(e) => onUpdate(sol.id, { painPointRef: e.target.value })}
                        placeholder="Qual dor da jornada atual essa funcionalidade resolve?"
                        rows={2}
                        className="text-sm"
                      />
                    </div>

                    <div className="grid gap-1.5">
                      <Label className="text-xs text-muted-foreground">Consideracoes tecnicas</Label>
                      <Textarea
                        value={sol.technicalNotes || ""}
                        onChange={(e) => onUpdate(sol.id, { technicalNotes: e.target.value })}
                        placeholder="APIs, integracoes, migracoes necessarias..."
                        rows={2}
                        className="text-sm"
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-dashed">
        <CardContent className="pt-4">
          <div className="flex gap-2">
            <Input
              placeholder="Nova funcionalidade..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Button onClick={handleAdd} disabled={!newTitle.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
