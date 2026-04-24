"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { MemberBattery, type BatterySegment } from "@/components/member-battery";
import { roleLabel } from "@/lib/roles";

type Member = { id: string; name: string; role: string; fpCapacity: number };
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
  fpUsed: number;
  hasOverride: boolean;
};

type PayloadShape = {
  member: Member;
  commitment: Commitment;
  projects: ProjectAlloc[];
  sprints: SprintRow[];
};

type PeriodFilter = "active-next" | "active" | "future" | "past" | "all";

export default function MemberCapacityPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<PayloadShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("active-next");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [savingProject, setSavingProject] = useState<string | null>(null);
  const [savingSprint, setSavingSprint] = useState<string | null>(null);

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

  const filteredSprints = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    return data.sprints.filter((s) => {
      const start = new Date(s.startDate);
      const end = new Date(s.endDate);
      const isActive = start <= now && end >= now;
      const isFuture = start > now;
      const isPast = end < now;

      if (periodFilter === "active" && !isActive) return false;
      if (periodFilter === "future" && !isFuture) return false;
      if (periodFilter === "past" && !isPast) return false;
      if (periodFilter === "active-next") {
        // sprint ativo OU 4 próximos futuros
        if (isPast) return false;
        if (isFuture) {
          const diffWeeks = (start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 7);
          if (diffWeeks > 4) return false;
        }
      }
      if (projectFilter !== "all" && s.projectId !== projectFilter) return false;
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      return true;
    });
  }, [data, periodFilter, projectFilter, statusFilter]);

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

  const saveSprintOverride = async (sprintId: string, fpAllocation: number) => {
    if (!id) return;
    setSavingSprint(sprintId);
    try {
      const res = await fetch(`/api/sprints/${sprintId}/members/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fpAllocation }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } finally {
      setSavingSprint(null);
    }
  };

  const clearSprintOverride = async (sprintId: string) => {
    if (!id) return;
    setSavingSprint(sprintId);
    try {
      const res = await fetch(`/api/sprints/${sprintId}/members/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } finally {
      setSavingSprint(null);
    }
  };

  if (error) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  const { member, commitment, projects, sprints } = data;
  const batterySegments: BatterySegment[] = projects.map((p) => ({
    label: p.projectName,
    value: p.fpAllocation,
  }));

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

      {/* Bateria */}
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

      {/* Alocação por sprint */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-sm text-muted-foreground">
              Alocação por sprint
              <span className="ml-2 text-xs font-normal">
                ({filteredSprints.length} de {sprints.length})
              </span>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={periodFilter} onValueChange={(v) => v && setPeriodFilter(v as PeriodFilter)}>
                <SelectTrigger className="h-8 w-52 text-xs">
                  <SelectValue>
                    {(v: string | null) =>
                      v === "active-next" ? "Ativo + próximos 4" :
                      v === "active" ? "Só ativo" :
                      v === "future" ? "Só futuros" :
                      v === "past" ? "Só histórico" :
                      v === "all" ? "Todos" : "Período"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active-next">Ativo + próximos 4</SelectItem>
                  <SelectItem value="active">Só ativo</SelectItem>
                  <SelectItem value="future">Só futuros</SelectItem>
                  <SelectItem value="past">Só histórico</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                </SelectContent>
              </Select>
              <Select value={projectFilter} onValueChange={(v) => v && setProjectFilter(v)}>
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue>
                    {(v: string | null) => {
                      if (v === "all" || !v) return "Todos os projetos";
                      return projects.find((p) => p.projectId === v)?.projectName ?? "…";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os projetos</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.projectId} value={p.projectId}>{p.projectName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue>
                    {(v: string | null) =>
                      v === "all" || !v ? "Todos os status" :
                      v === "planning" ? "Planning" :
                      v === "active" ? "Active" :
                      v === "done" ? "Done" : v
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="planning">Planning</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredSprints.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              Nenhum sprint no filtro atual.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sprint</TableHead>
                  <TableHead>Projeto</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Alocação</TableHead>
                  <TableHead className="text-right">Usado</TableHead>
                  <TableHead className="text-right w-20">%</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSprints.map((s) => {
                  const pct = s.fpAllocation > 0 ? s.fpUsed / s.fpAllocation : 0;
                  const badgeVariant: "default" | "outline" | "destructive" | "secondary" =
                    pct > 1 ? "destructive" : pct >= 0.9 ? "default" : pct >= 0.5 ? "secondary" : "outline";
                  const fmt = (d: string) =>
                    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
                  return (
                    <TableRow key={s.sprintId}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate max-w-[200px]" title={s.sprintName}>{s.sprintName}</span>
                          {s.hasOverride && (
                            <span
                              title="Override de SprintMember ativo"
                              className="text-[9px] px-1 rounded bg-amber-500/20 text-amber-500 font-medium uppercase tracking-wider shrink-0"
                            >
                              ovr
                            </span>
                          )}
                          <Badge variant="outline" className="text-[10px] capitalize shrink-0">
                            {s.status}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{s.projectName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {fmt(s.startDate)} — {fmt(s.endDate)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          max={500}
                          defaultValue={s.fpAllocation}
                          disabled={savingSprint === s.sprintId}
                          onBlur={(e) => {
                            const next = Number(e.target.value);
                            if (!Number.isNaN(next) && next !== s.fpAllocation) {
                              saveSprintOverride(s.sprintId, next);
                            }
                          }}
                          className="h-7 w-20 text-right ml-auto tabular-nums"
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{s.fpUsed}</TableCell>
                      <TableCell className="text-right">
                        {s.fpAllocation > 0 ? (
                          <Badge variant={badgeVariant} className="tabular-nums">
                            {Math.round(pct * 100)}%
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {s.hasOverride && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Restaurar padrão do projeto"
                            disabled={savingSprint === s.sprintId}
                            onClick={() => clearSprintOverride(s.sprintId)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
