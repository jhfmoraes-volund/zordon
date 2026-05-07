"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  List,
  LayoutGrid,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import type { SolutionCard } from "@/lib/agent/schemas";

export type { SolutionCard };

type SolutionCardBoardProps = {
  solutions: SolutionCard[];
  onAdd: (solution: SolutionCard) => void;
  onUpdate: (id: string, data: Partial<SolutionCard>) => void;
  onDelete: (id: string) => void;
  personaNames: string[];
};

type Layout = "single" | "triple";

import { genId } from "@/lib/utils";

function hasDetails(sol: SolutionCard) {
  return !!(sol.keyScreens || sol.userFlows || sol.painPointRef || sol.technicalNotes);
}

export function SolutionCardBoard({
  solutions,
  onAdd,
  onUpdate,
  onDelete,
  personaNames,
}: SolutionCardBoardProps) {
  const [newTitle, setNewTitle] = useState("");
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

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    const id = genId();
    onAdd({
      id,
      title: newTitle.trim(),
      howItSolves: "",
      targetPersona: "",
    });
    setOpenCards((prev) => ({ ...prev, [id]: true }));
    setNewTitle("");
  };

  const handleArchive = (id: string) => {
    onUpdate(id, { archived: true });
    setOpenCards((prev) => ({ ...prev, [id]: false }));
  };

  const handleRestore = (id: string) => {
    onUpdate(id, { archived: false });
  };

  const gridCls =
    layout === "single"
      ? "grid gap-3"
      : "grid gap-3 md:grid-cols-2 lg:grid-cols-3";

  const renderCard = (sol: SolutionCard, isArchived: boolean) => {
    const isOpen = openCards[sol.id] || false;
    const isDetailsOpen = openDetails[sol.id] || false;
    const filled = hasDetails(sol);

    const cardBg = isArchived
      ? "bg-muted/40 opacity-75 hover:opacity-95"
      : "bg-yellow-500/10";

    if (!isOpen) {
      return (
        <Card
          key={sol.id}
          role="button"
          tabIndex={0}
          onClick={() => toggleCard(sol.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleCard(sol.id);
            }
          }}
          className={`${cardBg} cursor-pointer ${
            isArchived ? "" : "hover:bg-yellow-500/20"
          } transition-colors`}
        >
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start gap-2">
              <Lightbulb
                className={`h-4 w-4 mt-0.5 shrink-0 ${
                  isArchived ? "text-muted-foreground" : "text-yellow-600"
                }`}
              />
              <div className="flex-1 min-w-0 space-y-1">
                <p
                  className={`text-sm font-semibold leading-tight ${
                    isArchived ? "text-muted-foreground" : ""
                  }`}
                >
                  {sol.title || (
                    <span className="text-muted-foreground italic font-normal">
                      Sem título
                    </span>
                  )}
                </p>
                {sol.howItSolves && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {sol.howItSolves}
                  </p>
                )}
                {(sol.targetPersona || filled) && (
                  <div className="flex items-center gap-1.5 pt-0.5">
                    {sol.targetPersona && (
                      <Badge variant="outline" className="text-xs font-normal">
                        {sol.targetPersona}
                      </Badge>
                    )}
                    {filled && (
                      <span
                        className={`h-1.5 w-1.5 rounded-full inline-block ${
                          isArchived ? "bg-muted-foreground" : "bg-yellow-500"
                        }`}
                        title="Tem detalhes preenchidos"
                      />
                    )}
                  </div>
                )}
              </div>
              {isArchived ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRestore(sol.id);
                  }}
                  title="Restaurar"
                >
                  <ArchiveRestore className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-1" />
              )}
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card key={sol.id} className={cardBg}>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <Lightbulb
              className={`h-4 w-4 mt-2.5 shrink-0 ${
                isArchived ? "text-muted-foreground" : "text-yellow-600"
              }`}
            />
            <Textarea
              value={sol.title}
              onChange={(e) => onUpdate(sol.id, { title: e.target.value })}
              className="text-sm font-semibold flex-1 border-none! shadow-none! bg-transparent! px-2 py-1 focus-visible:ring-0 resize-none"
              placeholder="Nome da funcionalidade"
              rows={1}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => toggleCard(sol.id)}
              title="Recolher"
            >
              <ChevronUp className="h-3 w-3" />
            </Button>
            {isArchived ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => handleRestore(sol.id)}
                title="Restaurar"
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => handleArchive(sol.id)}
                title="Arquivar"
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => onDelete(sol.id)}
              title="Excluir"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>

          <div className="grid gap-2">
            <Label className="text-xs text-muted-foreground">Detalhes da funcionalidade</Label>
            <Textarea
              value={sol.howItSolves}
              onChange={(e) => onUpdate(sol.id, { howItSolves: e.target.value })}
              placeholder="Descreva os detalhes dessa funcionalidade..."
              rows={2}
              className="text-sm"
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-xs text-muted-foreground">Pra qual persona?</Label>
            {personaNames.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {personaNames.map((name) => (
                  <Badge
                    key={name}
                    variant={sol.targetPersona === name ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() => onUpdate(sol.id, { targetPersona: name })}
                  >
                    {name}
                  </Badge>
                ))}
              </div>
            ) : (
              <Input
                value={sol.targetPersona}
                onChange={(e) => onUpdate(sol.id, { targetPersona: e.target.value })}
                placeholder="Nome da persona"
                className="h-8 text-sm"
              />
            )}
          </div>

          <button
            type="button"
            onClick={() => toggleDetails(sol.id)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {isDetailsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {isDetailsOpen ? "Menos detalhes" : "Mais detalhes"}
            {filled && !isDetailsOpen && (
              <span className="ml-1 h-1.5 w-1.5 rounded-full bg-yellow-500 inline-block" />
            )}
          </button>

          {isDetailsOpen && (
            <div className="space-y-3 border-t pt-3">
              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Telas / Views envolvidas</Label>
                <Textarea
                  value={sol.keyScreens || ""}
                  onChange={(e) => onUpdate(sol.id, { keyScreens: e.target.value })}
                  placeholder="Ex: listagem + detalhe + filtros + empty state"
                  rows={2}
                  className="text-sm"
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Fluxos do usuario</Label>
                <Textarea
                  value={sol.userFlows || ""}
                  onChange={(e) => onUpdate(sol.id, { userFlows: e.target.value })}
                  placeholder="Ex: usuario busca servico -> seleciona prestador -> agenda -> confirma"
                  rows={2}
                  className="text-sm"
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Dor que resolve (jornada AS-IS)</Label>
                <Textarea
                  value={sol.painPointRef || ""}
                  onChange={(e) => onUpdate(sol.id, { painPointRef: e.target.value })}
                  placeholder="Qual dor da jornada atual essa funcionalidade resolve?"
                  rows={2}
                  className="text-sm"
                />
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">Consideracoes tecnicas</Label>
                <Textarea
                  value={sol.technicalNotes || ""}
                  onChange={(e) => onUpdate(sol.id, { technicalNotes: e.target.value })}
                  placeholder="APIs, integracoes, migracoes necessarias..."
                  rows={2}
                  className="text-sm"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {active.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={allActiveOpen ? collapseAllActive : expandAllActive}
            className="h-8 text-xs"
          >
            {allActiveOpen ? (
              <>
                <ChevronsDownUp className="h-3.5 w-3.5 mr-1" /> Recolher todos
              </>
            ) : (
              <>
                <ChevronsUpDown className="h-3.5 w-3.5 mr-1" /> Expandir todos
              </>
            )}
          </Button>
          <div className="inline-flex rounded-md border bg-background">
            <Button
              type="button"
              variant={layout === "single" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8 rounded-r-none"
              onClick={() => setLayout("single")}
              title="Uma coluna"
            >
              <List className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant={layout === "triple" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8 rounded-l-none"
              onClick={() => setLayout("triple")}
              title="Grid"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className={gridCls}>{active.map((sol) => renderCard(sol, false))}</div>

      <Card className="border-dashed">
        <CardContent className="pt-4">
          <div className="flex gap-2">
            <Input
              placeholder="Nova funcionalidade..."
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Button onClick={handleAdd} disabled={!newTitle.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      {archived.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-2 border-t pt-4">
            <button
              type="button"
              onClick={() => setArchivedSectionOpen((v) => !v)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {archivedSectionOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
              <Archive className="h-3.5 w-3.5" />
              Arquivadas
              <Badge variant="secondary" className="text-xs font-normal">
                {archived.length}
              </Badge>
            </button>
          </div>

          {archivedSectionOpen && (
            <div className={gridCls}>
              {archived.map((sol) => renderCard(sol, true))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
