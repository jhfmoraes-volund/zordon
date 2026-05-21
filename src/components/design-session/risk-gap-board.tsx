"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Trash2,
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

// Edit state — only ONE card may be in dialog mode at a time. The kind tells
// the dialog which handlers (gap vs risk) to call back into.
type EditState =
  | { kind: "gap"; id: string }
  | { kind: "risk"; id: string }
  | null;

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
  const [editing, setEditing] = useState<EditState>(null);

  const editingItem: ItemCardItem | null =
    editing?.kind === "gap"
      ? gaps.find((g) => g.id === editing.id) ?? null
      : editing?.kind === "risk"
        ? risks.find((r) => r.id === editing.id) ?? null
        : null;

  return (
    <>
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
          onAdd={(text) => {
            const id = genId();
            onAddGap({
              id,
              text,
              category: "business",
              severity: "medium",
            });
            // Open the dialog right after creating so the user can flesh
            // out severity/category/mitigation without a second click.
            setEditing({ kind: "gap", id });
          }}
          addPlaceholder="Nova lacuna..."
        >
          {gaps.map((g) => (
            <ItemCard
              key={g.id}
              accent="sky"
              item={g}
              features={features}
              onOpen={() => setEditing({ kind: "gap", id: g.id })}
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
          onAdd={(text) => {
            const id = genId();
            onAddRisk({
              id,
              text,
              category: "business",
              severity: "medium",
            });
            setEditing({ kind: "risk", id });
          }}
          addPlaceholder="Novo risco..."
        >
          {risks.map((r) => (
            <ItemCard
              key={r.id}
              accent="red"
              item={r}
              features={features}
              onOpen={() => setEditing({ kind: "risk", id: r.id })}
              onDelete={() => onDeleteRisk(r.id)}
            />
          ))}
        </BoardColumn>
      </BoardLayout>

      <RiskGapEditDialog
        item={editingItem}
        kind={editing?.kind ?? null}
        features={features}
        onClose={() => setEditing(null)}
        onUpdate={(patch) => {
          if (!editing) return;
          if (editing.kind === "gap") onUpdateGap(editing.id, patch);
          else onUpdateRisk(editing.id, patch);
        }}
      />
    </>
  );
}

// ─── ItemCard ──────────────────────────────────────────────
// Always-collapsed card on the grid. Click opens the dialog. Trash stays in
// the top-right with stopPropagation so it doesn't also open the dialog.

type ItemCardItem = Gap | Risk;

function ItemCard({
  accent,
  item,
  features,
  onOpen,
  onDelete,
}: {
  accent: "sky" | "red";
  item: ItemCardItem;
  features: FeatureRef[];
  onOpen: () => void;
  onDelete: () => void;
}) {
  const severity = (item.severity ?? "medium") as RiskSeverity;
  const category = (item.category ?? "business") as RiskCategory;
  const linkedFeature =
    item.relatedFeature && item.relatedFeature !== "__none__"
      ? features.find((f) => f.id === item.relatedFeature)?.title
      : null;
  const hasMitigation = !!item.mitigation?.trim();

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <StickyCard
        accent={accent}
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
        actions={
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={stop(onDelete)}
            aria-label="Excluir"
          >
            <Trash2 className="size-3.5" />
          </Button>
        }
        collapsed={
          <p className="line-clamp-3 text-sm leading-snug text-foreground/90">
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
      />
    </div>
  );
}

// ─── RiskGapEditDialog ─────────────────────────────────────
// Notion-style centered dialog. Title-like Textarea at the top, then the
// classification (categoria + severidade), feature link, and an optional
// "mitigação" accordion. Auto-saves on every change.

function RiskGapEditDialog({
  item,
  kind,
  features,
  onClose,
  onUpdate,
}: {
  item: ItemCardItem | null;
  kind: "gap" | "risk" | null;
  features: FeatureRef[];
  onClose: () => void;
  onUpdate: (patch: Partial<ItemCardItem>) => void;
}) {
  const [mitExpanded, setMitExpanded] = useState(false);
  const open = item !== null && kind !== null;

  const severity = (item?.severity ?? "medium") as RiskSeverity;
  const category = (item?.category ?? "business") as RiskCategory;
  const hasMitigation = !!item?.mitigation?.trim();

  const textPlaceholder =
    kind === "gap"
      ? "Ex: quem aprova reembolso > R$500?"
      : "Ex: integracao com gateway pode atrasar 2 semanas";
  const mitigationPlaceholder =
    kind === "gap"
      ? "Como destravar enquanto a decisao formal nao sai? (default temporario, stakeholder, prototipo)"
      : "Como vamos reduzir esse risco? Plano B?";

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setMitExpanded(false);
          onClose();
        }
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-2xl">
        {item ? (
          <div className="flex flex-col gap-5 p-2 sm:p-4">
            {/* Notion-style large title textarea */}
            <div>
              <ResponsiveDialogTitle className="sr-only">
                {item.text || (kind === "gap" ? "Nova lacuna" : "Novo risco")}
              </ResponsiveDialogTitle>
              <textarea
                value={item.text}
                onChange={(e) => onUpdate({ text: e.target.value })}
                rows={2}
                placeholder={textPlaceholder}
                className="field-sizing-content w-full resize-none bg-transparent font-heading text-2xl font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground/50"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Categoria
                </Label>
                <Select
                  value={category}
                  onValueChange={(v) =>
                    onUpdate({ category: v as RiskCategory })
                  }
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="business">Negocio</SelectItem>
                    <SelectItem value="technical">Tecnico</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Severidade
                </Label>
                <Select
                  value={severity}
                  onValueChange={(v) =>
                    onUpdate({ severity: v as RiskSeverity })
                  }
                >
                  <SelectTrigger
                    className={cn("h-9 text-sm", SEVERITY_TONE_CHIP[severity])}
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
              <div className="grid gap-2">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Funcionalidade relacionada (opcional)
                </Label>
                <Select
                  value={item.relatedFeature || "__none__"}
                  onValueChange={(v) =>
                    onUpdate({
                      relatedFeature:
                        typeof v === "string" && v !== "__none__"
                          ? v
                          : undefined,
                    })
                  }
                >
                  <SelectTrigger className="h-9 text-sm">
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

            <button
              type="button"
              onClick={() => setMitExpanded((v) => !v)}
              className="flex w-full items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
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
                rows={3}
                className="text-sm"
                placeholder={mitigationPlaceholder}
                autoFocus={!hasMitigation}
              />
            ) : null}
          </div>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export { CATEGORY_LABEL, SEVERITY_LABEL };
