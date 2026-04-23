"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, FlaskConical } from "lucide-react";
import type { Hypothesis } from "@/lib/agent/schemas";

export type { Hypothesis };

type HypothesisBoardProps = {
  hypotheses: Hypothesis[];
  onAdd: (h: Hypothesis) => void;
  onUpdate: (id: string, data: Partial<Hypothesis>) => void;
  onDelete: (id: string) => void;
};

const genId = () => Math.random().toString(36).slice(2, 9);

export function HypothesisBoard({
  hypotheses,
  onAdd,
  onUpdate,
  onDelete,
}: HypothesisBoardProps) {
  const [newHypothesis, setNewHypothesis] = useState("");

  const handleAdd = () => {
    if (!newHypothesis.trim()) return;
    onAdd({
      id: genId(),
      hypothesis: newHypothesis.trim(),
      indicator: "",
      target: "",
      expectedResult: "",
      evidence: "",
    });
    setNewHypothesis("");
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {hypotheses.map((h, i) => (
          <Card key={h.id} className="bg-purple-500/10">
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-purple-600 shrink-0" />
                  <span className="text-xs font-semibold text-purple-600">
                    Hipotese {i + 1}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => onDelete(h.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">
                  Acreditamos que...
                </Label>
                <Textarea
                  value={h.hypothesis}
                  onChange={(e) =>
                    onUpdate(h.id, { hypothesis: e.target.value })
                  }
                  placeholder="Se oferecermos [X], entao [Y] vai acontecer..."
                  rows={2}
                  className="text-sm"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">
                  Indicador
                </Label>
                <Input
                  value={h.indicator}
                  onChange={(e) =>
                    onUpdate(h.id, { indicator: e.target.value })
                  }
                  placeholder="O que vamos medir? Ex: taxa de conversao"
                  className="h-8 text-sm"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">Meta</Label>
                <Input
                  value={h.target}
                  onChange={(e) =>
                    onUpdate(h.id, { target: e.target.value })
                  }
                  placeholder="Ex: >= 25 transacoes em 90 dias"
                  className="h-8 text-sm"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">
                  Resultado esperado
                </Label>
                <Textarea
                  value={h.expectedResult}
                  onChange={(e) =>
                    onUpdate(h.id, { expectedResult: e.target.value })
                  }
                  placeholder="Se atingir a meta, o que isso significa? Qual decisao tomamos?"
                  rows={2}
                  className="text-sm"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-xs text-muted-foreground">
                  Evidencia requerida
                </Label>
                <Input
                  value={h.evidence}
                  onChange={(e) =>
                    onUpdate(h.id, { evidence: e.target.value })
                  }
                  placeholder="Como vamos provar? Ex: relatorio da plataforma"
                  className="h-8 text-sm"
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-dashed">
        <CardContent className="pt-4">
          <div className="flex gap-2">
            <Input
              placeholder="Nova hipotese..."
              value={newHypothesis}
              onChange={(e) => setNewHypothesis(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Button onClick={handleAdd} disabled={!newHypothesis.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
