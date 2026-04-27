"use client";

import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { roleLabel } from "@/lib/roles";

export type TeamCapacityMember = {
  id: string;
  name: string;
  role: string;
  fpCapacity: number;
  fpThisWeek: number;
  fpNextWeek: number;
  dueThisWeek: number;
  dueNextWeek: number;
  squads: string[];
};

function usageColor(pct: number) {
  if (pct <= 0.5) return "bg-green-500";
  if (pct <= 0.7) return "bg-blue-500";
  if (pct <= 0.85) return "bg-yellow-500";
  return "bg-red-500";
}

export function TeamCapacityWidget({
  members,
}: {
  members: TeamCapacityMember[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const items = Array.from(
      container.querySelectorAll<HTMLElement>("[data-snap-item]"),
    );
    if (items.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const idx = items.indexOf(entry.target as HTMLElement);
            if (idx !== -1) setActiveIdx(idx);
          }
        });
      },
      { root: container, threshold: [0.6] },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [members.length]);

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          Capacity do Time
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          FP com prazo nesta e proxima semana vs capacity semanal (capacity sprint / 2)
        </p>
      </CardHeader>
      <CardContent>
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pt-1.5 pb-3 -mx-3 px-3 scroll-px-3 snap-x snap-mandatory scrollbar-none md:block md:space-y-4 md:overflow-visible md:m-0 md:p-0 md:pb-0 md:pt-0 md:scroll-p-0"
        >
          {members.map((m) => {
            const weeklyCapacity = Math.round(m.fpCapacity / 2);
            const thisWeekPct =
              weeklyCapacity > 0 ? m.fpThisWeek / weeklyCapacity : 0;
            const nextWeekPct =
              weeklyCapacity > 0 ? m.fpNextWeek / weeklyCapacity : 0;

            return (
              <div
                key={m.id}
                data-snap-item
                className="surface-inset p-3 min-w-full shrink-0 snap-start snap-always md:min-w-0"
              >
                {/* Member header */}
                <div className="flex items-center justify-between mb-3 gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-sm font-medium">{m.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {roleLabel(m.role)}
                    </Badge>
                    {m.squads.map((s: string) => (
                      <Badge key={s} variant="secondary" className="text-[10px]">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {weeklyCapacity} FP/sprint
                  </span>
                </div>

                {/* Two-week bars */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* This week */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                        Esta semana
                      </span>
                      <span className="text-xs font-medium tabular-nums">
                        {m.fpThisWeek}/{weeklyCapacity} FP
                        {m.dueThisWeek > 0 && (
                          <span className="text-muted-foreground">
                            {" "}
                            ({m.dueThisWeek} tasks)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${usageColor(thisWeekPct)}`}
                        style={{ width: `${Math.min(thisWeekPct * 100, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Next week */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                        Prox semana
                      </span>
                      <span className="text-xs font-medium tabular-nums">
                        {m.fpNextWeek}/{weeklyCapacity} FP
                        {m.dueNextWeek > 0 && (
                          <span className="text-muted-foreground">
                            {" "}
                            ({m.dueNextWeek} tasks)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${usageColor(nextWeekPct)}`}
                        style={{ width: `${Math.min(nextWeekPct * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {members.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4 w-full">
              Nenhum membro cadastrado.
            </p>
          )}
        </div>

        {/* Dots indicator — só em mobile, só se houver mais de 1 */}
        {members.length > 1 && (
          <div className="flex justify-center gap-1.5 mt-3 md:hidden">
            {members.map((m, idx) => (
              <span
                key={m.id}
                className={`h-1.5 rounded-full transition-all ${
                  idx === activeIdx
                    ? "w-4 bg-primary"
                    : "w-1.5 bg-muted-foreground/30"
                }`}
                aria-label={`Membro ${idx + 1} de ${members.length}`}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
