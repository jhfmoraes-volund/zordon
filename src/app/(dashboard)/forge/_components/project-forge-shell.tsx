"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { PROJECT_STATUS, lookupChip } from "@/lib/status-chips";
import { ForgeProvider } from "@/hooks/use-forge-store";
import { ForgeHud } from "./forge-hud";
import { ForgeStage } from "./forge-stage";
import { ForgeControls } from "./forge-controls";
import { TaskSheet } from "./task-sheet";

type ProjectMeta = {
  id: string;
  name: string;
  status: string;
  client: { name: string } | null;
};

/**
 * Observatório da Forja escopado a um projeto.
 *
 * Hoje (Fase 7): reusa store global do ForgeProvider — mock storyline única.
 * Navegar entre projetos reseta a store. Aceitável até a Fase 11 (realtime),
 * quando cada projeto vai assinar seu próprio canal forge_event.
 */
export function ProjectForgeShell({ project }: { project: ProjectMeta }) {
  return (
    <ForgeProvider>
      <div className="container mx-auto max-w-6xl space-y-6 p-6">
        <header className="space-y-4">
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label="Voltar"
              render={<Link href="/forge" />}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">
                  {project.name}
                </h1>
                <StatusChip
                  {...lookupChip(PROJECT_STATUS, project.status)}
                  dot
                />
                <span className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  forge
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {project.client?.name ?? "—"} · observatório de agentes
              </p>
            </div>
            <ForgeControls />
          </div>
        </header>

        <ForgeHud />

        <ForgeStage />
      </div>
      <TaskSheet />
    </ForgeProvider>
  );
}
