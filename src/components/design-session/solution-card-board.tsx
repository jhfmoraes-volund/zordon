"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Lightbulb } from "lucide-react";

export type SolutionCard = {
  id: string;
  title: string;
  howItSolves: string;
  targetPersona: string;
};

type SolutionCardBoardProps = {
  solutions: SolutionCard[];
  onAdd: (solution: SolutionCard) => void;
  onUpdate: (id: string, data: Partial<SolutionCard>) => void;
  onDelete: (id: string) => void;
  personaNames: string[];
};

const genId = () => Math.random().toString(36).slice(2, 9);

export function SolutionCardBoard({
  solutions,
  onAdd,
  onUpdate,
  onDelete,
  personaNames,
}: SolutionCardBoardProps) {
  const [newTitle, setNewTitle] = useState("");

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
        {solutions.map((sol) => (
          <Card key={sol.id} className="bg-yellow-500/10">
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-yellow-600" />
                  <Input
                    value={sol.title}
                    onChange={(e) => onUpdate(sol.id, { title: e.target.value })}
                    className="h-8 text-sm font-medium border-none bg-transparent p-0 focus-visible:ring-0"
                    placeholder="Nome da solucao"
                  />
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onDelete(sol.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">Como resolve?</Label>
                <Textarea
                  value={sol.howItSolves}
                  onChange={(e) => onUpdate(sol.id, { howItSolves: e.target.value })}
                  placeholder="Descreva como essa ideia resolve o problema..."
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
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-dashed">
        <CardContent className="pt-4">
          <div className="flex gap-2">
            <Input
              placeholder="Nova ideia de solucao..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Button onClick={handleAdd} disabled={!newTitle.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Ideia
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
