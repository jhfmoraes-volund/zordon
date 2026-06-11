"use client";

import { CalendarClock, ChartLine, Handshake, Sparkles, Users } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";

export type RitualType =
  | "pm_review"
  | "sprint_planning"
  | "release_planning"
  | "kickoff_interno"
  | "kickoff_externo";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (type: RitualType) => void;
  /** Manager-level — habilita Sprint Planning + Release Planning. */
  canManage: boolean;
  /** Permissão específica de PM Review (lead/admin). */
  canPMReview: boolean;
};

const RITUAL_OPTIONS: {
  type: RitualType;
  icon: typeof CalendarClock;
  title: string;
  description: string;
  cadence: string;
}[] = [
  {
    type: "pm_review",
    icon: ChartLine,
    title: "PM Review",
    description: "Síntese semanal do PM — direção, riscos e próximos passos.",
    cadence: "Semanal",
  },
  {
    type: "sprint_planning",
    icon: CalendarClock,
    title: "Sprint Planning",
    description: "Planejamento da sprint — contexto, propostas e ações.",
    cadence: "Semanal",
  },
  {
    type: "release_planning",
    icon: Sparkles,
    title: "Release Planning",
    description:
      "Plano de release — transforma os PRDs do projeto em user stories e tasks.",
    cadence: "Uma vez por projeto",
  },
  {
    type: "kickoff_interno",
    icon: Users,
    title: "Kickoff Interno",
    description: "Alinhamento interno do time antes de iniciar o projeto.",
    cadence: "Uma vez por projeto",
  },
  {
    type: "kickoff_externo",
    icon: Handshake,
    title: "Kickoff Externo",
    description:
      "Kickoff com o cliente — expectativas, escopo e próximos passos.",
    cadence: "Uma vez por projeto",
  },
];

export function RitualPickerModal({
  open,
  onOpenChange,
  onSelect,
  canManage,
  canPMReview,
}: Props) {
  const available = RITUAL_OPTIONS.filter((o) =>
    o.type === "pm_review" ? canPMReview : canManage,
  );

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Novo Ritual</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Escolha o tipo de ritual que deseja criar
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="grid gap-3 py-4">
          {available.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.type}
                type="button"
                onClick={() => {
                  onSelect(option.type);
                  onOpenChange(false);
                }}
                className={cn(
                  "flex items-start gap-4 rounded-lg border p-4 text-left transition-colors",
                  "hover:bg-accent/50 hover:border-primary/50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                )}
              >
                <div className="rounded-md bg-primary/10 p-2.5 shrink-0">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{option.title}</p>
                    <span className="rounded-sm border bg-muted/50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                      {option.cadence}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {option.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
