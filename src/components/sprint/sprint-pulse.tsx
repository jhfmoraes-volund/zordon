"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  KanbanSquare,
  LayoutDashboard,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PixelDot, PixelHud } from "@/components/ui/pixel-bar";
import { StatusChip } from "@/components/ui/status-chip";
import { lookupChip, SPRINT_STATUS } from "@/lib/status-chips";
import type { Task } from "@/components/story-hierarchy";
import { SprintBurndown } from "./sprint-burndown";
import { SprintPulseNotes, SprintPulseVitals } from "./sprint-pulse-overview";
import { projectCompletion } from "./helpers";
import type { Sprint, SprintMemberCapacity } from "./types";

type Tab = "vitais" | "alpha" | "burndown";

type Props = {
  sprint: Sprint;
  tasks: Task[];
  capacities: SprintMemberCapacity[];
  onCreateTask?: () => void;
  onEditSprint?: () => void;
  onOpenBoard?: () => void;
  onPromoteDeploy?: () => void;
};

const TABS: Array<{
  id: Tab;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "alpha", label: "Alpha", icon: Sparkles },
  { id: "vitais", label: "Vitais", icon: LayoutDashboard },
  { id: "burndown", label: "Burndown", icon: Activity },
];

export function SprintPulse({
  sprint,
  tasks,
  capacities,
  onCreateTask,
  onEditSprint,
  onOpenBoard,
  onPromoteDeploy,
}: Props) {
  const [tab, setTab] = useState<Tab>("alpha");
  const [isPending, startTransition] = useTransition();

  const completion = useMemo(
    () => projectCompletion(sprint, tasks),
    [sprint, tasks],
  );

  const healthChip = healthChipFromCompletion(completion.status);

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    startTransition(() => setTab(next));
  };

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      {/* ─── Header (sem strip de vitais — agora é a aba "Vitais") ─── */}
      <div className="border-b bg-background/30 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-base font-semibold">{sprint.name}</h2>
          <StatusChip
            {...lookupChip(SPRINT_STATUS, sprint.status)}
            dot
            size="sm"
          />
          <StatusChip tone={healthChip.tone} size="sm">
            {healthChip.icon}
            {healthChip.label}
          </StatusChip>

          <div className="ml-auto flex flex-wrap gap-1.5">
            {onCreateTask ? (
              <Button size="sm" variant="outline" onClick={onCreateTask}>
                <Plus className="size-3.5" />
                Nova task
              </Button>
            ) : null}
            {onEditSprint ? (
              <Button size="sm" variant="outline" onClick={onEditSprint}>
                <Pencil className="size-3.5" />
                Editar
              </Button>
            ) : null}
            {onOpenBoard ? (
              <Button size="sm" variant="outline" onClick={onOpenBoard}>
                <KanbanSquare className="size-3.5" />
                Board
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {/* ─── Tab strip ───────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Sprint Pulse"
        className="flex items-center gap-1 overflow-x-auto border-b bg-background/20 px-2"
      >
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`sprint-pulse-panel-${t.id}`}
              onClick={() => switchTab(t.id)}
              className={`group relative inline-flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <PixelDot
                variant={active ? "done" : "empty"}
                size={6}
                glow={active}
              />
              <t.icon className="size-3.5" />
              {t.label}
              {active ? (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t bg-primary" />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* ─── Tab content ─────────────────────────────────────────── */}
      <div
        id={`sprint-pulse-panel-${tab}`}
        role="tabpanel"
        aria-busy={isPending}
        className="relative p-4"
      >
        {isPending ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <PixelHud size="xs" tone="muted">
              carregando {tab}…
            </PixelHud>
          </div>
        ) : tab === "vitais" ? (
          <SprintPulseVitals sprint={sprint} tasks={tasks} />
        ) : tab === "alpha" ? (
          <SprintPulseNotes
            sprint={sprint}
            tasks={tasks}
            capacities={capacities}
            onPromoteDeploy={onPromoteDeploy}
          />
        ) : (
          <SprintBurndown sprint={sprint} tasks={tasks} embedded />
        )}
      </div>
    </section>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type ChipTone = "green" | "blue" | "amber" | "red" | "muted";

function healthChipFromCompletion(
  status:
    | "ahead"
    | "on_track"
    | "behind"
    | "stalled"
    | "complete"
    | "unknown",
): { tone: ChipTone; label: string; icon: React.ReactNode } {
  switch (status) {
    case "complete":
      return {
        tone: "green",
        label: "completo",
        icon: <CheckIcon />,
      };
    case "ahead":
      return { tone: "green", label: "adiantado", icon: <ArrowUpRight className="h-3 w-3" /> };
    case "on_track":
      return { tone: "blue", label: "no ritmo", icon: <DotIcon /> };
    case "behind":
      return { tone: "amber", label: "atrasado", icon: <ArrowDownRight className="h-3 w-3" /> };
    case "stalled":
      return { tone: "red", label: "travado", icon: <DotIcon /> };
    default:
      return { tone: "muted", label: "—", icon: null };
  }
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function DotIcon() {
  return (
    <span
      aria-hidden
      className="inline-block size-1.5 rounded-full bg-current"
    />
  );
}

