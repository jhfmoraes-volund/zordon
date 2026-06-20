"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Gauge, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
} from "@/components/ui/responsive-sheet";
import { PixelBar, PixelHud } from "@/components/ui/pixel-bar";
import { CapacityWidget } from "@/components/capacity-widget";
import { positionLabel, hasMinAccessLevel } from "@/lib/roles";
import {
  bucketSprintsByWeek,
  startOfWeek,
  addDays,
  startOfDay,
} from "@/lib/weekBuckets";
import { useAuth } from "@/contexts/auth-context";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow } from "@/lib/optimistic/toast";
import {
  ProjectNavItem,
  ProjectDetailPanel,
  MobileProjectCard,
  projectFlag,
  type ProjectView,
  type WeekView,
} from "@/app/(dashboard)/members/[id]/_components/management";
import {
  InsightsTab,
  type InsightWeekDone,
  type InsightWeekPlan,
} from "@/app/(dashboard)/members/[id]/_components/insights-tab";
import {
  FLAG_RANK,
  OK_GREEN,
  WARN_RED,
  type CapacityPayload,
  type ProjectContract,
  type SprintOverride,
} from "@/app/(dashboard)/members/[id]/_components/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { fmtDate } from "@/lib/date-utils";

const WINDOW_WEEKS = 12;

type Props = {
  memberId: string;
  initialPayload: CapacityPayload;
  initialDoneWeeks: InsightWeekDone[];
};

export function MemberCapacityView({ memberId: id, initialPayload, initialDoneWeeks }: Props) {
  const { realAccessLevel } = useAuth();
  const isMobile = useIsMobile();

  const [payload, setPayload] = useState<CapacityPayload>(initialPayload);
  const [doneWeeks, setDoneWeeks] = useState<InsightWeekDone[]>(initialDoneWeeks);
  const [tab, setTab] = useState<"gestao" | "insights">("gestao");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Alocação (contrato + override) é gestão de time → MANAGER+. Bate com o
  // PATCH dos endpoints e com o gate MANAGER do layout.
  const canEdit = hasMinAccessLevel(realAccessLevel, "manager");

  // Coleções otimistas: contrato C2 (id=projectId) e override C3 (id=sprintId).
  const contracts = useOptimisticCollection<ProjectContract>(
    initialPayload.projects.map((p) => ({
      id: p.projectId,
      projectName: p.projectName,
      fpAllocation: p.fpAllocation,
    })),
  );
  const overrides = useOptimisticCollection<SprintOverride>(
    initialPayload.sprints
      .filter((s) => s.hasOverride)
      .map((s) => ({ id: s.sprintId, fpAllocation: s.fpAllocation })),
  );

  const reload = async () => {
    if (!id) return;
    try {
      const [capRes, insRes] = await Promise.all([
        fetch(`/api/members/${id}/capacity`),
        fetch(`/api/members/${id}/insights?weeks=${WINDOW_WEEKS}`),
      ]);
      if (!capRes.ok) return;
      const data: CapacityPayload = await capRes.json();
      setPayload(data);
      contracts.setCommitted(
        data.projects.map((p) => ({ id: p.projectId, projectName: p.projectName, fpAllocation: p.fpAllocation })),
      );
      overrides.setCommitted(
        data.sprints
          .filter((s) => s.hasOverride)
          .map((s) => ({ id: s.sprintId, fpAllocation: s.fpAllocation })),
      );
      if (insRes.ok) {
        const ins = await insRes.json();
        setDoneWeeks(ins.weeks ?? []);
      }
    } catch {
      // best-effort refresh; initial payload já está renderizado
    }
  };

  // ── overlays otimistas sobre o payload ──
  const contractById = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contracts.items) m.set(c.id, c.fpAllocation);
    return m;
  }, [contracts.items]);

  const overrideBySprint = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const o of overrides.items) m.set(o.id, o.fpAllocation);
    return m;
  }, [overrides.items]);

  // ── monta ProjectView[] (sprint = unidade da timeline) ──
  const projectViews = useMemo<ProjectView[]>(() => {
    if (!payload) return [];
    const currentWeekStart = startOfWeek(startOfDay(new Date()));
    return payload.projects.map((p) => {
      const contract = contractById.get(p.projectId) ?? p.fpAllocation;
      const weeks: WeekView[] = payload.sprints
        .filter((s) => s.projectId === p.projectId)
        .map((s) => {
          const ovr = overrideBySprint.has(s.sprintId) ? overrideBySprint.get(s.sprintId)! : (s.hasOverride ? s.fpAllocation : null);
          const wkStart = startOfWeek(startOfDay(new Date(s.startDate)));
          return {
            sprintId: s.sprintId,
            projectId: s.projectId,
            weekStart: fmtDate(s.startDate),
            weekEnd: fmtDate(s.endDate),
            isCurrent: wkStart.getTime() === currentWeekStart.getTime(),
            isPast: new Date(s.endDate) < currentWeekStart,
            contract,
            override: ovr,
            planned: s.fpPlanned,
            done: s.fpDone,
            open: s.fpOpen,
            sprintName: s.sprintName,
            sprintStatus: s.status,
          };
        });
      return { id: p.projectId, name: p.projectName, contract, weeks };
    });
  }, [payload, contractById, overrideBySprint]);

  const sorted = useMemo(() => {
    return [...projectViews].sort((a, b) => {
      const fa = projectFlag(a);
      const fb = projectFlag(b);
      if (FLAG_RANK[fa.flag] !== FLAG_RANK[fb.flag]) return FLAG_RANK[fa.flag] - FLAG_RANK[fb.flag];
      const ua = fa.budget > 0 ? fa.planned / fa.budget : 0;
      const ub = fb.budget > 0 ? fb.planned / fb.budget : 0;
      return ub - ua;
    });
  }, [projectViews]);

  // default selecionado é derivado mais abaixo: `selected = find(...) ?? sorted[0]`.
  // Não precisa de effect pra "lembrar" o primeiro — o derive cobre o caso inicial,
  // e clicks setam selectedId via onClick={() => setSelectedId(p.id)}.

  // ── sinais de saúde do header ──
  const health = useMemo(() => {
    if (!payload) return null;
    const capacity = payload.commitment.capacity;
    const committed = Array.from(contractById.values()).length
      ? // recomputa com overlays otimistas
        payload.projects.reduce((acc, p) => acc + (contractById.get(p.projectId) ?? p.fpAllocation), 0)
      : payload.commitment.committed;
    const remaining = capacity - committed;

    // #2b — carga efetiva da semana corrente via bucketSprintsByWeek.
    // Aplica overrides otimistas sobre fpAllocation antes de bucketizar.
    const sprintsForBucket = payload.sprints.map((s) => {
      const ovr = overrideBySprint.has(s.sprintId) ? overrideBySprint.get(s.sprintId)! : null;
      const eff = ovr != null ? ovr : (contractById.get(s.projectId) ?? s.fpAllocation);
      return { ...s, fpAllocation: eff };
    });
    const buckets = bucketSprintsByWeek(sprintsForBucket, { weeks: 1, includePast: false });
    const weekEffective = buckets[0]?.totalAllocation ?? 0;

    return {
      capacity,
      committed,
      remaining,
      overStructural: committed > capacity,
      weekEffective,
      overWeek: weekEffective > capacity,
      overrideCount: overrides.items.length,
    };
  }, [payload, contractById, overrideBySprint, overrides.items.length]);

  // ── insights: série planejado/contrato alinhada às semanas done ──
  const planWeeks = useMemo<InsightWeekPlan[]>(() => {
    if (!payload) return [];
    const buckets = bucketSprintsByWeek(payload.sprints, {
      rangeStart: addDays(startOfWeek(startOfDay(new Date())), -7 * (WINDOW_WEEKS - 1)),
      weeks: WINDOW_WEEKS,
      includePast: false,
    });
    return buckets.map((b) => ({
      weekStart: b.weekStart.toISOString(),
      planned: b.totalPlanned,
      contract: b.totalAllocation,
    }));
  }, [payload]);

  // ── persistência otimista ──
  const saveContract = (projectId: string, fpAllocation: number) => {
    const existing = contracts.committed.find((c) => c.id === projectId);
    const projName = existing?.projectName ?? projectViews.find((p) => p.id === projectId)?.name ?? "";
    void contracts.mutate(
      { type: "patch", id: projectId, patch: { fpAllocation } },
      async (signal) => {
        await fetchOrThrow(`/api/projects/${projectId}/members/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fpAllocation }),
          signal,
        });
        return { id: projectId, projectName: projName, fpAllocation } as ProjectContract;
      },
      { errorLabel: "Salvar contrato" },
    );
  };

  const saveOverride = (sprintId: string, fpAllocation: number | null) => {
    const exists = overrides.committed.some((o) => o.id === sprintId);
    if (fpAllocation == null) {
      // remover override → DELETE + delete da coleção
      void overrides.mutate(
        { type: "delete", id: sprintId },
        async (signal) => {
          await fetchOrThrow(`/api/sprints/${sprintId}/members/${id}`, { method: "DELETE", signal });
          return null;
        },
        { errorLabel: "Remover override" },
      );
      return;
    }
    const mutation = exists
      ? ({ type: "patch", id: sprintId, patch: { fpAllocation } } as const)
      : ({ type: "create", entity: { id: sprintId, fpAllocation } } as const);
    void overrides.mutate(
      mutation,
      async (signal) => {
        await fetchOrThrow(`/api/sprints/${sprintId}/members/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fpAllocation }),
          signal,
        });
        return { id: sprintId, fpAllocation } as SprintOverride;
      },
      { errorLabel: "Salvar override" },
    );
  };

  if (!payload || !health) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  const { member } = payload;
  const selected = projectViews.find((p) => p.id === selectedId) ?? sorted[0] ?? null;

  return (
    <div className="space-y-5">
      <Link href="/members" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Membros
      </Link>

      {/* ─── ZONA 1 — header de saúde ──────────────────── */}
      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold leading-tight">{member.name}</h1>
              <p className="text-sm text-muted-foreground">{positionLabel(member.position)}</p>
            </div>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <Gauge className="h-3.5 w-3.5" />
              Contrato total · {health.capacity} PFV
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* #2a estrutural — Σ contratos / total */}
          <div className="surface-inset space-y-2 p-3">
            <div className="flex items-center justify-between">
              <PixelHud size="xs" tone="muted">contrato comprometido · Σ projetos / total</PixelHud>
              {health.overStructural ? (
                <PixelHud size="xs" style={{ color: WARN_RED }}>
                  <AlertTriangle className="mr-1 inline h-3 w-3" />
                  +{Math.abs(health.remaining)} PFV além do contrato total
                </PixelHud>
              ) : (
                <PixelHud size="xs" style={{ color: OK_GREEN }}>✓ {health.remaining} PFV livre</PixelHud>
              )}
            </div>
            <PixelBar score={Math.min((health.committed / Math.max(health.capacity, 1)) * 100, 100)} cells={28} height={12} variant="load" />
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono tabular-nums">
                <span style={{ color: health.overStructural ? WARN_RED : OK_GREEN }} className="text-base font-bold">{health.committed}</span>
                <span className="text-muted-foreground"> / {health.capacity} PFV contratados</span>
              </span>
              <span className="text-muted-foreground">
                {projectViews.length} projetos
                {health.overrideCount > 0 && (
                  <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-500">
                    {health.overrideCount} override{health.overrideCount === 1 ? "" : "s"}
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* #2b por semana — carga efetiva da semana corrente */}
          <div className="flex items-center gap-3 px-1 text-xs">
            <PixelHud size="xs" tone="muted">⚡ esta semana</PixelHud>
            <div className="flex-1">
              <PixelBar score={Math.min((health.weekEffective / Math.max(health.capacity, 1)) * 100, 100)} cells={20} height={8} variant="load" />
            </div>
            <span className="font-mono tabular-nums">
              <span style={{ color: health.overWeek ? WARN_RED : "inherit" }}>{health.weekEffective}</span>
              <span className="text-muted-foreground"> / {health.capacity} alocado</span>
            </span>
            {health.overWeek && <PixelHud size="xs" style={{ color: WARN_RED }}>⚠ semana estourada</PixelHud>}
          </div>
        </CardContent>
      </Card>

      {/* ─── TABS ──────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-foreground/10">
        {([["gestao", "Gestão"], ["insights", "Insights"]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "insights" ? (
        <InsightsTab done={doneWeeks} plan={planWeeks} totalCapacity={health.capacity} windowWeeks={WINDOW_WEEKS} />
      ) : projectViews.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Sem alocações em projetos ainda.</CardContent></Card>
      ) : isMobile ? (
        <div className="space-y-3">
          <PixelHud size="sm">Projetos</PixelHud>
          {sorted.map((p) => (
            <MobileProjectCard
              key={p.id}
              project={p}
              totalCapacity={health.capacity}
              canEdit={canEdit}
              onContractChange={(v) => saveContract(p.id, v)}
              onOverrideChange={(sprintId, v) => saveOverride(sprintId, v)}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[240px_1fr] gap-4">
          <div className="space-y-1.5">
            <PixelHud size="sm" className="px-1">Projetos</PixelHud>
            {sorted.map((p) => (
              <ProjectNavItem
                key={p.id}
                project={p}
                totalCapacity={health.capacity}
                active={p.id === selected?.id}
                canEdit={canEdit}
                onClick={() => setSelectedId(p.id)}
                onContractChange={(v) => saveContract(p.id, v)}
              />
            ))}
          </div>
          {selected && (
            <ProjectDetailPanel
              key={selected.id}
              project={selected}
              totalCapacity={health.capacity}
              canEdit={canEdit}
              onContractChange={(v) => saveContract(selected.id, v)}
              onOverrideChange={(sprintId, v) => saveOverride(sprintId, v)}
            />
          )}
        </div>
      )}

      {/* ─── ZONA 3 — contrato total (sheet) ───────────── */}
      <ResponsiveSheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <ResponsiveSheetContent size="md">
          <ResponsiveSheetHeader>
            <ResponsiveSheetTitle>Contrato total & senioridade</ResponsiveSheetTitle>
          </ResponsiveSheetHeader>
          <ResponsiveSheetBody>
            <CapacityWidget
              memberId={member.id}
              role={member.position ?? member.role}
              isExternal={member.isExternal}
              initialCapacity={member.fpCapacity}
              initialSeniority={member.seniority}
              initialDedication={member.dedicationPercent ?? 100}
              canEdit={realAccessLevel === "admin"}
              onSaved={reload}
            />
          </ResponsiveSheetBody>
        </ResponsiveSheetContent>
      </ResponsiveSheet>
    </div>
  );
}
