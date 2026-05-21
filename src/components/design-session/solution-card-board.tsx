"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
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
  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});
  const [layout, setLayout] = useState<Layout>("triple");
  const [archivedSectionOpen, setArchivedSectionOpen] = useState(false);

  const active = solutions.filter((s) => !s.archived);
  const archived = solutions.filter((s) => !!s.archived);

  const toggleCard = (id: string) =>
    setOpenCards((prev) => ({ ...prev, [id]: !prev[id] }));

  const toggleDetails = (id: string) =>
    setOpenDetails((prev) => ({ ...prev, [id]: !prev[id] }));

  const allActiveOpen =
    active.length > 0 && active.every((s) => openCards[s.id]);

  const expandAllActive = () =>
    setOpenCards((prev) => ({
      ...prev,
      ...Object.fromEntries(active.map((s) => [s.id, true])),
    }));

  const collapseAllActive = () =>
    setOpenCards((prev) => {
      const next = { ...prev };
      for (const s of active) delete next[s.id];
      return next;
    });

  const gridCls =
    layout === "single"
      ? "grid gap-3"
      : "grid gap-3 md:grid-cols-2 lg:grid-cols-3";

  const headerAside = active.length > 0 ? (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={allActiveOpen ? collapseAllActive : expandAllActive}
        className="h-7 text-[10px] uppercase tracking-wider"
      >
        {allActiveOpen ? (
          <>
            <ChevronsDownUp className="size-3 mr-1" /> Recolher
          </>
        ) : (
          <>
            <ChevronsUpDown className="size-3 mr-1" /> Expandir
          </>
        )}
      </Button>
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
    </div>
  ) : undefined;

  // Brainstorm board expands its container based on the user-selected layout:
  // - single mode → max-w 720px (one stack of cards)
  // - triple mode → max-w 1280px (3-col grid breathes properly on widescreen)
  const layoutCols = layout === "single" ? "single" : "triple";

  return (
    <BoardLayout cols={layoutCols} stack>
      <BoardColumn
        accent="amber"
        icon={<Lightbulb className="size-4" />}
        title="Brainstorm de funcionalidades"
        subtitle="Ideias sem filtro — depois a gente prioriza."
        count={active.length}
        countLabel="ideia"
        headerAside={headerAside}
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
          setOpenCards((prev) => ({ ...prev, [id]: true }));
        }}
        addPlaceholder="Nova funcionalidade..."
      >
        <div className={gridCls}>
          {active.map((sol) => (
            <SolutionCardItem
              key={sol.id}
              sol={sol}
              isArchived={false}
              isOpen={!!openCards[sol.id]}
              isDetailsOpen={!!openDetails[sol.id]}
              personaNames={personaNames}
              onToggle={() => toggleCard(sol.id)}
              onToggleDetails={() => toggleDetails(sol.id)}
              onUpdate={(patch) => onUpdate(sol.id, patch)}
              onDelete={() => onDelete(sol.id)}
              onArchive={() => {
                onUpdate(sol.id, { archived: true });
                setOpenCards((prev) => ({ ...prev, [sol.id]: false }));
              }}
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
                  isOpen={!!openCards[sol.id]}
                  isDetailsOpen={!!openDetails[sol.id]}
                  personaNames={personaNames}
                  onToggle={() => toggleCard(sol.id)}
                  onToggleDetails={() => toggleDetails(sol.id)}
                  onUpdate={(patch) => onUpdate(sol.id, patch)}
                  onDelete={() => onDelete(sol.id)}
                  onArchive={() => {
                    onUpdate(sol.id, { archived: true });
                    setOpenCards((prev) => ({ ...prev, [sol.id]: false }));
                  }}
                  onRestore={() => onUpdate(sol.id, { archived: false })}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </BoardLayout>
  );
}

function SolutionCardItem({
  sol,
  isArchived,
  isOpen,
  isDetailsOpen,
  personaNames,
  onToggle,
  onToggleDetails,
  onUpdate,
  onDelete,
  onArchive,
  onRestore,
}: {
  sol: SolutionCard;
  isArchived: boolean;
  isOpen: boolean;
  isDetailsOpen: boolean;
  personaNames: string[];
  onToggle: () => void;
  onToggleDetails: () => void;
  onUpdate: (patch: Partial<SolutionCard>) => void;
  onDelete: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const filled = hasDetails(sol);

  return (
    <StickyCard
      accent={isArchived ? "neutral" : "amber"}
      expanded={isOpen}
      onExpandChange={onToggle}
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
              onClick={onRestore}
              aria-label="Restaurar"
            >
              <ArchiveRestore className="size-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
              onClick={onArchive}
              aria-label="Arquivar"
            >
              <Archive className="size-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            onClick={onToggle}
            aria-label={isOpen ? "Recolher" : "Expandir"}
          >
            {isOpen ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
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
      expandedBody={
        <div className="space-y-3">
          <div className="grid gap-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Titulo
            </Label>
            <Textarea
              value={sol.title}
              onChange={(e) => onUpdate({ title: e.target.value })}
              placeholder="Nome da funcionalidade"
              rows={1}
              className="text-sm font-semibold"
            />
          </div>

          <div className="grid gap-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Detalhes
            </Label>
            <Textarea
              value={sol.howItSolves}
              onChange={(e) => onUpdate({ howItSolves: e.target.value })}
              placeholder="Descreva os detalhes dessa funcionalidade..."
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="grid gap-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Pra qual persona?
            </Label>
            {personaNames.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {personaNames.map((name) => {
                  const active = sol.targetPersona === name;
                  return (
                    <button
                      type="button"
                      key={name}
                      onClick={() => onUpdate({ targetPersona: name })}
                      className={`inline-flex h-6 items-center rounded-full border px-2 text-[11px] transition-colors ${
                        active
                          ? "bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-300"
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
                className="h-8 text-sm"
              />
            )}
          </div>

          <button
            type="button"
            onClick={onToggleDetails}
            className="flex w-full items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            {isDetailsOpen ? (
              <ChevronUp className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
            {isDetailsOpen ? "Menos detalhes" : "Mais detalhes"}
            {filled && !isDetailsOpen ? (
              <span className="ml-1 inline-block size-1.5 rounded-full bg-amber-500" />
            ) : null}
          </button>

          {isDetailsOpen ? (
            <div className="space-y-3 border-t border-border/40 pt-3">
              <div className="grid gap-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Telas / Views
                </Label>
                <Textarea
                  value={sol.keyScreens || ""}
                  onChange={(e) => onUpdate({ keyScreens: e.target.value })}
                  placeholder="Ex: listagem + detalhe + filtros + empty state"
                  rows={2}
                  className="text-xs"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Fluxos do usuario
                </Label>
                <Textarea
                  value={sol.userFlows || ""}
                  onChange={(e) => onUpdate({ userFlows: e.target.value })}
                  placeholder="Ex: usuario busca -> seleciona -> agenda -> confirma"
                  rows={2}
                  className="text-xs"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Dor que resolve (jornada AS-IS)
                </Label>
                <Textarea
                  value={sol.painPointRef || ""}
                  onChange={(e) => onUpdate({ painPointRef: e.target.value })}
                  placeholder="Qual dor da jornada atual essa funcionalidade resolve?"
                  rows={2}
                  className="text-xs"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Consideracoes tecnicas
                </Label>
                <Textarea
                  value={sol.technicalNotes || ""}
                  onChange={(e) => onUpdate({ technicalNotes: e.target.value })}
                  placeholder="APIs, integracoes, migracoes necessarias..."
                  rows={2}
                  className="text-xs"
                />
              </div>
            </div>
          ) : null}
        </div>
      }
    />
  );
}
