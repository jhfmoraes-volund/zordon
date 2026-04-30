"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MemberBattery, type BatterySegment } from "@/components/member-battery";
import { CapacityWidget } from "@/components/capacity-widget";
import { WeeklyAllocation } from "@/components/weekly-allocation";
import { PixelBar, PixelDot, PixelHud, pixelTone } from "@/components/ui/pixel-bar";
import { roleLabel } from "@/lib/roles";
import { bucketSprintsByWeek } from "@/lib/weekBuckets";
import type { Seniority } from "@/lib/capacity";

type Member = {
  id: string;
  name: string;
  role: string;
  fpCapacity: number;
  seniority: Seniority | null;
  dedicationPercent: number;
  isExternal: boolean;
};
type Commitment = { capacity: number; committed: number; remaining: number; projectCount: number };
type ProjectAlloc = { projectId: string; projectName: string; fpAllocation: number };
type SprintRow = {
  sprintId: string;
  sprintName: string;
  startDate: string;
  endDate: string;
  status: string;
  projectId: string;
  projectName: string;
  fpAllocation: number;
  fpPlanned: number;
  fpDone: number;
  fpOpen: number;
  hasOverride: boolean;
};

type PayloadShape = {
  member: Member;
  commitment: Commitment;
  projects: ProjectAlloc[];
  sprints: SprintRow[];
};

export default function MemberCapacityPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PayloadShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingProject, setSavingProject] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/members/${id}/capacity`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(d.error || "Falha ao carregar capacity");
      }
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const saveProjectAllocation = async (projectId: string, fpAllocation: number) => {
    if (!id) return;
    setSavingProject(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fpAllocation }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } finally {
      setSavingProject(null);
    }
  };

  // Agrega planejado/done/open por projeto na semana corrente (sprints da semana).
  // Hooks precisam ficar antes dos returns condicionais; useMemo lida com data null.
  const weekByProject = useMemo(() => {
    if (!data) return new Map<string, { fpPlanned: number; fpDone: number; fpOpen: number; activeSprints: { id: string; name: string; status: string }[] }>();
    const buckets = bucketSprintsByWeek(data.sprints, { weeks: 1, includePast: false });
    const current = buckets[0];
    const map = new Map<string, { fpPlanned: number; fpDone: number; fpOpen: number; activeSprints: { id: string; name: string; status: string }[] }>();
    for (const row of current?.sprints ?? []) {
      const existing = map.get(row.projectId);
      if (existing) {
        existing.fpPlanned += row.fpPlannedWeek;
        existing.fpDone += row.fpDoneWeek;
        existing.fpOpen += row.fpOpenWeek;
        if (!existing.activeSprints.find((s) => s.id === row.sprintId)) {
          existing.activeSprints.push({ id: row.sprintId, name: row.sprintName, status: row.sprintStatus });
        }
      } else {
        map.set(row.projectId, {
          fpPlanned: row.fpPlannedWeek,
          fpDone: row.fpDoneWeek,
          fpOpen: row.fpOpenWeek,
          activeSprints: [{ id: row.sprintId, name: row.sprintName, status: row.sprintStatus }],
        });
      }
    }
    return map;
  }, [data]);

  if (error) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  const { member, commitment, projects, sprints } = data;
  const batterySegments: BatterySegment[] = projects.map((p) => ({
    label: p.projectName,
    value: p.fpAllocation,
  }));
  const projectsForFilter = projects.map((p) => ({ id: p.projectId, name: p.projectName }));

  // Total da semana entregue (pra empilhar na bateria total)
  const weekDoneTotal = Array.from(weekByProject.values()).reduce((acc, w) => acc + w.fpDone, 0);

  return (
    <div className="space-y-6">
      {/* Breadcrumb + header */}
      <div className="space-y-3">
        <Link
          href="/members"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Membros
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{member.name}</h1>
            <p className="text-sm text-muted-foreground">{roleLabel(member.role)}</p>
          </div>
        </div>
      </div>

      {/* Bateria + Capacity widget — lado a lado em desktop */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">Bateria por projeto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <MemberBattery
              capacity={commitment.capacity}
              committed={commitment.committed}
              done={weekDoneTotal}
              breakdown={batterySegments}
              mode="capacity"
              size="md"
            />
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem alocações em projetos ainda.</p>
            ) : (
              <div className="space-y-3 pt-1">
                <PixelHud size="xs" tone="muted">
                  utilização do contrato — sprints rodando essa semana
                </PixelHud>
                {projects.map((p) => {
                  const week = weekByProject.get(p.projectId) ?? { fpPlanned: 0, fpDone: 0, fpOpen: 0, activeSprints: [] };
                  const ratio = p.fpAllocation > 0 ? week.fpPlanned / p.fpAllocation : 0;
                  const overContract = p.fpAllocation > 0 && week.fpPlanned > p.fpAllocation;
                  const idle = week.fpPlanned === 0 && p.fpAllocation > 0;
                  const projectTone = pixelTone(ratio * 100, "load");
                  return (
                    <div key={p.projectId} className="space-y-1.5 surface-inset p-2.5">
                      {/* Linha 1: nome + planejado/contrato + flag + input */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate flex-1">{p.projectName}</span>
                        {overContract ? (
                          <PixelHud size="xs" style={{ color: "oklch(0.82 0.2 22)" }}>
                            ⚠️ {ratio.toFixed(2)}×
                          </PixelHud>
                        ) : idle ? (
                          <PixelHud size="xs" tone="muted">💤 ocioso</PixelHud>
                        ) : (
                          <PixelHud size="xs" style={{ color: "oklch(0.82 0.18 145)" }}>✓ ok</PixelHud>
                        )}
                        <Input
                          type="number"
                          min={0}
                          max={500}
                          defaultValue={p.fpAllocation}
                          disabled={savingProject === p.projectId}
                          onBlur={(e) => {
                            const next = Number(e.target.value);
                            if (!Number.isNaN(next) && next !== p.fpAllocation) {
                              saveProjectAllocation(p.projectId, next);
                            }
                          }}
                          className="w-16 h-7 text-right text-xs"
                        />
                        <span className="text-[10px] text-muted-foreground w-12 leading-tight">FP/sprint</span>
                      </div>

                      {/* Linha 2: barra utilização do contrato */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <PixelBar
                            score={Math.min(ratio * 100, 100)}
                            cells={20}
                            height={6}
                            variant="load"
                          />
                        </div>
                        <span className="font-mono text-[10px] tabular-nums leading-none w-20 text-right">
                          <span style={{ color: projectTone.fg }}>{week.fpPlanned}</span>
                          <span className="text-muted-foreground"> / {p.fpAllocation}</span>
                        </span>
                      </div>

                      {/* Linha 3: ▮done ▮open + sprints da semana */}
                      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-flex items-center gap-1">
                            <PixelDot variant="done" size={6} />
                            <span className="font-mono tabular-nums">{week.fpDone} entregue</span>
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <PixelDot variant="open" size={6} />
                            <span className="font-mono tabular-nums">{week.fpOpen} em aberto</span>
                          </span>
                        </span>
                        <span className="truncate text-right">
                          {week.activeSprints.length > 0
                            ? week.activeSprints.map((s) => `${s.name} (${s.status})`).join(" · ")
                            : "sem sprint essa semana"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Editar contrato afeta <strong>todos os sprints</strong> do projeto. Pra um sprint específico, use override abaixo.
            </p>
          </CardContent>
        </Card>

        <CapacityWidget
          memberId={member.id}
          role={member.role}
          isExternal={member.isExternal}
          initialCapacity={member.fpCapacity}
          initialSeniority={member.seniority}
          initialDedication={member.dedicationPercent ?? 100}
          onSaved={load}
        />
      </div>

      {/* Alocação por semana — sprints rateadas pelos dias úteis */}
      <WeeklyAllocation
        sprints={sprints}
        weeklyCapacity={member.fpCapacity}
        projects={projectsForFilter}
      />
    </div>
  );
}
