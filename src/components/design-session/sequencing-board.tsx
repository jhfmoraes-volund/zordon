"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ArrowRight, GripVertical } from "lucide-react";

export type PhaseItem = {
  id: string;
  title: string;
  targetPersona: string;
};

export type Phase = {
  id: string;
  name: string;
  items: PhaseItem[];
};

type SequencingBoardProps = {
  phases: Phase[];
  onAddPhase: (phase: Phase) => void;
  onDeletePhase: (phaseId: string) => void;
  onRenamePhase: (phaseId: string, name: string) => void;
  onMoveItem: (itemId: string, fromPhaseId: string, toPhaseId: string) => void;
  onRemoveItem: (phaseId: string, itemId: string) => void;
};

const genId = () => Math.random().toString(36).slice(2, 9);

const phaseColors = [
  "border-green-500/20 bg-green-500/10",
  "border-blue-500/20 bg-blue-500/10",
  "border-purple-500/20 bg-purple-500/10",
  "border-orange-500/20 bg-orange-500/10",
  "border-pink-500/20 bg-pink-500/10",
];

export function SequencingBoard({
  phases,
  onAddPhase,
  onDeletePhase,
  onRenamePhase,
  onMoveItem,
  onRemoveItem,
}: SequencingBoardProps) {
  const [newPhaseName, setNewPhaseName] = useState("");

  const handleAddPhase = () => {
    if (!newPhaseName.trim()) return;
    onAddPhase({
      id: genId(),
      name: newPhaseName.trim(),
      items: [],
    });
    setNewPhaseName("");
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-4 overflow-x-auto pb-2">
        {phases.map((phase, phaseIndex) => {
          const colorClass = phaseColors[phaseIndex % phaseColors.length];
          const otherPhases = phases.filter((p) => p.id !== phase.id);

          return (
            <Card key={phase.id} className={`min-w-[280px] flex-shrink-0 ${colorClass}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      Fase {phaseIndex + 1}
                    </Badge>
                    <Input
                      value={phase.name}
                      onChange={(e) => onRenamePhase(phase.id, e.target.value)}
                      className="h-7 text-sm font-medium border-none bg-transparent p-0 focus-visible:ring-0 w-auto"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onDeletePhase(phase.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {phase.items.length} {phase.items.length === 1 ? "item" : "items"}
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {phase.items.map((item) => (
                  <div key={item.id} className="rounded-lg bg-card ring-1 ring-foreground/5 p-2 space-y-1">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-1">
                        <GripVertical className="h-3 w-3 text-muted-foreground" />
                        <p className="text-sm">{item.title}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0"
                        onClick={() => onRemoveItem(phase.id, item.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    {item.targetPersona && (
                      <p className="text-xs text-muted-foreground ml-4">
                        {item.targetPersona}
                      </p>
                    )}
                    {otherPhases.length > 0 && (
                      <div className="flex gap-1 ml-4">
                        {otherPhases.map((target) => (
                          <Button
                            key={target.id}
                            variant="outline"
                            size="sm"
                            className="h-5 text-[10px] px-1.5"
                            onClick={() => onMoveItem(item.id, phase.id, target.id)}
                          >
                            <ArrowRight className="h-2 w-2 mr-0.5" />
                            {target.name}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {phase.items.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    Items MVP aparecerao aqui apos priorizacao.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex gap-2 max-w-sm">
        <Input
          placeholder="Nova fase (ex: Release 1, Sprint 1...)"
          value={newPhaseName}
          onChange={(e) => setNewPhaseName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddPhase()}
        />
        <Button variant="outline" onClick={handleAddPhase} disabled={!newPhaseName.trim()}>
          <Plus className="h-4 w-4 mr-1" /> Fase
        </Button>
      </div>
    </div>
  );
}
