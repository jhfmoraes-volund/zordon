"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  ChevronDown,
  ChevronUp,
  List,
  LayoutGrid,
  Archive,
  ArchiveRestore,
  Lightbulb,
  Trash2,
} from "lucide-react";
import type { SolutionCard } from "@/lib/agent/schemas";
import { genId } from "@/lib/utils";

import { BoardColumn, BoardLayout, Chip, StickyCard } from "./board";

export type { SolutionCard };

type SolutionCardBoardProps = {
  solutions: SolutionCard[];
  onAdd: (solution: SolutionCard) => void;
  onUpdate: (id: string, data: Partial<SolutionCard>) => void;
  onDelete: (id: string) => void;
  personaNames: string[];
};

type Layout = "single" | "triple";

function hasDetails(sol: SolutionCard) {
  return !!(
    sol.keyScreens ||
    sol.userFlows ||
    sol.painPointRef ||
    sol.technicalNotes
  );
}

export function SolutionCardBoard({
  solutions,
  onAdd,
  onUpdate,
  onDelete,
  personaNames,
}: SolutionCardBoardProps) {
  // Only ONE card may be in "edit" state at a time, and edit lives in a
  // centered dialog (Notion-style). The grid stays untouched while editing,
  // so rows don't reflow.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>("triple");
  const [archivedSectionOpen, setArchivedSectionOpen] = useState(false);

  const active = solutions.filter((s) => !s.archived);
  const archived = solutions.filter((s) => !!s.archived);

  const gridCls =
    layout === "single"
      ? "grid gap-3"
      : "grid gap-3 md:grid-cols-2 lg:grid-cols-3";

  const editingSolution =
    solutions.find((s) => s.id === editingId) ?? null;

  const headerAside = (
    <div className="inline-flex rounded-md border bg-background">
      <Button
        type="button"
        variant={layout === "single" ? "secondary" : "ghost"}
        size="icon"
        className="size-7 rounded-r-none"
        onClick={() => setLayout("single")}
        aria-label="Uma coluna"
      >
        <List className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant={layout === "triple" ? "secondary" : "ghost"}
        size="icon"
        className="size-7 rounded-l-none"
        onClick={() => setLayout("triple")}
        aria-label="Grid"
      >
        <LayoutGrid className="size-3.5" />
      </Button>
    </div>
  );

  // Brainstorm board expands its container based on the user-selected layout:
  // - single mode → max-w 720px
  // - triple mode → max-w 1280px
  const layoutCols = layout === "single" ? "single" : "triple";

  return (
    <>
      <BoardLayout cols={layoutCols} stack>
        <BoardColumn
          accent="amber"
          icon={<Lightbulb className="size-4" />}
          title="Brainstorm de funcionalidades"
          subtitle="Ideias sem filtro — depois a gente prioriza."
          count={active.length}
          countLabel="ideia"
          headerAside={active.length > 0 ? headerAside : undefined}
          emptyIcon={Lightbulb}
          emptyTitle="Sem ideias ainda"
          emptyHint="Vale tudo. O filtro acontece na priorizacao."
          onAdd={(text) => {
            const id = genId();
            onAdd({
              id,
              title: text,
              howItSolves: "",
              targetPersona: "",
            });
            // Open the dialog immediately so the user can flesh out the new
            // idea — same UX as the previous "expand on add" behavior.
            setEditingId(id);
          }}
          addPlaceholder="Nova funcionalidade..."
        >
          <div className={gridCls}>
            {active.map((sol) => (
              <SolutionCardItem
                key={sol.id}
                sol={sol}
                isArchived={false}
                onOpen={() => setEditingId(sol.id)}
                onDelete={() => onDelete(sol.id)}
                onArchive={() => onUpdate(sol.id, { archived: true })}
                onRestore={() => onUpdate(sol.id, { archived: false })}
              />
            ))}
          </div>
        </BoardColumn>

        {archived.length > 0 ? (
          <div className="mx-auto max-w-none">
            <button
              type="button"
              onClick={() => setArchivedSectionOpen((v) => !v)}
              className="flex items-center gap-2 border-t pt-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {archivedSectionOpen ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
              <Archive className="size-3.5" />
              Arquivadas
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono tabular-nums">
                {archived.length}
              </span>
            </button>

            {archivedSectionOpen ? (
              <div className={`mt-3 ${gridCls}`}>
                {archived.map((sol) => (
                  <SolutionCardItem
                    key={sol.id}
                    sol={sol}
                    isArchived
                    onOpen={() => setEditingId(sol.id)}
                    onDelete={() => onDelete(sol.id)}
                    onArchive={() => onUpdate(sol.id, { archived: true })}
                    onRestore={() => onUpdate(sol.id, { archived: false })}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </BoardLayout>

      <SolutionEditDialog
        sol={editingSolution}
        personaNames={personaNames}
        onClose={() => setEditingId(null)}
        onUpdate={(patch) => {
          if (editingSolution) onUpdate(editingSolution.id, patch);
        }}
      />
    </>
  );
}

// ─── SolutionCardItem ──────────────────────────────────────
// Always-collapsed card on the grid. Click opens the dialog. Trash + Archive
// stay accessible via top-right actions.

function SolutionCardItem({
  sol,
  isArchived,
  onOpen,
  onDelete,
  onArchive,
  onRestore,
}: {
  sol: SolutionCard;
  isArchived: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const filled = hasDetails(sol);

  // Stop click propagation on action buttons so they don't also open the
  // dialog when clicked.
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
      className="cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-lg h-full"
    >
      <StickyCard
        accent={isArchived ? "neutral" : "amber"}
        // Fixed card height keeps every card on the grid uniform — titles
        // and descriptions get truncated consistently instead of producing
        // a jagged row of mismatched heights.
        className="h-[160px]"
        chips={
          <>
            {sol.targetPersona ? (
              <Chip mono truncate>
                {sol.targetPersona}
              </Chip>
            ) : null}
            {filled ? (
              <span
                className="inline-block size-1.5 rounded-full bg-amber-500"
                title="Tem detalhes preenchidos"
              />
            ) : null}
          </>
        }
        actions={
          <>
            {isArchived ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                onClick={stop(onRestore)}
                aria-label="Restaurar"
              >
                <ArchiveRestore className="size-3.5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                onClick={stop(onArchive)}
                aria-label="Arquivar"
              >
                <Archive className="size-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              onClick={stop(onDelete)}
              aria-label="Excluir"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        }
        collapsed={
          <div className="space-y-1">
            <p
              className={`line-clamp-2 text-sm font-medium leading-snug ${
                isArchived ? "text-muted-foreground" : "text-foreground/90"
              }`}
            >
              {sol.title || (
                <span className="italic text-muted-foreground">Sem titulo</span>
              )}
            </p>
            {sol.howItSolves ? (
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {sol.howItSolves}
              </p>
            ) : null}
          </div>
        }
      />
    </div>
  );
}

// ─── SolutionEditDialog ────────────────────────────────────
// Notion-style centered modal. Title is the large heading at top; remaining
// fields are stacked below with a clear "Mais detalhes" accordion for the
// optional design/tech notes.

function SolutionEditDialog({
  sol,
  personaNames,
  onClose,
  onUpdate,
}: {
  sol: SolutionCard | null;
  personaNames: string[];
  onClose: () => void;
  onUpdate: (patch: Partial<SolutionCard>) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(true);
  const open = sol !== null;
  const filled = sol ? hasDetails(sol) : false;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setDetailsOpen(true);
          onClose();
        }
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-2xl">
        {sol ? (
          <div className="flex flex-col gap-5 p-2 sm:p-4">
            {/* Notion-style large title input. Borderless, font-heading. */}
            <div>
              <ResponsiveDialogTitle className="sr-only">
                {sol.title || "Funcionalidade sem titulo"}
              </ResponsiveDialogTitle>
              <textarea
                value={sol.title}
                onChange={(e) => onUpdate({ title: e.target.value })}
                rows={1}
                placeholder="Nome da funcionalidade"
                className="w-full resize-none bg-transparent font-heading text-3xl font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground/50 field-sizing-content"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Detalhes
              </Label>
              <Textarea
                value={sol.howItSolves}
                onChange={(e) => onUpdate({ howItSolves: e.target.value })}
                placeholder="Descreva os detalhes dessa funcionalidade..."
                rows={3}
                className="text-sm"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Pra qual persona?
              </Label>
              {personaNames.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {personaNames.map((name) => {
                    const active = sol.targetPersona === name;
                    return (
                      <button
                        type="button"
                        key={name}
                        onClick={() =>
                          onUpdate({
                            targetPersona: active ? "" : name,
                          })
                        }
                        className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs transition-colors ${
                          active
                            ? "border-amber-500/40 bg-amber-500/20 text-amber-700 dark:text-amber-300"
                            : "border-border/60 bg-background/60 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Input
                  value={sol.targetPersona}
                  onChange={(e) => onUpdate({ targetPersona: e.target.value })}
                  placeholder="Nome da persona"
                  className="h-9 text-sm"
                />
              )}
            </div>

            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="flex w-full items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
            >
              {detailsOpen ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
              {detailsOpen ? "Menos detalhes" : "Mais detalhes"}
              {filled && !detailsOpen ? (
                <span className="ml-1 inline-block size-1.5 rounded-full bg-amber-500" />
              ) : null}
            </button>

            {detailsOpen ? (
              <div className="space-y-4 border-t border-border/40 pt-4">
                <div className="grid gap-2">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Telas / Views
                  </Label>
                  <Textarea
                    value={sol.keyScreens || ""}
                    onChange={(e) => onUpdate({ keyScreens: e.target.value })}
                    placeholder="Ex: listagem + detalhe + filtros + empty state"
                    rows={2}
                    className="text-sm"
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Fluxos do usuario
                  </Label>
                  <Textarea
                    value={sol.userFlows || ""}
                    onChange={(e) => onUpdate({ userFlows: e.target.value })}
                    placeholder="Ex: usuario busca -> seleciona -> agenda -> confirma"
                    rows={2}
                    className="text-sm"
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Dor que resolve (jornada AS-IS)
                  </Label>
                  <Textarea
                    value={sol.painPointRef || ""}
                    onChange={(e) => onUpdate({ painPointRef: e.target.value })}
                    placeholder="Qual dor da jornada atual essa funcionalidade resolve?"
                    rows={2}
                    className="text-sm"
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Consideracoes tecnicas
                  </Label>
                  <Textarea
                    value={sol.technicalNotes || ""}
                    onChange={(e) =>
                      onUpdate({ technicalNotes: e.target.value })
                    }
                    placeholder="APIs, integracoes, migracoes necessarias..."
                    rows={2}
                    className="text-sm"
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
