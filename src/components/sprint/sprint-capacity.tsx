"use client";

import { PixelBar } from "@/components/ui/pixel-bar";
import type { Member } from "@/components/story-hierarchy";
import type { SprintMemberCapacity } from "./types";

type Props = {
  capacities: SprintMemberCapacity[];
  members: Member[];
  /** Map of memberId → FP done in this sprint (for delivery indicator). */
  deliveredFp?: Record<string, number>;
};

export function SprintCapacity({
  capacities,
  members,
  deliveredFp = {},
}: Props) {
  if (capacities.length === 0) {
    return (
      <p className="text-xs italic text-muted-foreground">
        Nenhum membro alocado neste sprint.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {capacities.map((cap) => {
        const member = members.find((m) => m.id === cap.memberId);
        if (!member) return null;
        const allocPct =
          cap.fpCapacity > 0 ? (cap.fpAllocation / cap.fpCapacity) * 100 : 0;
        const delivered = deliveredFp[cap.memberId] ?? 0;
        const deliveredPct =
          cap.fpAllocation > 0 ? (delivered / cap.fpAllocation) * 100 : 0;
        return (
          <div
            key={cap.memberId}
            className="flex flex-wrap items-center gap-3 text-xs"
          >
            <span className="w-28 truncate font-medium">{member.name}</span>
            <div className="min-w-[120px] flex-1">
              <PixelBar
                score={Math.min(allocPct, 100)}
                cells={20}
                height={10}
                variant="load"
              />
            </div>
            <span className="w-20 text-right font-mono tabular-nums text-muted-foreground">
              {cap.fpAllocation}/{cap.fpCapacity} FP
            </span>
            <span className="w-12 text-right font-mono tabular-nums">
              {Math.round(allocPct)}%
            </span>
            <span className="w-32 text-right text-[11px] tabular-nums text-muted-foreground">
              entregue:{" "}
              <span className="font-medium text-foreground">{delivered}</span>{" "}
              FP
              {cap.fpAllocation > 0 ? (
                <span className="ml-1 text-[10px]">
                  ({Math.round(deliveredPct)}%)
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
