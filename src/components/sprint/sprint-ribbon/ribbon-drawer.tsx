"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Member, Task } from "@/components/story-hierarchy";
import { SprintBurndown } from "../sprint-burndown";
import { SprintCapacity } from "../sprint-capacity";
import {
  SprintPulseNotes,
  SprintPulseVitals,
} from "../sprint-pulse-overview";
import { SprintSummaryStats } from "../sprint-summary-stats";
import { SprintTimeline } from "../sprint-timeline";
import {
  deliveredFpByMember,
  plannedFpByMember,
  projectStats,
} from "../helpers";
import type { Sprint, SprintMemberCapacity } from "../types";

export type RibbonTab =
  | "info"
  | "vitais"
  | "capacity"
  | "alpha"
  | "burndown";

type Props = {
  /** Currently focused sprint (the one the ribbon describes). */
  sprint: Sprint;
  /** All sprints (for the timeline in "info"). */
  sprints: Sprint[];
  tasks: Task[];
  members: Member[];
  capacities: SprintMemberCapacity[];
  /** Active drawer tab. `null` = drawer collapsed. */
  openTab: RibbonTab | null;
  /** Sprint focused/clicked from inside the drawer (e.g. timeline). */
  onSelectSprint?: (sprintId: string) => void;
  onPromoteDeploy?: () => void;
};

/**
 * Drawer expansível abaixo da ribbon. Animado por `max-height` + `opacity`.
 * Conteúdo varia por `openTab`. Reusa componentes existentes — sem duplicar lógica.
 */
export function RibbonDrawer({
  sprint,
  sprints,
  tasks,
  members,
  capacities,
  openTab,
  onSelectSprint,
  onPromoteDeploy,
}: Props) {
  const open = openTab !== null;
  const innerRef = useRef<HTMLDivElement | null>(null);

  // Scroll the drawer content into view when it opens — sticky positioning
  // can otherwise leave the panel below the fold.
  useEffect(() => {
    if (!open || !innerRef.current) return;
    const el = innerRef.current;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [open, openTab]);

  return (
    <div
      id="sprint-ribbon-drawer"
      role="region"
      aria-label="Detalhes do sprint"
      aria-hidden={!open}
      className={[
        "overflow-hidden border-b bg-background/40 transition-[max-height,opacity] duration-200 ease-out",
        open ? "max-h-[720px] opacity-100" : "max-h-0 opacity-0",
      ].join(" ")}
    >
      <div ref={innerRef} className="px-4 py-4 md:px-6">
        {openTab === "info" ? (
          <InfoPanel
            sprints={sprints}
            tasks={tasks}
            focusedSprintId={sprint.id}
            onSelectSprint={onSelectSprint}
          />
        ) : openTab === "vitais" ? (
          <SprintPulseVitals sprint={sprint} tasks={tasks} />
        ) : openTab === "capacity" ? (
          <CapacityPanel
            sprint={sprint}
            tasks={tasks}
            members={members}
            capacities={capacities}
          />
        ) : openTab === "alpha" ? (
          <SprintPulseNotes
            sprint={sprint}
            tasks={tasks}
            capacities={capacities}
            onPromoteDeploy={onPromoteDeploy}
          />
        ) : openTab === "burndown" ? (
          <SprintBurndown sprint={sprint} tasks={tasks} embedded />
        ) : null}
      </div>
    </div>
  );
}

// ─── Sub-panels ─────────────────────────────────────────────────────────────

function InfoPanel({
  sprints,
  tasks,
  focusedSprintId,
  onSelectSprint,
}: {
  sprints: Sprint[];
  tasks: Task[];
  focusedSprintId: string | null;
  onSelectSprint?: (id: string) => void;
}) {
  const stats = useMemo(() => projectStats(sprints, tasks), [sprints, tasks]);
  return (
    <div className="space-y-4">
      <SprintSummaryStats stats={stats} />
      <SprintTimeline
        sprints={sprints}
        tasks={tasks}
        activeId={focusedSprintId}
        onSelect={(id) => onSelectSprint?.(id)}
      />
    </div>
  );
}

function CapacityPanel({
  sprint,
  tasks,
  members,
  capacities,
}: {
  sprint: Sprint;
  tasks: Task[];
  members: Member[];
  capacities: SprintMemberCapacity[];
}) {
  const sprintCaps = useMemo(
    () => capacities.filter((c) => c.sprintId === sprint.id),
    [capacities, sprint.id],
  );
  const delivered = useMemo(
    () => deliveredFpByMember(sprint.id, tasks),
    [sprint.id, tasks],
  );
  const planned = useMemo(
    () => plannedFpByMember(sprint.id, tasks),
    [sprint.id, tasks],
  );
  return (
    <SprintCapacity
      capacities={sprintCaps}
      members={members}
      deliveredFp={delivered}
      plannedFp={planned}
    />
  );
}
