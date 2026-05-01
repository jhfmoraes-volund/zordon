"use client";

import { Check, AlertTriangle } from "lucide-react";
import { PixelBar, PixelDot, pixelTone } from "@/components/ui/pixel-bar";
import { StatusChip } from "@/components/ui/status-chip";
import type { ChipTone } from "@/lib/status-chips";
import type { Member } from "@/components/story-hierarchy";
import type { SprintMemberCapacity } from "./types";

type Props = {
  capacities: SprintMemberCapacity[];
  members: Member[];
  /** Map of memberId → FP done in this sprint. */
  deliveredFp?: Record<string, number>;
  /** Map of memberId → FP planejado no sprint (status ≠ backlog/draft). */
  plannedFp?: Record<string, number>;
};

function healthChip(usagePct: number): { tone: ChipTone; label: string; icon: "ok" | "warn" } {
  if (usagePct >= 100) return { tone: "red", label: "overcommit", icon: "warn" };
  if (usagePct >= 80) return { tone: "amber", label: "cheio", icon: "warn" };
  return { tone: "green", label: "OK", icon: "ok" };
}

export function SprintCapacity({
  capacities,
  members,
  deliveredFp = {},
  plannedFp = {},
}: Props) {
  if (capacities.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground">
        Nenhum membro alocado neste sprint.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-foreground/5">
      {capacities.map((cap) => {
        const member = members.find((m) => m.id === cap.memberId);
        if (!member) return null;
        const planned = plannedFp[cap.memberId] ?? 0;
        const done = deliveredFp[cap.memberId] ?? 0;
        const open = Math.max(0, planned - done);
        // Bar reflete utilização do contrato: planejado / alocação.
        const usagePct =
          cap.fpAllocation > 0 ? (planned / cap.fpAllocation) * 100 : 0;
        const tone = pixelTone(usagePct, "contract");
        const health = healthChip(usagePct);

        return (
          <li key={cap.memberId} className="py-3 first:pt-0 last:pb-0 space-y-2">
            {/* Identity row */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate flex-1 min-w-0">
                {member.name}
              </span>
              <StatusChip tone={health.tone} size="sm">
                {health.icon === "ok" ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <AlertTriangle className="h-3 w-3" />
                )}
                {health.label}
              </StatusChip>
              <span
                className="text-xs text-muted-foreground tabular-nums shrink-0"
                title="Capacity total da pessoa por sprint"
              >
                <span className="font-mono text-foreground">{cap.fpCapacity}</span> FP/sprint
              </span>
            </div>

            {/* Bar + planejado/contrato */}
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <PixelBar
                  score={usagePct}
                  cells={28}
                  height={10}
                  variant="contract"
                />
              </div>
              <p
                className="text-sm font-bold tabular-nums shrink-0"
                title="Planejado / alocação do contrato no sprint"
              >
                <span style={{ color: tone.fg }}>{planned}</span>
                <span className="text-muted-foreground/70"> / {cap.fpAllocation}</span>
              </p>
            </div>

            {/* Breakdown */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <PixelDot variant="done" size={8} />
                <span className="font-mono text-foreground">{done}</span> entregue
              </span>
              <span className="inline-flex items-center gap-1.5">
                <PixelDot variant="open" size={8} />
                <span className="font-mono text-foreground">{open}</span> em aberto
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
