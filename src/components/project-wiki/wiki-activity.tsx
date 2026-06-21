"use client";

import {
  Rocket,
  ClipboardList,
  Gem,
  ArrowLeftRight,
  FileCheck2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WikiActivityKind, WikiMetrics } from "@/lib/dal/wiki-metrics";

/**
 * Log de Atividade recente (WER-005): timeline vertical minimalista dos
 * eventos estruturais do projeto (sprint iniciada, planning aplicada, DS
 * aprovada, mudança de fase, PM Review). Determinístico — absorve a antiga
 * seção LLM "Decisões". Vazio → hint, nunca some.
 */

const KIND_META: Record<
  WikiActivityKind,
  { icon: LucideIcon; tint: string; fg: string }
> = {
  sprint: { icon: Rocket, tint: "bg-emerald-500/15", fg: "text-emerald-500" },
  planning: { icon: ClipboardList, tint: "bg-sky-500/15", fg: "text-sky-500" },
  design_session: { icon: Gem, tint: "bg-purple-500/15", fg: "text-purple-400" },
  phase: { icon: ArrowLeftRight, tint: "bg-amber-500/15", fg: "text-amber-500" },
  pm_review: { icon: FileCheck2, tint: "bg-primary/15", fg: "text-primary" },
};

function agoLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `há ${w} semana${w === 1 ? "" : "s"}`;
  const months = Math.floor(d / 30);
  return `há ${months} ${months === 1 ? "mês" : "meses"}`;
}

export function WikiActivity({
  activity,
}: {
  activity: WikiMetrics["activity"];
}) {
  return (
    <section className="surface px-4 py-3">
      <h3 className="mb-2 text-sm font-semibold">Atividade recente</h3>
      {activity.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem atividade recente.</p>
      ) : (
        <ul className="flex flex-col">
          {activity.map((ev, i) => {
            const meta = KIND_META[ev.kind];
            const Icon = meta.icon;
            const last = i === activity.length - 1;
            return (
              <li key={`${ev.kind}-${ev.date}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
                {!last && (
                  <span
                    aria-hidden
                    className="absolute left-[11px] top-6 bottom-0 w-px bg-border"
                  />
                )}
                <span
                  className={cn(
                    "z-[1] flex size-[23px] shrink-0 items-center justify-center rounded-md",
                    meta.tint
                  )}
                >
                  <Icon className={cn("size-3", meta.fg)} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-tight">
                    {ev.href ? (
                      <a href={ev.href} className="hover:underline">
                        {ev.title}
                      </a>
                    ) : (
                      ev.title
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {agoLabel(ev.date)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
