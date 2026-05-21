"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { genId } from "@/lib/utils";
import type {
  Gap,
  Risk,
  RiskCategory,
  RiskSeverity,
} from "@/lib/agent/schemas";

import {
  BoardColumn,
  BoardLayout,
  Chip,
  SeverityChip,
  StickyCard,
  SEVERITY_TONE_CHIP,
} from "./board";

export type { Gap, Risk };

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
    <BoardLayout cols="double">
      <BoardColumn
        accent="sky"
        icon={<HelpCircle className="size-4" />}
        title="Lacunas de regra de negocio"
        subtitle="Antes da priorizacao"
        count={gaps.length}
        countLabel="mapeada"
        emptyIcon={HelpCircle}
        emptyTitle="Nenhuma lacuna mapeada ainda"
        emptyHint="Decisoes que precisam de stakeholder ou regras que ainda nao cabem numa frase."
        onAdd={(text) =>
          onAddGap({
            id: genId(),
            text,
            category: "business",
            severity: "medium",
          })
        }
        addPlaceholder="Nova lacuna..."
      >
        {gaps.map((g) => (
          <ItemCard
            key={g.id}
            accent="sky"
            item={g}
            features={features}
            placeholder="Ex: quem aprova reembolso > R$500?"
            mitigationPlaceholder="Como destravar enquanto a decisao formal nao sai? (default temporario, stakeholder, prototipo)"
            onUpdate={(patch) => onUpdateGap(g.id, patch)}
            onDelete={() => onDeleteGap(g.id)}
          />
        ))}
      </BoardColumn>

      <BoardColumn
        accent="red"
        icon={<AlertTriangle className="size-4" />}
        title="Riscos do MVP"
        subtitle="O que pode dar errado"
        count={risks.length}
        countLabel="mapeado"
        emptyIcon={AlertTriangle}
        emptyTitle="Nenhum risco mapeado ainda"
        emptyHint="Coisas que podem atrasar, custar mais ou matar uma feature antes de virar real."
        onAdd={(text) =>
          onAddRisk({
            id: genId(),
            text,
            category: "business",
            severity: "medium",
          })
        }
        addPlaceholder="Novo risco..."
      >
        {risks.map((r) => (
          <ItemCard
            key={r.id}
            accent="red"
            item={r}
            features={features}
            placeholder="Ex: integracao com gateway pode atrasar 2 semanas"
            mitigationPlaceholder="Como vamos reduzir esse risco? Plano B?"
            onUpdate={(patch) => onUpdateRisk(r.id, patch)}
            onDelete={() => onDeleteRisk(r.id)}
          />
        ))}
      </BoardColumn>
    </BoardLayout>
  );
}

// ─── ItemCard — wires Gap/Risk into the generic StickyCard ───────────

type ItemCardItem = Gap | Risk;

function ItemCard({
  accent,
  item,
  features,
  placeholder,
  mitigationPlaceholder,
  onUpdate,
  onDelete,
}: {
  accent: "sky" | "red";
  item: ItemCardItem;
  features: FeatureRef[];
  placeholder: string;
  mitigationPlaceholder: string;
  onUpdate: (patch: Partial<ItemCardItem>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [mitExpanded, setMitExpanded] = useState(false);

  const severity = (item.severity ?? "medium") as RiskSeverity;
  const category = (item.category ?? "business") as RiskCategory;
  const linkedFeature =
    item.relatedFeature && item.relatedFeature !== "__none__"
      ? features.find((f) => f.id === item.relatedFeature)?.title
      : null;
  const hasMitigation = !!item.mitigation?.trim();

  return (
    <StickyCard
      accent={accent}
      expanded={expanded}
      onExpandChange={setExpanded}
      onDelete={onDelete}
      chips={
        <>
          <SeverityChip severity={severity} />
          <Chip>{CATEGORY_LABEL[category]}</Chip>
          {linkedFeature ? (
            <Chip mono truncate>
              {linkedFeature}
            </Chip>
          ) : null}
        </>
      }
      collapsed={
        <p className="line-clamp-3 cursor-text text-sm leading-snug text-foreground/90">
          {item.text || (
            <span className="italic text-muted-foreground">
              (sem descricao — clique pra editar)
            </span>
          )}
        </p>
      }
      collapsedFooter={
        hasMitigation ? (
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="inline-block size-1.5 rounded-full bg-amber-500" />
            mitigacao registrada
          </span>
        ) : null
      }
      expandedBody={
        <div className="space-y-3">
          <Textarea
            value={item.text}
            onChange={(e) => onUpdate({ text: e.target.value })}
            rows={2}
            className="resize-none text-sm"
            placeholder={placeholder}
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Categoria
              </Label>
              <Select
                value={category}
                onValueChange={(v) =>
                  onUpdate({ category: v as RiskCategory })
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
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Severidade
              </Label>
              <Select
                value={severity}
                onValueChange={(v) =>
                  onUpdate({ severity: v as RiskSeverity })
                }
              >
                <SelectTrigger
                  className={cn("h-8 text-xs", SEVERITY_TONE_CHIP[severity])}
                >
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

          {features.length > 0 ? (
            <div className="grid gap-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Funcionalidade relacionada (opcional)
              </Label>
              <Select
                value={item.relatedFeature || "__none__"}
                onValueChange={(v) =>
                  onUpdate({
                    relatedFeature:
                      typeof v === "string" && v !== "__none__" ? v : undefined,
                  })
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
          ) : null}

          <div>
            <button
              type="button"
              onClick={() => setMitExpanded((v) => !v)}
              className="flex w-full items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            >
              {mitExpanded ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
              {hasMitigation ? "Mitigacao" : "Adicionar mitigacao"}
              {hasMitigation && !mitExpanded ? (
                <span className="ml-1 inline-block size-1.5 rounded-full bg-amber-500" />
              ) : null}
            </button>
            {mitExpanded ? (
              <Textarea
                value={item.mitigation ?? ""}
                onChange={(e) => onUpdate({ mitigation: e.target.value })}
                rows={2}
                className="mt-1.5 text-xs"
                placeholder={mitigationPlaceholder}
                autoFocus={!hasMitigation}
              />
            ) : null}
          </div>
        </div>
      }
    />
  );
}

export { CATEGORY_LABEL, SEVERITY_LABEL };
