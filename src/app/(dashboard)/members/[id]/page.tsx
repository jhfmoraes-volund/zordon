"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MemberBattery, type BatterySegment } from "@/components/member-battery";
import { CapacityWidget } from "@/components/capacity-widget";
import { WeeklyAllocation } from "@/components/weekly-allocation";
import { roleLabel } from "@/lib/roles";
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
  /** @deprecated alias de fpOpen — removido na Fase 16 junto com SprintInput.fpUsed */
  fpUsed: number;
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

  if (error) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  const { member, commitment, projects, sprints } = data;
  const batterySegments: BatterySegment[] = projects.map((p) => ({
    label: p.projectName,
    value: p.fpAllocation,
  }));
  const projectsForFilter = projects.map((p) => ({ id: p.projectId, name: p.projectName }));

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
              breakdown={batterySegments}
              size="md"
            />
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem alocações em projetos ainda.</p>
            ) : (
              <div className="space-y-2">
                {projects.map((p) => (
                  <div key={p.projectId} className="flex items-center gap-3 text-sm">
                    <span className="flex-1 truncate">{p.projectName}</span>
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
                      className="w-20 h-7 text-right"
                    />
                    <span className="text-xs text-muted-foreground w-14">FP/sprint</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Editar aqui afeta <strong>todos os sprints</strong> do projeto. Pra um sprint específico, use override abaixo.
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
