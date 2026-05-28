"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MemberBattery, type BatterySegment } from "@/components/member-battery";
import { WeeklyAllocation } from "@/components/weekly-allocation";
import { roleLabel } from "@/lib/roles";

type Member = { id: string; name: string; role: string; position: string | null; fpCapacity: number };
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
export type CapacityPayload = {
  member: Member;
  commitment: Commitment;
  projects: ProjectAlloc[];
  sprints: SprintRow[];
};

export function CapacityView({ data }: { data: CapacityPayload }) {
  const { member, commitment, projects, sprints } = data;
  const batterySegments: BatterySegment[] = projects.map((p) => ({
    label: p.projectName,
    value: p.fpAllocation,
  }));
  const projectsForFilter = projects.map((p) => ({ id: p.projectId, name: p.projectName }));

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Meu perfil
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Minha capacity</h1>
          <p className="text-sm text-muted-foreground">{roleLabel(member.position)}</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-muted-foreground">
            Acordo contratual — {commitment.committed} / {commitment.capacity} FP/sem
          </CardTitle>
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
            <div className="space-y-1.5">
              {projects.map((p) => (
                <div key={p.projectId} className="flex items-center gap-3 text-sm">
                  <span className="flex-1 truncate">{p.projectName}</span>
                  <span className="font-mono tabular-nums text-sm">{p.fpAllocation}</span>
                  <span className="text-xs text-muted-foreground">FP/sem</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <WeeklyAllocation
        sprints={sprints}
        weeklyCapacity={member.fpCapacity}
        projects={projectsForFilter}
      />
    </div>
  );
}
