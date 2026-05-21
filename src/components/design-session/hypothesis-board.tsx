"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FlaskConical } from "lucide-react";
import type { Hypothesis } from "@/lib/agent/schemas";
import { genId } from "@/lib/utils";

import { BoardColumn, BoardLayout, Chip, StickyCard } from "./board";

export type { Hypothesis };

type HypothesisBoardProps = {
  hypotheses: Hypothesis[];
  onAdd: (h: Hypothesis) => void;
  onUpdate: (id: string, data: Partial<Hypothesis>) => void;
  onDelete: (id: string) => void;
};

export function HypothesisBoard({
  hypotheses,
  onAdd,
  onUpdate,
  onDelete,
}: HypothesisBoardProps) {
  return (
    <BoardLayout cols="single">
      <BoardColumn
        accent="violet"
        icon={<FlaskConical className="size-4" />}
        title="Hipoteses de validacao"
        subtitle="O que precisamos confirmar antes de escalar?"
        count={hypotheses.length}
        countLabel="hipotese"
        emptyIcon={FlaskConical}
        emptyTitle="Nenhuma hipotese ainda"
        emptyHint="Acreditamos que [X] resolve [Y]. Como vamos saber se e verdade?"
        onAdd={(text) =>
          onAdd({
            id: genId(),
            hypothesis: text,
            indicator: "",
            target: "",
            expectedResult: "",
            evidence: "",
          })
        }
        addPlaceholder="Nova hipotese..."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {hypotheses.map((h, i) => (
            <HypothesisCard
              key={h.id}
              index={i}
              hypothesis={h}
              onUpdate={(patch) => onUpdate(h.id, patch)}
              onDelete={() => onDelete(h.id)}
            />
          ))}
        </div>
      </BoardColumn>
    </BoardLayout>
  );
}

function HypothesisCard({
  index,
  hypothesis: h,
  onUpdate,
  onDelete,
}: {
  index: number;
  hypothesis: Hypothesis;
  onUpdate: (patch: Partial<Hypothesis>) => void;
  onDelete: () => void;
}) {
  const hasEvidence = !!h.evidence?.trim();
  const hasIndicator = !!h.indicator?.trim();
  const hasTarget = !!h.target?.trim();

  return (
    <StickyCard
      accent="violet"
      onDelete={onDelete}
      chips={
        <>
          <Chip tone="violet" mono>
            H{index + 1}
          </Chip>
          {hasIndicator ? (
            <Chip truncate>{h.indicator}</Chip>
          ) : null}
        </>
      }
      collapsed={
        <div className="space-y-1.5">
          <p className="line-clamp-3 text-sm leading-snug text-foreground/90">
            {h.hypothesis || (
              <span className="italic text-muted-foreground">
                (sem hipotese — clique pra preencher)
              </span>
            )}
          </p>
          {hasTarget ? (
            <p className="text-[11px] text-muted-foreground">
              Meta: <span className="font-mono">{h.target}</span>
            </p>
          ) : null}
        </div>
      }
      collapsedFooter={
        hasEvidence ? (
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
            evidencia mapeada
          </span>
        ) : null
      }
      expandedBody={
        <div className="space-y-3">
          <div className="grid gap-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Acreditamos que...
            </Label>
            <Textarea
              value={h.hypothesis}
              onChange={(e) => onUpdate({ hypothesis: e.target.value })}
              placeholder="Se oferecermos [X], entao [Y] vai acontecer..."
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Indicador
              </Label>
              <Input
                value={h.indicator}
                onChange={(e) => onUpdate({ indicator: e.target.value })}
                placeholder="taxa de conversao"
                className="h-8 text-xs"
              />
            </div>

            <div className="grid gap-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Meta
              </Label>
              <Input
                value={h.target}
                onChange={(e) => onUpdate({ target: e.target.value })}
                placeholder=">= 25 em 90d"
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Resultado esperado
            </Label>
            <Textarea
              value={h.expectedResult}
              onChange={(e) => onUpdate({ expectedResult: e.target.value })}
              placeholder="Se atingir a meta, o que isso significa? Qual decisao tomamos?"
              rows={2}
              className="text-xs"
            />
          </div>

          <div className="grid gap-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Evidencia requerida
            </Label>
            <Input
              value={h.evidence}
              onChange={(e) => onUpdate({ evidence: e.target.value })}
              placeholder="Como vamos provar? Ex: relatorio da plataforma"
              className="h-8 text-xs"
            />
          </div>
        </div>
      }
    />
  );
}
