"use client";

import { useMemo } from "react";
import { Users } from "lucide-react";
import { PixelHud } from "@/components/ui/pixel-bar";
import type { Member, Task } from "@/components/story-hierarchy";
import { SprintCapacity } from "./sprint-capacity";
import { deliveredFpByMember, plannedFpByMember } from "./helpers";
import type { Sprint, SprintMemberCapacity } from "./types";

type Props = {
  sprint: Sprint;
  tasks: Task[];
  members: Member[];
  capacities: SprintMemberCapacity[];
};

/**
 * Capacity card — summary header + per-member list.
 * Designed to live ao lado do SprintPulse na grade de duas colunas.
 */
export function SprintCapacityCard({
  sprint,
  tasks,
  members,
  capacities,
}: Props) {
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

  const allocation = sprintCaps.reduce((acc, c) => acc + c.fpAllocation, 0);
  const deliveredTotal = sprintCaps.reduce(
    (acc, c) => acc + (delivered[c.memberId] ?? 0),
    0,
  );
  const plannedTotal = sprintCaps.reduce(
    (acc, c) => acc + (planned[c.memberId] ?? 0),
    0,
  );
  const utilPct =
    allocation > 0 ? Math.round((plannedTotal / allocation) * 100) : 0;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background/30 px-4 py-3">
        <div className="inline-flex items-center gap-1.5">
          <Users className="size-3.5 text-muted-foreground" />
          <PixelHud size="sm">Capacity</PixelHud>
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {sprintCaps.length}{" "}
          {sprintCaps.length === 1 ? "pessoa" : "pessoas"}
        </span>
      </div>

      {/* Summary strip */}
      {sprintCaps.length > 0 ? (
        <div className="grid grid-cols-3 divide-x border-b bg-background/15 text-center">
          <SummaryCell label="Alocação" value={allocation} unit="FP" />
          <SummaryCell label="Entregue" value={deliveredTotal} unit="FP" />
          <SummaryCell
            label="Utilização"
            value={`${utilPct}%`}
            tone={
              utilPct >= 100 ? "warn" : utilPct >= 80 ? "amber" : "neutral"
            }
          />
        </div>
      ) : null}

      {/* Per-member list */}
      <div className="p-4">
        <SprintCapacity
          capacities={sprintCaps}
          members={members}
          deliveredFp={delivered}
          plannedFp={planned}
        />
      </div>
    </section>
  );
}

function SummaryCell({
  label,
  value,
  unit,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "warn" | "amber" | "neutral";
}) {
  const valueClass =
    tone === "warn"
      ? "text-red-700 dark:text-red-300"
      : tone === "amber"
        ? "text-amber-700 dark:text-amber-300"
        : "text-foreground";
  return (
    <div className="px-3 py-2.5">
      <PixelHud size="xs" tone="muted" className="block">
        {label}
      </PixelHud>
      <p
        className={`mt-0.5 text-base font-bold leading-none tabular-nums ${valueClass}`}
      >
        {value}
        {unit ? (
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </p>
    </div>
  );
}
