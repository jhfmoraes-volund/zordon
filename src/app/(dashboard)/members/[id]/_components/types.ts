import type { Seniority } from "@/lib/capacity";

// ─── Shapes vindos de GET /api/members/[id]/capacity ─────

export type Member = {
  id: string;
  name: string;
  role: string;
  position: string | null;
  fpCapacity: number;
  seniority: Seniority | null;
  dedicationPercent: number;
  isExternal: boolean;
};

export type Commitment = {
  capacity: number;
  committed: number;
  remaining: number;
  projectCount: number;
};

export type ProjectAlloc = {
  projectId: string;
  projectName: string;
  fpAllocation: number;
};

export type SprintRow = {
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

// ─── Entidades otimistas (coleções com id) ───────────────

/** Contrato C2 por projeto — id = projectId. */
export type ProjectContract = {
  id: string; // projectId
  projectName: string;
  fpAllocation: number;
};

/** Override C3 por sprint — id = sprintId. */
export type SprintOverride = {
  id: string; // sprintId
  fpAllocation: number | null; // null = sem override (volta ao contrato)
};

// ─── Sinais ──────────────────────────────────────────────

export type ProjectFlag = "over" | "ok" | "idle";

export const FLAG_RANK: Record<ProjectFlag, number> = { over: 0, ok: 1, idle: 2 };

export const OK_GREEN = "oklch(0.82 0.18 145)";
export const WARN_RED = "oklch(0.82 0.2 22)";
export const AMBER = "oklch(0.82 0.15 65)";
