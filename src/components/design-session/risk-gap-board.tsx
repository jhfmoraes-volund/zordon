"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, AlertTriangle, HelpCircle } from "lucide-react";
import type { Gap, Risk, RiskCategory, RiskSeverity } from "@/lib/agent/schemas";

export type { Gap, Risk };

const genId = () => Math.random().toString(36).slice(2, 9);

const SEVERITY_TONE: Record<RiskSeverity, string> = {
  high: "bg-red-500/15 text-red-600 border-red-500/30",
  medium: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  low: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
};

const SEVERITY_LABEL: Record<RiskSeverity, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baixa",
};

const CATEGORY_LABEL: Record<RiskCategory, string> = {
  business: "Negocio",
  technical: "Tecnico",
};

type FeatureRef = { id: string; title: string };

type RiskGapBoardProps = {
  gaps: Gap[];
  risks: Risk[];
  features: FeatureRef[];
  onAddGap: (gap: Gap) => void;
  onUpdateGap: (id: string, updates: Partial<Gap>) => void;
  onDeleteGap: (id: string) => void;
  onAddRisk: (risk: Risk) => void;
  onUpdateRisk: (id: string, updates: Partial<Risk>) => void;
  onDeleteRisk: (id: string) => void;
};

export function RiskGapBoard({
  gaps,
  risks,
  features,
  onAddGap,
  onUpdateGap,
  onDeleteGap,
  onAddRisk,
  onUpdateRisk,
  onDeleteRisk,
}: RiskGapBoardProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <GapColumn
        gaps={gaps}
        features={features}
        onAdd={onAddGap}
        onUpdate={onUpdateGap}
        onDelete={onDeleteGap}
      />
      <RiskColumn
        risks={risks}
        features={features}
        onAdd={onAddRisk}
        onUpdate={onUpdateRisk}
        onDelete={onDeleteRisk}
      />
    </div>
  );
}

// ─── Lacunas ──────────────────────────────────────────────

function GapColumn({
  gaps,
  features,
  onAdd,
  onUpdate,
  onDelete,
}: {
  gaps: Gap[];
  features: FeatureRef[];
  onAdd: (gap: Gap) => void;
  onUpdate: (id: string, updates: Partial<Gap>) => void;
  onDelete: (id: string) => void;
}) {
  const [text, setText] = useState("");

  const handleAdd = () => {
    const t = text.trim();
    if (!t) return;
    onAdd({ id: genId(), text: t });
    setText("");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <HelpCircle className="h-4 w-4 text-sky-600" />
        <h3 className="text-sm font-semibold">Lacunas de regra de negocio</h3>
        <Badge variant="secondary" className="text-xs">
          {gaps.length}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Ambiguidades nas funcionalidades que precisam de decisao explicita antes de virar task.
      </p>

      <div className="space-y-2">
        {gaps.map((gap) => (
          <Card key={gap.id} className="bg-sky-500/5">
            <CardContent className="pt-3 pb-3 space-y-2">
              <div className="flex items-start gap-2">
                <Textarea
                  value={gap.text}
                  onChange={(e) => onUpdate(gap.id, { text: e.target.value })}
                  rows={2}
                  className="text-sm flex-1"
                  placeholder="Ex: feature X menciona 'aprovacao' — quem aprova? sincrono ou async?"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => onDelete(gap.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              <FeatureSelect
                value={gap.relatedFeature}
                features={features}
                onChange={(value) => onUpdate(gap.id, { relatedFeature: value })}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-dashed">
        <CardContent className="pt-3 pb-3">
          <div className="flex gap-2">
            <Input
              placeholder="Nova lacuna..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Button onClick={handleAdd} disabled={!text.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Riscos ───────────────────────────────────────────────

function RiskColumn({
  risks,
  features,
  onAdd,
  onUpdate,
  onDelete,
}: {
  risks: Risk[];
  features: FeatureRef[];
  onAdd: (risk: Risk) => void;
  onUpdate: (id: string, updates: Partial<Risk>) => void;
  onDelete: (id: string) => void;
}) {
  const [text, setText] = useState("");

  const handleAdd = () => {
    const t = text.trim();
    if (!t) return;
    onAdd({
      id: genId(),
      text: t,
      category: "business",
      severity: "medium",
    });
    setText("");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-red-600" />
        <h3 className="text-sm font-semibold">Riscos do MVP</h3>
        <Badge variant="secondary" className="text-xs">
          {risks.length}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        O que pode dar errado — negocio ou tecnico — antes mesmo de cortar escopo.
      </p>

      <div className="space-y-2">
        {risks.map((risk) => (
          <Card key={risk.id} className="bg-red-500/5">
            <CardContent className="pt-3 pb-3 space-y-2">
              <div className="flex items-start gap-2">
                <Textarea
                  value={risk.text}
                  onChange={(e) => onUpdate(risk.id, { text: e.target.value })}
                  rows={2}
                  className="text-sm flex-1"
                  placeholder="Ex: integracao com gateway de pagamento pode atrasar 2 semanas"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => onDelete(risk.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Categoria</Label>
                  <Select
                    value={risk.category}
                    onValueChange={(v) =>
                      onUpdate(risk.id, { category: v as RiskCategory })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="business">Negocio</SelectItem>
                      <SelectItem value="technical">Tecnico</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">Severidade</Label>
                  <Select
                    value={risk.severity}
                    onValueChange={(v) =>
                      onUpdate(risk.id, { severity: v as RiskSeverity })
                    }
                  >
                    <SelectTrigger className={`h-8 text-xs ${SEVERITY_TONE[risk.severity]}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high">Alta</SelectItem>
                      <SelectItem value="medium">Media</SelectItem>
                      <SelectItem value="low">Baixa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <FeatureSelect
                value={risk.relatedFeature}
                features={features}
                onChange={(value) => onUpdate(risk.id, { relatedFeature: value })}
              />

              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">
                  Mitigacao (opcional)
                </Label>
                <Textarea
                  value={risk.mitigation || ""}
                  onChange={(e) => onUpdate(risk.id, { mitigation: e.target.value })}
                  rows={2}
                  className="text-xs"
                  placeholder="Como vamos reduzir esse risco? Plano B?"
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-dashed">
        <CardContent className="pt-3 pb-3">
          <div className="flex gap-2">
            <Input
              placeholder="Novo risco..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Button onClick={handleAdd} disabled={!text.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Feature select ───────────────────────────────────────

function FeatureSelect({
  value,
  features,
  onChange,
}: {
  value: string | undefined;
  features: FeatureRef[];
  onChange: (value: string | undefined) => void;
}) {
  if (features.length === 0) return null;

  return (
    <div className="grid gap-1">
      <Label className="text-xs text-muted-foreground">
        Funcionalidade relacionada (opcional)
      </Label>
      <Select
        value={value || "__none__"}
        onValueChange={(v) =>
          onChange(typeof v === "string" && v !== "__none__" ? v : undefined)
        }
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Selecione..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— Nenhuma —</SelectItem>
          {features.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.title || "Sem titulo"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export { CATEGORY_LABEL, SEVERITY_LABEL, SEVERITY_TONE };
