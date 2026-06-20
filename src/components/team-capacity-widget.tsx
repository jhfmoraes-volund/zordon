"use client";

import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { roleLabel } from "@/lib/roles";
import { MemberBattery } from "@/components/member-battery";
import { PixelDot } from "@/components/ui/pixel-bar";

export type TeamCapacityMember = {
  id: string;
  name: string;
  role: string;
  position: string | null;
  squads: string[];
  fpCapacity: number;
  fpContract: number;
  fpPlanned: number;
  fpDone: number;
  fpOpen: number;
  activeSprints: { id: string; name: string; projectName: string }[];
};

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
          Capacity do Time — Sprint atual
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Planejado vs contrato vs capacity. Bate o olho e vê overcommit.
        </p>
      </CardHeader>
      <CardContent>
        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto pt-1.5 pb-3 -mx-3 px-3 scroll-px-3 snap-x snap-mandatory scrollbar-none md:block md:space-y-3 md:overflow-visible md:m-0 md:p-0 md:pb-0 md:pt-0 md:scroll-p-0"
        >
          {members.map((m) => {
            const multiplier = m.fpCapacity > 0 ? m.fpPlanned / m.fpCapacity : 0;
            const overcommit = m.fpPlanned > m.fpCapacity;
            const overContract = m.fpContract > 0 && m.fpPlanned > m.fpContract;
            const idle = m.fpPlanned === 0 && m.fpContract > 0;
            const contractDelta = m.fpPlanned - m.fpContract;
            const contractRatio = m.fpCapacity > 0 ? m.fpContract / m.fpCapacity : 0;

            return (
              <div
                key={m.id}
                data-snap-item
                className="surface-inset p-3 min-w-full shrink-0 snap-start snap-always md:min-w-0"
              >
                {/* Member header + multiplicador */}
                <div className="flex items-center justify-between mb-3 gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="text-sm font-medium">{m.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {roleLabel(m.position)}
                    </Badge>
                    {m.squads.map((s: string) => (
                      <Badge key={s} variant="secondary" className="text-[10px]">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  <span className="text-xs tabular-nums shrink-0 flex items-center gap-1.5">
                    <span>
                      <span className="font-mono font-semibold">{m.fpPlanned}</span>
                      <span className="text-muted-foreground">/{m.fpCapacity} PFV</span>
                    </span>
                    {m.fpCapacity > 0 && (
                      <span
                        className={`font-mono font-semibold ${
                          overcommit
                            ? "text-red-400"
                            : multiplier > contractRatio
                            ? "text-amber-500"
                            : "text-green-500"
                        }`}
                      >
                        {multiplier.toFixed(2)}×
                      </span>
                    )}
                    {overcommit && <span>⚠️</span>}
                  </span>
                </div>

                {/* Bateria empilhada (▓ done + ▒ open dentro de capacity) */}
                <MemberBattery
                  capacity={m.fpCapacity}
                  committed={m.fpPlanned}
                  done={m.fpDone}
                  showNumbers={false}
                  size="sm"
                />

                {/* Linha de contrato + flag */}
                <div className="flex items-center justify-between mt-2 gap-2 text-[11px]">
                  <span className="text-muted-foreground tabular-nums">
                    contrato {m.fpContract}
                    {overContract ? (
                      <span className="text-amber-500"> → +{contractDelta} PFV acima</span>
                    ) : idle ? (
                      <span className="text-muted-foreground"> → 💤 ocioso</span>
                    ) : m.fpContract > 0 ? (
                      <span className="text-muted-foreground"> → sobra {Math.max(m.fpContract - m.fpPlanned, 0)} PFV</span>
                    ) : null}
                  </span>
                  <span className="inline-flex items-center gap-1 tabular-nums text-muted-foreground">
                    <PixelDot variant="done" />
                    {m.fpDone}
                    <PixelDot variant="open" />
                    {m.fpOpen}
                  </span>
                </div>

                {/* Sprints ativas */}
                {m.activeSprints.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1.5 truncate">
                    {m.activeSprints.map((s) => `${s.projectName} ${s.name}`).join(" · ")}
                  </p>
                )}
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
