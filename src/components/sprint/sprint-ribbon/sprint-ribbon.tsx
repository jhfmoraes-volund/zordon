"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { PixelHud } from "@/components/ui/pixel-bar";
import type { Member, Task } from "@/components/story-hierarchy";
import {
  plannedFpByMember,
  sprintAlerts,
  workTimeDelta,
} from "../helpers";
import type { Sprint, SprintMemberCapacity } from "../types";
import { RibbonAlertsPill } from "./ribbon-alerts-pill";
import { RibbonCapacityPill } from "./ribbon-capacity-pill";
import { RibbonDrawer, type RibbonTab } from "./ribbon-drawer";
import { RibbonIdentityPill } from "./ribbon-identity-pill";
import { RibbonPulsePill } from "./ribbon-pulse-pill";

type Props = {
  /** Currently focused sprint — what the ribbon describes. */
  sprint: Sprint;
  /** All sprints in the project (for timeline in "info" drawer). */
  sprints: Sprint[];
  /** Active sprint id (current/vigente). When ≠ `sprint.id`, ribbon enters "viewing" mode. */
  activeSprintId: string | null;
  tasks: Task[];
  members: Member[];
  capacities: SprintMemberCapacity[];
  onJumpToActive?: () => void;
  onSelectSprint?: (sprintId: string) => void;
  onPromoteDeploy?: () => void;
  /** Top offset for sticky positioning. Defaults to the app shell header height. */
  className?: string;
};

/**
 * 🌈 SprintRibbon — barra horizontal sticky com KPIs do sprint focado.
 *
 * - Identity • Pulse (Work/Tempo/Δ) • Capacity • Alpha alerts • Burndown
 * - Cada pill é trigger de drawer expansível abaixo da própria ribbon
 * - Em modo "visualizando" (sprint focado ≠ vigente), ganha indicador amber
 *   na borda esquerda + chip "Visualizando" + botão "↩ ir pro vigente"
 *
 * Não duplica lógica — popovers reusam SprintPulseNotes/Vitais/Burndown/etc.
 */
export function SprintRibbon({
  sprint,
  sprints,
  activeSprintId,
  tasks,
  members,
  capacities,
  onJumpToActive,
  onSelectSprint,
  onPromoteDeploy,
  className,
}: Props) {
  const [openTab, setOpenTab] = useState<RibbonTab | null>(null);

  const isViewing = Boolean(
    activeSprintId && sprint.id !== activeSprintId,
  );

  // ─── Derived KPIs ────────────────────────────────────────────────────────
  const wt = useMemo(() => workTimeDelta(sprint, tasks), [sprint, tasks]);

  const sprintCaps = useMemo(
    () => capacities.filter((c) => c.sprintId === sprint.id),
    [capacities, sprint.id],
  );
  const planned = useMemo(
    () => plannedFpByMember(sprint.id, tasks),
    [sprint.id, tasks],
  );
  const allocation = sprintCaps.reduce((acc, c) => acc + c.fpAllocation, 0);
  const plannedTotal = sprintCaps.reduce(
    (acc, c) => acc + (planned[c.memberId] ?? 0),
    0,
  );
  const utilPct =
    allocation > 0 ? Math.round((plannedTotal / allocation) * 100) : 0;

  const alerts = useMemo(
    () => sprintAlerts(sprint, tasks, capacities, planned),
    [sprint, tasks, capacities, planned],
  );
  const severity: "warn" | "info" | "ok" = alerts.some(
    (a) => a.severity === "warn",
  )
    ? "warn"
    : alerts.length > 0
      ? "info"
      : "ok";

  // Close drawer when the focused sprint changes (context shifted)
  useEffect(() => {
    setOpenTab(null);
  }, [sprint.id]);

  const toggle = (tab: RibbonTab) =>
    setOpenTab((prev) => (prev === tab ? null : tab));

  return (
    <div className={className}>
      {/* ─── Sticky bar ─────────────────────────────────────────────────── */}
      <div
        className={[
          "sticky top-0 z-20",
          "border-y backdrop-blur",
          // Modo "visualizando": stroke amber inset esquerdo + tom de fundo discreto
          isViewing
            ? "bg-amber-500/[0.04] shadow-[inset_2px_0_0_oklch(0.7_0.16_65/0.7)]"
            : "bg-background/80",
        ].join(" ")}
      >
        <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto px-3 py-2 md:gap-3 md:px-6">
          <RibbonIdentityPill
            sprint={sprint}
            isViewing={isViewing}
            active={openTab === "info"}
            onToggle={() => toggle("info")}
            onJumpToActive={onJumpToActive}
          />

          <Divider />

          <RibbonPulsePill
            workPct={wt.workPct}
            timePct={wt.timePct}
            deltaPp={wt.deltaPp}
            active={openTab === "vitais"}
            onToggle={() => toggle("vitais")}
          />

          <Divider />

          <RibbonCapacityPill
            members={sprintCaps.length}
            utilPct={utilPct}
            active={openTab === "capacity"}
            onToggle={() => toggle("capacity")}
          />

          <RibbonAlertsPill
            count={alerts.length}
            severity={severity}
            active={openTab === "alpha"}
            onToggle={() => toggle("alpha")}
          />

          <button
            type="button"
            onClick={() => toggle("burndown")}
            aria-expanded={openTab === "burndown"}
            aria-controls="sprint-ribbon-drawer"
            className={[
              "ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1.5 transition-colors md:px-2",
              "hover:bg-muted/50",
              openTab === "burndown" ? "bg-muted/40" : "",
            ].join(" ")}
            aria-label="Burndown"
          >
            <Activity className="size-3.5 text-muted-foreground" />
            <PixelHud size="xs" tone="muted" className="hidden leading-none md:inline">
              Burndown
            </PixelHud>
          </button>
        </div>
      </div>

      {/* ─── Drawer expansível ────────────────────────────────────────── */}
      <RibbonDrawer
        sprint={sprint}
        sprints={sprints}
        activeSprintId={activeSprintId}
        tasks={tasks}
        members={members}
        capacities={capacities}
        openTab={openTab}
        onSelectSprint={onSelectSprint}
        onPromoteDeploy={onPromoteDeploy}
      />
    </div>
  );
}

function Divider() {
  return (
    <span
      aria-hidden
      className="hidden h-5 w-px bg-border/70 md:inline-block"
    />
  );
}
