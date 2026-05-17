"use client";

import { ForgeProvider } from "@/hooks/use-forge-store";
import { ForgeHud } from "./forge-hud";
import { ForgeStage } from "./forge-stage";
import { ForgeControls } from "./forge-controls";
import { TaskSheet } from "./task-sheet";

/**
 * Painel da Forja escopado a um projeto, sem chrome de página.
 *
 * Usado como aba dentro de `/projects/[id]?tab=forge` — o header de projeto
 * (nome, status, breadcrumb) já é fornecido pela page que o envolve.
 *
 * Reusa store global do ForgeProvider — mock storyline única. Cada vez que
 * desmonta (troca de aba ou projeto), a store reseta. Aceitável até a Fase 11
 * (realtime), quando cada projeto vai assinar seu próprio canal forge_event.
 */
export function ProjectForgePanel() {
  return (
    <ForgeProvider>
      <div className="space-y-5">
        <div className="flex items-center justify-end">
          <ForgeControls />
        </div>
        <ForgeHud />
        <ForgeStage />
      </div>
      <TaskSheet />
    </ForgeProvider>
  );
}
