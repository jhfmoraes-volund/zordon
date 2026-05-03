"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { MemberBattery } from "@/components/member-battery";
import { PixelDot } from "@/components/ui/pixel-bar";
import { roleLabel, hasMinLevel, ADMIN } from "@/lib/roles";
import { AlertTriangle, Battery, Loader2, Lock, Zap } from "lucide-react";

type MemberCapacity = {
  id: string;
  name: string;
  role: string;
  position: string | null;
  fpCapacity: number;
  fpThisProject: number;
  fpOtherProjects: number;
  fpTotal: number;
  totalPct: number;
  isOverloaded: boolean;
  fpAllocation: number;
  fpAllocationOther: number;
  fpAllocationTotal: number;
  /** Planejado nas sprints active+planning desse projeto (status ≠ backlog) */
  fpPlannedActiveSprints: number;
  fpDoneActiveSprints: number;
  fpOpenActiveSprints: number;
};

// ─── Segmented PixelBar ──────────────────────────────────
// Uma barra estilo arcade com 2 segmentos coloridos + cells vazias.
// "here"  → tom de destaque (este projeto)
// "other" → tom muted (outros projetos, contexto)
// "empty" → célula apagada (capacity livre)

type Segment = { value: number; kind: "here" | "other" };

function SegmentedPixelBar({
  segments,
  total,
  cells = 24,
  height = 10,
}: {
  segments: Segment[];
  total: number;
  cells?: number;
  height?: number;
}) {
  const safeTotal = Math.max(total, 1);
  const here = segments.find((s) => s.kind === "here")?.value ?? 0;
  const other = segments.find((s) => s.kind === "other")?.value ?? 0;
  const overcommit = here + other > safeTotal;

  // proporcional em cells; arredonda preservando soma <= cells
  const hereCells = Math.min(cells, Math.round((here / safeTotal) * cells));
  const otherCellsRaw = Math.round((other / safeTotal) * cells);
  const otherCells = Math.min(cells - hereCells, otherCellsRaw);

  const HERE = "oklch(0.7 0.16 65)"; // amber/orange — destaque
  const HERE_GLOW = "oklch(0.7 0.16 65 / 0.45)";
  const OTHER = "oklch(0.55 0.04 250)"; // slate dessaturado
  const OTHER_GLOW = "oklch(0.55 0.04 250 / 0.25)";
  const OVER = "oklch(0.637 0.237 22)"; // vermelho — usado se overcommit
  const OVER_GLOW = "oklch(0.637 0.237 22 / 0.55)";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cells}, 1fr)`,
        gap: 2,
        padding: 2,
        height,
        background: "oklch(0.1 0 0)",
        borderRadius: 3,
        boxShadow:
          "inset 0 0 0 1px oklch(1 0 0 / 0.08), inset 0 1px 0 oklch(0 0 0 / 0.6)",
      }}
    >
      {Array.from({ length: cells }).map((_, i) => {
        let bg = "oklch(1 0 0 / 0.04)";
        let glow = "transparent";
        let on = false;
        if (i < hereCells) {
          bg = overcommit ? OVER : HERE;
          glow = overcommit ? OVER_GLOW : HERE_GLOW;
          on = true;
        } else if (i < hereCells + otherCells) {
          bg = OTHER;
          glow = OTHER_GLOW;
          on = true;
        }
        return (
          <div
            key={i}
            style={{
              background: bg,
              borderRadius: 1,
              boxShadow: on
                ? `inset 0 1px 0 oklch(1 0 0 / 0.25), 0 0 4px ${glow}`
                : "inset 0 0 0 1px oklch(0 0 0 / 0.4)",
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Tab principal ──────────────────────────────────────

export function ProjectCapacityTab({
  projectId,
  memberCapacity,
  viewerRole,
  onRefresh,
}: {
  projectId: string;
  memberCapacity: MemberCapacity[];
  viewerRole: string | null;
  onRefresh: () => void;
}) {
  const canEdit = hasMinLevel(viewerRole, ADMIN);

  const sorted = [...memberCapacity].sort((a, b) => {
    if (a.isOverloaded !== b.isOverloaded) return a.isOverloaded ? -1 : 1;
    const aPct = a.fpAllocationTotal / Math.max(a.fpCapacity, 1);
    const bPct = b.fpAllocationTotal / Math.max(b.fpCapacity, 1);
    return bPct - aPct;
  });

  const totalAllocatedHere = memberCapacity.reduce((s, m) => s + m.fpAllocation, 0);
  const projectAvailableCapacity = memberCapacity.reduce(
    (s, m) => s + Math.max(m.fpCapacity - m.fpAllocationOther, 0),
    0,
  );

  if (memberCapacity.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Nenhum membro alocado a este projeto. Use o botão de configurações pra adicionar membros ao squad.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header: project-scoped capacity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Battery className="h-3.5 w-3.5" />
            Capacity do projeto
            {!canEdit && (
              <StatusChip tone="muted" size="sm" className="ml-2">
                <Lock className="h-3 w-3" />
                read-only
              </StatusChip>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <MemberBattery
            capacity={projectAvailableCapacity}
            committed={totalAllocatedHere}
            size="md"
          />
          <p className="text-xs text-muted-foreground">
            Capacity disponível pra este projeto, descontando o que cada pessoa já tem em outros projetos.
            {!canEdit && " Pra ajustar a alocação de algum membro, peça pra um admin (Head Ops ou CEO)."}
          </p>
        </CardContent>
      </Card>

      {/* List of members */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Membros alocados</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* legenda */}
          <div className="flex items-center gap-4 px-4 py-2 border-b border-foreground/5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <LegendDot color="oklch(0.7 0.16 65)" label="aqui" />
            <LegendDot color="oklch(0.55 0.04 250)" label="outros projetos" />
            <LegendDot color="transparent" label="livre" outline />
          </div>
          <ul>
            {sorted.map((m, idx) => (
              <li
                key={m.id}
                className={`px-4 py-3 ${idx > 0 ? "border-t border-foreground/5" : ""}`}
              >
                <MemberCapacityRow
                  projectId={projectId}
                  member={m}
                  canEdit={canEdit}
                  onSaved={onRefresh}
                />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function LegendDot({ color, label, outline }: { color: string; label: string; outline?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="size-2 rounded-[2px]"
        style={{
          background: outline ? "transparent" : color,
          boxShadow: outline ? "inset 0 0 0 1px oklch(1 0 0 / 0.2)" : undefined,
        }}
      />
      {label}
    </span>
  );
}

// ─── Linha de membro ────────────────────────────────────

function MemberCapacityRow({
  projectId,
  member,
  canEdit,
  onSaved,
}: {
  projectId: string;
  member: MemberCapacity;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const free = Math.max(member.fpCapacity - member.fpAllocationTotal, 0);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* Identity */}
      <div className="flex items-center gap-2 min-w-0 w-full md:w-56 md:shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="font-medium truncate">{member.name}</p>
            {member.isOverloaded && (
              <span title={`${Math.round(member.totalPct * 100)}% de capacity total (inclui outros projetos)`}>
                <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">{roleLabel(member.position)}</p>
        </div>
        {member.isOverloaded && (
          <StatusChip tone="red" size="sm" className="shrink-0">overloaded</StatusChip>
        )}
      </div>

      {/* Bar */}
      <div className="flex-1 min-w-[200px]">
        <SegmentedPixelBar
          segments={[
            { kind: "here", value: member.fpAllocation },
            { kind: "other", value: member.fpAllocationOther },
          ]}
          total={member.fpCapacity}
          cells={28}
          height={12}
        />
      </div>

      {/* Numbers */}
      <div className="flex items-center gap-2 text-xs tabular-nums shrink-0">
        <span>
          <span className="font-mono font-semibold text-foreground">{member.fpAllocation}</span>
          <span className="text-muted-foreground"> aqui</span>
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span>
          <span className="font-mono text-muted-foreground">{member.fpAllocationOther}</span>
          <span className="text-muted-foreground"> outros</span>
        </span>
        <span className="text-muted-foreground/40">·</span>
        <span>
          <span className="font-mono text-muted-foreground">{free}</span>
          <span className="text-muted-foreground"> livre</span>
        </span>
      </div>

      {/* Planejado nas sprints active+planning vs contrato aqui */}
      <span
        className="inline-flex items-center gap-1 text-xs tabular-nums shrink-0"
        title={`Planejado nas sprints ativas (${member.fpPlannedActiveSprints} FP) vs contrato aqui (${member.fpAllocation} FP)`}
      >
        <Zap className="h-3 w-3 text-amber-500" />
        <span className="font-mono font-semibold text-foreground">
          {member.fpPlannedActiveSprints}
        </span>
        <span className="text-muted-foreground">/ {member.fpAllocation}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums inline-flex items-center gap-1">
          <PixelDot variant="done" size={6} />
          {member.fpDoneActiveSprints}
          <PixelDot variant="open" size={6} />
          {member.fpOpenActiveSprints}
        </span>
      </span>

      {/* Editor */}
      <AllocationEditor
        projectId={projectId}
        memberId={member.id}
        currentValue={member.fpAllocation}
        canEdit={canEdit}
        onSaved={onSaved}
      />
    </div>
  );
}

function AllocationEditor({
  projectId,
  memberId,
  currentValue,
  canEdit,
  onSaved,
}: {
  projectId: string;
  memberId: string;
  currentValue: number;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(String(currentValue));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = Number(value) !== currentValue;

  const save = async () => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      setError("Valor inválido");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fpAllocation: num }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(d.error || "Falha ao salvar");
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit) {
    return (
      <span className="text-xs text-muted-foreground shrink-0">
        <span className="font-mono tabular-nums text-foreground">{currentValue}</span> FP/sem
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <Input
        type="number"
        min={0}
        step={1}
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setValue(String(currentValue));
        }}
        className="h-7 w-16 text-right font-mono text-sm tabular-nums"
        title="FP/semana alocados nesta pessoa pra este projeto"
      />
      <Button
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={!dirty || saving}
        onClick={save}
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "salvar"}
      </Button>
      {error && (
        <span className="text-xs text-red-500 ml-1" title={error}>!</span>
      )}
    </div>
  );
}
