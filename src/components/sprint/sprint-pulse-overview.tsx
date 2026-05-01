"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Rocket,
  ServerCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PixelHud } from "@/components/ui/pixel-bar";
import { AlphaIcon } from "@/components/icons/alpha-icon";
import { useAlphaChat } from "@/components/alpha-chat";
import type { Task } from "@/components/story-hierarchy";
import {
  plannedFpByMember,
  projectCompletion,
  sprintAlerts,
  sprintDays,
  sprintFP,
  sprintMix,
  sprintTaskCounts,
  workTimeDelta,
  type SprintAlert,
} from "./helpers";
import type { Sprint, SprintMemberCapacity } from "./types";

type SharedProps = {
  sprint: Sprint;
  tasks: Task[];
};

// ─── Vitais tab ─────────────────────────────────────────────────────────────
// Mini-cards planos: cada vital é um card. Sem strip, sem wrapper.

export function SprintPulseVitals({ sprint, tasks }: SharedProps) {
  const completion = useMemo(
    () => projectCompletion(sprint, tasks),
    [sprint, tasks],
  );
  const fp = useMemo(() => sprintFP(sprint.id, tasks), [sprint.id, tasks]);
  const counts = useMemo(
    () => sprintTaskCounts(sprint.id, tasks),
    [sprint.id, tasks],
  );
  const days = useMemo(() => sprintDays(sprint), [sprint]);
  const wt = useMemo(() => workTimeDelta(sprint, tasks), [sprint, tasks]);
  const mix = useMemo(() => sprintMix(sprint.id, tasks), [sprint.id, tasks]);

  const deltaTone =
    wt.deltaPp >= 5
      ? "good"
      : wt.deltaPp <= -5
        ? "warn"
        : "neutral";
  const deltaSign = wt.deltaPp > 0 ? "+" : "";

  return (
    <div className="space-y-4">
      {/* Work/Tempo — barras inline, sem container */}
      <div className="space-y-2">
        <BarRow label="Work" pct={wt.workPct} variant="primary" />
        <BarRow label="Tempo" pct={wt.timePct} variant="amber" />
      </div>

      {/* Grid plano de mini-cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label="FP"
          value={`${fp.done}`}
          unit={`/ ${fp.total}`}
        />
        <StatCard
          label="Tasks"
          value={`${counts.done}`}
          unit={`/ ${counts.total}`}
        />
        <StatCard
          label="Dias"
          value={`${days.elapsed}`}
          unit={`/ ${days.total}`}
        />
        <StatCard
          label="Δ Work−Tempo"
          value={`${deltaSign}${wt.deltaPp}pp`}
          tone={deltaTone}
        />
        <StatCard
          label="Velocity"
          value={completion.velocity.toFixed(1)}
          unit="FP/dia"
        />
        <StatCard
          label="ETA"
          value={completion.etaText}
          tone={
            completion.status === "ahead" || completion.status === "complete"
              ? "good"
              : completion.status === "behind" ||
                  completion.status === "stalled"
                ? "warn"
                : "neutral"
          }
        />
        <StatCard
          label="Billable"
          value={`${mix.billablePct}%`}
          unit={`${mix.billableFp} / ${mix.totalFp} FP`}
        />
        <StatCard
          label="AI-generated"
          value={`${mix.aiPct}%`}
          unit={`${mix.aiTasks} / ${mix.totalTasks} tasks`}
        />
      </div>
    </div>
  );
}

// ─── Alpha tab ──────────────────────────────────────────────────────────────
// "Atenção requerida" reformatada como mensagens do agente Alpha.

type NotesProps = SharedProps & {
  capacities: SprintMemberCapacity[];
  onPromoteDeploy?: () => void;
};

export function SprintPulseNotes({
  sprint,
  tasks,
  capacities,
  onPromoteDeploy,
}: NotesProps) {
  const planned = useMemo(
    () => plannedFpByMember(sprint.id, tasks),
    [sprint.id, tasks],
  );
  const alerts = useMemo(
    () => sprintAlerts(sprint, tasks, capacities, planned),
    [sprint, tasks, capacities, planned],
  );
  const { enabled, setOpen, sendMessage } = useAlphaChat();

  function startConversation() {
    if (!enabled) return;
    setOpen(true);
    sendMessage(
      `Quero conversar sobre o sprint **${sprint.name}**. O que mais te preocupa agora?`,
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border bg-card/40 p-3">
        <span
          aria-hidden
          className="inline-flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/30"
        >
          <AlphaIcon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            Alpha
          </p>
          <p className="text-xs text-muted-foreground">
            Pontos que merecem atenção neste sprint.
          </p>
        </div>
        {enabled ? (
          <Button size="sm" variant="outline" onClick={startConversation}>
            Conversar
          </Button>
        ) : null}
      </div>

      {alerts.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/5 p-3 text-xs text-green-700 dark:text-green-300">
          <CheckCircle2 className="h-4 w-4" />
          Nenhum alerta ativo — sprint limpo.
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id}>
              <AlertCard alert={a} onAction={onPromoteDeploy} />
            </li>
          ))}
        </ul>
      )}

      <DeployStrip sprint={sprint} onPromote={onPromoteDeploy} />
    </div>
  );
}

// ─── Internals ───────────────────────────────────────────────────────────────

function BarRow({
  label,
  pct,
  variant,
}: {
  label: string;
  pct: number;
  variant: "primary" | "amber";
}) {
  const fillClass =
    variant === "primary" ? "bg-primary" : "bg-amber-500/80";
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[11px] text-muted-foreground">
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-[width] ${fillClass}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="w-10 text-right font-mono text-[11px] tabular-nums">
        {pct}%
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  tone = "neutral",
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: "good" | "warn" | "neutral";
}) {
  const valueClass =
    tone === "good"
      ? "text-green-700 dark:text-green-300"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-300"
        : "text-foreground";
  return (
    <div className="rounded-md border bg-background/40 p-2.5">
      <PixelHud size="xs" tone="muted" className="block">
        {label}
      </PixelHud>
      <p
        className={`mt-1 text-base font-bold leading-tight tabular-nums ${valueClass}`}
      >
        {value}
      </p>
      {unit ? (
        <p className="text-[10px] text-muted-foreground tabular-nums">
          {unit}
        </p>
      ) : null}
    </div>
  );
}

function AlertCard({
  alert,
  onAction,
}: {
  alert: SprintAlert;
  onAction?: () => void;
}) {
  const isWarn = alert.severity === "warn";
  const Icon = isWarn ? AlertTriangle : Info;
  const wrap = isWarn
    ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
    : "border-blue-500/25 bg-blue-500/5 text-blue-700 dark:text-blue-300";
  const isDeploy = alert.id === "deploy-gap";
  return (
    <div className={`flex gap-2 rounded-md border p-3 text-xs ${wrap}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium leading-tight text-foreground">
          {alert.title}
        </p>
        {alert.detail ? (
          <p className="text-[11px] leading-snug text-muted-foreground">
            {alert.detail}
          </p>
        ) : null}
      </div>
      {isDeploy && onAction ? (
        <Button size="sm" variant="outline" onClick={onAction}>
          <Rocket className="size-3.5" />
          Promover
        </Button>
      ) : null}
    </div>
  );
}

function DeployStrip({
  sprint,
  onPromote,
}: {
  sprint: Sprint;
  onPromote?: () => void;
}) {
  const staging = sprint.deployedToStagingAt;
  const prod = sprint.deployedToProductionAt;
  if (!staging && !prod) return null;
  return (
    <div className="border-t pt-3">
      <PixelHud size="xs" tone="muted" className="mb-2 block">
        Deploy
      </PixelHud>
      <div className="flex flex-wrap items-center gap-2">
        <DeployBadge
          icon={ServerCog}
          label="staging"
          date={staging ?? null}
        />
        <DeployBadge
          icon={CheckCircle2}
          label="production"
          date={prod ?? null}
          ctaLabel={!prod && staging ? "Promover" : undefined}
          onCta={onPromote}
        />
      </div>
    </div>
  );
}

function DeployBadge({
  icon: Icon,
  label,
  date,
  ctaLabel,
  onCta,
}: {
  icon: typeof Rocket;
  label: string;
  date: string | null;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  if (!date) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5 text-[10px] text-muted-foreground">
        <Icon className="size-3" />
        {label} pendente
        {ctaLabel && onCta ? (
          <button
            type="button"
            onClick={onCta}
            className="ml-1 font-semibold uppercase tracking-wider text-primary hover:underline"
          >
            {ctaLabel} →
          </button>
        ) : null}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] text-green-700 dark:text-green-300">
      <Icon className="size-3" />
      {label}
      <span className="font-mono opacity-70">· {date.slice(0, 10)}</span>
    </span>
  );
}
