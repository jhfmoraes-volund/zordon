"use client";

/**
 * Aba Gestão — master-detail (desktop) / acordeão (mobile).
 *
 * Organiza por projeto (sidebar/nav) com timeline de TODAS as sprints no painel.
 * Contrato C2 (ProjectMember) editável no header; override C3 (SprintMember)
 * editável inline em cada semana. Sinais #3 (planejado vs contrato efetivo) e
 * denominador duplo (% do contrato total do builder) visíveis em cada linha.
 *
 * Toda mutação é otimista — a page passa onContractChange/onOverrideChange que
 * disparam useOptimisticCollection. Os componentes aqui são puros de UI.
 */

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, RotateCcw, Pencil, Check, X, KanbanSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PixelBar, PixelDot, PixelHud, pixelTone } from "@/components/ui/pixel-bar";
import { OK_GREEN, WARN_RED, AMBER, type ProjectFlag } from "./types";

// ─── Tipos de UI (a page monta a partir do payload) ─────

export type WeekView = {
  sprintId: string;
  projectId: string;
  weekStart: string;   // "dd/mm" já formatado
  weekEnd: string;
  isCurrent: boolean;
  isPast: boolean;
  contract: number;        // C2 efetivo da semana (sem override)
  override: number | null; // C3
  planned: number;
  done: number;
  open: number;
  sprintName: string;
  sprintStatus: string;
};

export type ProjectView = {
  id: string;
  name: string;
  contract: number; // C2 macro
  weeks: WeekView[];
};

const effective = (w: WeekView) => w.override ?? w.contract;

export function projectFlag(p: ProjectView): { flag: ProjectFlag; planned: number; budget: number } {
  const cur = p.weeks.find((w) => w.isCurrent);
  const planned = cur?.planned ?? 0;
  const budget = cur ? effective(cur) : p.contract;
  if (budget > 0 && planned > budget) return { flag: "over", planned, budget };
  if (planned === 0 && budget > 0) return { flag: "idle", planned, budget };
  return { flag: "ok", planned, budget };
}

// ─── Sidebar nav item (desktop) ──────────────────────────

export function ProjectNavItem({
  project, totalCapacity, active, canEdit, onClick, onContractChange,
}: {
  project: ProjectView;
  totalCapacity: number;
  active: boolean;
  canEdit: boolean;
  onClick: () => void;
  onContractChange: (v: number) => void;
}) {
  const { flag, planned, budget } = projectFlag(project);
  const ratio = budget > 0 ? planned / budget : 0;
  const tone = pixelTone(ratio * 100, "load");
  const shareOfTotal = totalCapacity > 0 ? Math.round((project.contract / totalCapacity) * 100) : 0;
  const overShare = shareOfTotal > 100; // contrato deste projeto sozinho já passa do total

  // O item é clicável (seleciona o projeto), mas tem um input editável dentro.
  // Por isso é <div role=button> — não <button> (input aninhado é HTML inválido).
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={`w-full cursor-pointer space-y-1.5 rounded-lg border p-2.5 text-left transition-colors ${
        active ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-muted/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate text-sm font-medium">{project.name}</span>
        {flag === "over" && <span title="trabalhou acima do contrato" style={{ color: WARN_RED }}>⚠</span>}
        {flag === "idle" && <span title="ocioso" className="opacity-60">💤</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <div className="flex-1"><PixelBar score={Math.min(ratio * 100, 100)} cells={14} height={6} variant="load" /></div>
        <span className="w-12 text-right font-mono text-[10px] tabular-nums" style={{ color: tone.fg }}>{Math.round(ratio * 100)}%</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        {/* contrato editável inline — número destacado, label muted */}
        <span className="inline-flex items-baseline gap-1">
          <InlineContract value={project.contract} canEdit={canEdit} onCommit={onContractChange} />
          <span className="text-[10px] text-muted-foreground">FP/sprint</span>
        </span>
        <span
          title={overShare ? "este contrato sozinho já passa do contrato total do builder" : "fração do contrato total do builder"}
          className="font-mono text-[10px] tabular-nums text-muted-foreground"
          style={{ color: overShare ? WARN_RED : undefined }}
        >
          {overShare && "⚠ "}{shareOfTotal}% do total
        </span>
      </div>
    </div>
  );
}

/** Número de contrato editável inline (sem abrir o painel). */
function InlineContract({
  value, canEdit, onCommit,
}: {
  value: number;
  canEdit: boolean;
  onCommit: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  if (!canEdit) {
    return <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{value}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setDraft(String(value)); setEditing(true); }}
        className="rounded px-1 font-mono text-sm font-semibold tabular-nums text-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 transition-colors hover:bg-muted/60"
        title="Editar contrato"
      >
        {value}
      </button>
    );
  }

  const commit = () => {
    const n = Number(draft);
    if (!Number.isNaN(n) && n >= 0 && n !== value) onCommit(n);
    setEditing(false);
  };

  return (
    <Input
      type="number" min={0} max={2000} autoFocus value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
      className="h-6 w-14 px-1.5 text-right font-mono text-sm font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}

// ─── Detail panel (desktop) ──────────────────────────────

export function ProjectDetailPanel({
  project, totalCapacity, canEdit, onContractChange, onOverrideChange,
}: {
  project: ProjectView;
  totalCapacity: number;
  canEdit: boolean;
  onContractChange: (v: number) => void;
  onOverrideChange: (sprintId: string, v: number | null) => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <ProjectHeader project={project} totalCapacity={totalCapacity} canEdit={canEdit} onContractChange={onContractChange} />
        <Timeline project={project} totalCapacity={totalCapacity} canEdit={canEdit} onOverrideChange={onOverrideChange} />
      </CardContent>
    </Card>
  );
}

// ─── Mobile card (acordeão) ──────────────────────────────

export function MobileProjectCard({
  project, totalCapacity, canEdit, onContractChange, onOverrideChange,
}: {
  project: ProjectView;
  totalCapacity: number;
  canEdit: boolean;
  onContractChange: (v: number) => void;
  onOverrideChange: (sprintId: string, v: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const { flag, planned, budget } = projectFlag(project);
  const ratio = budget > 0 ? planned / budget : 0;
  const tone = pixelTone(ratio * 100, "load");

  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full space-y-2 p-3 text-left">
        <div className="flex items-center gap-2">
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="flex-1 font-medium">{project.name}</span>
          {flag === "over" && <PixelHud size="xs" style={{ color: WARN_RED }}>⚠ {ratio.toFixed(2)}×</PixelHud>}
          {flag === "idle" && <PixelHud size="xs" tone="muted">💤 ocioso</PixelHud>}
          {flag === "ok" && <PixelHud size="xs" style={{ color: OK_GREEN }}>✓</PixelHud>}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1"><PixelBar score={Math.min(ratio * 100, 100)} cells={18} height={8} variant="load" /></div>
          <span className="w-20 text-right font-mono text-[10px] tabular-nums">
            <span style={{ color: tone.fg }}>{planned}</span><span className="text-muted-foreground"> / {budget}</span>
          </span>
        </div>
      </button>
      {open && (
        <CardContent className="space-y-4 border-t border-foreground/5 bg-background/40 pt-4">
          <ProjectHeader project={project} totalCapacity={totalCapacity} canEdit={canEdit} onContractChange={onContractChange} />
          <Timeline project={project} totalCapacity={totalCapacity} canEdit={canEdit} onOverrideChange={onOverrideChange} />
        </CardContent>
      )}
    </Card>
  );
}

// ─── Project header (contrato C2 + share executivo) ──────

function ProjectHeader({
  project, totalCapacity, canEdit, onContractChange,
}: {
  project: ProjectView;
  totalCapacity: number;
  canEdit: boolean;
  onContractChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(project.contract));
  const [saved, setSaved] = useState(false);
  const shareOfTotal = totalCapacity > 0 ? Math.round((project.contract / totalCapacity) * 100) : 0;

  const commit = () => {
    const next = Number(draft);
    if (!Number.isNaN(next) && next >= 0 && next !== project.contract) {
      onContractChange(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    }
    setEditing(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold leading-tight">{project.name}</h2>
          <p className="text-[11px] text-muted-foreground">
            consome <span className="font-mono tabular-nums text-foreground">{shareOfTotal}%</span> do contrato total do builder
          </p>
        </div>
        {/* contrato — número discreto, vira campo só ao focar */}
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">contrato</span>
          {!canEdit ? (
            <span className="font-mono text-lg font-semibold tabular-nums">{project.contract}</span>
          ) : editing ? (
            <Input
              type="number" min={0} max={2000} autoFocus value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") setEditing(false);
              }}
              className="h-7 w-16 px-1.5 text-right font-mono text-base tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => { setDraft(String(project.contract)); setEditing(true); }}
              title="Editar contrato"
              className="rounded px-1 font-mono text-lg font-semibold tabular-nums underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              {project.contract}
            </button>
          )}
          <span className="text-[10px] leading-none text-muted-foreground">FP/sprint</span>
          {saved && <Check className="h-3.5 w-3.5 text-green-500" />}
        </div>
      </div>
      <p className="rounded-md border border-dashed border-foreground/10 px-3 py-1.5 text-[11px] text-muted-foreground">
        Editar <strong>contrato</strong> afeta <strong>todas as sprints</strong> deste projeto. Para uma semana específica, use o <strong>override</strong> na timeline.
      </p>
    </div>
  );
}

// ─── Timeline ────────────────────────────────────────────

function Timeline({
  project, totalCapacity, canEdit, onOverrideChange,
}: {
  project: ProjectView;
  totalCapacity: number;
  canEdit: boolean;
  onOverrideChange: (sprintId: string, v: number | null) => void;
}) {
  const [showPast, setShowPast] = useState(false);
  const past = project.weeks.filter((w) => w.isPast);
  const rest = project.weeks.filter((w) => !w.isPast);

  return (
    <div className="space-y-1.5">
      <PixelHud size="xs" tone="muted">timeline · todas as sprints</PixelHud>
      {project.weeks.length === 0 && (
        <p className="text-sm text-muted-foreground">Sem sprints neste projeto ainda.</p>
      )}
      {past.length > 0 && (
        <>
          <button type="button" onClick={() => setShowPast((v) => !v)} className="text-[11px] text-muted-foreground hover:text-foreground">
            {showPast ? "▾ ocultar" : "▸ ver"} {past.length} semana{past.length === 1 ? "" : "s"} passada{past.length === 1 ? "" : "s"}
          </button>
          {showPast && past.map((w) => (
            <WeekRow key={w.sprintId} week={w} contract={project.contract} totalCapacity={totalCapacity} canEdit={canEdit} onOverrideChange={onOverrideChange} isPast />
          ))}
        </>
      )}
      {rest.map((w) => (
        <WeekRow key={w.sprintId} week={w} contract={project.contract} totalCapacity={totalCapacity} canEdit={canEdit} onOverrideChange={onOverrideChange} highlight={w.isCurrent} />
      ))}
    </div>
  );
}

// ─── WeekRow ─────────────────────────────────────────────

function WeekRow({
  week, contract, totalCapacity, canEdit, onOverrideChange, highlight, isPast,
}: {
  week: WeekView;
  contract: number;
  totalCapacity: number;
  canEdit: boolean;
  onOverrideChange: (sprintId: string, v: number | null) => void;
  highlight?: boolean;
  isPast?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(week.override ?? contract));

  const budget = effective(week);
  const ratio = budget > 0 ? week.planned / budget : 0;
  const tone = pixelTone(ratio * 100, "load");
  const hasOverride = week.override != null;
  const over = budget > 0 && week.planned > budget;
  const shareWeek = totalCapacity > 0 ? Math.round((budget / totalCapacity) * 100) : 0;

  const commit = () => {
    const n = Number(draft);
    onOverrideChange(week.sprintId, Number.isNaN(n) || n < 0 ? null : n);
    setEditing(false);
  };

  return (
    <div className={`surface-inset space-y-1.5 p-2.5 ${isPast ? "opacity-50" : ""} ${highlight ? "ring-1 ring-primary/30" : ""}`}>
      {/* linha 1: semana + sprint + override controls */}
      <div className="flex items-center gap-2">
        {highlight && <Badge className="border-green-500/30 bg-green-500/20 text-green-400 hover:bg-green-500/20">atual</Badge>}
        <span className="font-mono text-xs tabular-nums">{week.weekStart} — {week.weekEnd}</span>
        <span className="truncate text-[11px] text-muted-foreground">· {week.sprintName} ({week.sprintStatus})</span>
        <div className="ml-auto flex items-center gap-1.5">
          {hasOverride && !editing && (
            <span className="rounded bg-amber-500/20 px-1 font-mono text-[9px] uppercase tracking-wider text-amber-500">ovr</span>
          )}
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => { setDraft(String(week.override ?? contract)); setEditing(true); }}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <Pencil className="h-3 w-3" /> {hasOverride ? "editar" : "override"}
            </button>
          )}
          {canEdit && editing && (
            <div className="flex items-center gap-1">
              <Input
                type="number" min={0} max={2000} autoFocus value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
                className="h-6 w-16 text-right font-mono text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button type="button" onClick={commit} className="rounded p-1 text-green-500 hover:bg-green-500/10" aria-label="Confirmar"><Check className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => setEditing(false)} className="rounded p-1 text-muted-foreground hover:bg-muted/50" aria-label="Cancelar"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
          {canEdit && hasOverride && !editing && (
            <button type="button" onClick={() => onOverrideChange(week.sprintId, null)} className="rounded p-1 text-muted-foreground hover:bg-muted/50" aria-label="Remover override"><RotateCcw className="h-3 w-3" /></button>
          )}
        </div>
      </div>

      {/* linha 2: barra utilização (planned / budget efetivo) */}
      <div className="flex items-center gap-2">
        <div className="flex-1"><PixelBar score={Math.min(ratio * 100, 100)} cells={20} height={8} variant="load" /></div>
        <span className="w-28 text-right font-mono text-[10px] tabular-nums">
          <span style={{ color: tone.fg }}>{week.planned}</span>
          <span className="text-muted-foreground"> / {budget}</span>
          {over && <span style={{ color: WARN_RED }}> ⚠</span>}
        </span>
      </div>

      {/* linha 3: realidade done/open + share + board */}
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1"><PixelDot variant="done" size={6} /> <span className="font-mono tabular-nums">{week.done} entregue</span></span>
          <span className="inline-flex items-center gap-1"><PixelDot variant="open" size={6} /> <span className="font-mono tabular-nums">{week.open} aberto</span></span>
          {hasOverride && <span style={{ color: AMBER }} className="font-mono">contrato base {contract}</span>}
        </span>
        <span className="inline-flex items-center gap-2">
          <span title="fração do contrato total nesta semana" className="font-mono tabular-nums">{shareWeek}% do total</span>
          <Link
            href={`/projects/${week.projectId}?tab=sprints&sprint=${week.sprintId}`}
            prefetch={false}
            aria-label="Abrir board do sprint"
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted/50 hover:text-foreground"
          >
            <KanbanSquare className="h-3 w-3" /> board
          </Link>
        </span>
      </div>
    </div>
  );
}
