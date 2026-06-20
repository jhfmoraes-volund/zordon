"use client";

import { Badge } from "@/components/ui/badge";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetDescription,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
import {
  PlanningCronograma,
  type CronogramaBlock,
} from "@/components/planning-session/planning-cronograma";
import {
  PlanningEventRow,
  type PlanningEvent,
} from "@/components/planning-session/planning-event-log";

/**
 * Side-sheet "Histórico do plano" — navegador de versões. Desktop: sheet à
 * direita; mobile: bottom-sheet. Concentra a navegação no tempo num overlay (sem
 * roubar altura do layout): o cronograma EXPANDIDO funciona como week-picker e a
 * lista de versões da semana selecionada permite abrir o canvas histórico.
 *
 * Modal (Radix): selecionar uma versão atualiza o canvas atrás; feche o sheet pra
 * vê-lo. Reabrir = clicar um bloco na mini-régua do ribbon. Sair do histórico de
 * vez é o botão "Ao vivo".
 */
export function PlanningHistorySheet({
  open,
  onOpenChange,
  blocks,
  selectedKey,
  onSelectBlock,
  weekLabel,
  events,
  selectedEventId,
  onSelectEvent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: CronogramaBlock[];
  selectedKey: string | null;
  onSelectBlock: (key: string) => void;
  /** Rótulo da semana selecionada (nome da sprint). */
  weekLabel: string | null;
  events: PlanningEvent[];
  selectedEventId: string | null;
  onSelectEvent: (id: string) => void;
}) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Histórico do plano</ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Navegue as versões por semana. Selecionar uma versão abre o canvas
            histórico (read-only).
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody className="space-y-5">
          {/* Cronograma expandido = week-picker dentro do sheet. */}
          <div className="space-y-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Cronograma
            </div>
            <PlanningCronograma
              variant="full"
              blocks={blocks}
              selectedKey={selectedKey}
              onSelect={onSelectBlock}
            />
          </div>

          {/* Versões da semana selecionada. */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              Versões {weekLabel ? `· ${weekLabel}` : ""}
              <Badge variant="secondary">{events.length}</Badge>
            </div>
            {events.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                Nenhuma versão aplicada nesta semana.
              </p>
            ) : (
              <div className="divide-y rounded-lg border bg-card">
                {events.map((ev) => (
                  <PlanningEventRow
                    key={ev.id}
                    event={ev}
                    selected={ev.id === selectedEventId}
                    onSelect={onSelectEvent}
                  />
                ))}
              </div>
            )}
          </div>
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
