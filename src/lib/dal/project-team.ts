import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { db } from "@/lib/db";

/**
 * Equipe canônica do projeto (`finance.v_project_team`).
 *
 * EQUIPE = PM (gestor, derivado de `Project.pmId`) + Builders (executores,
 * `labor_allocation` vigente, incl. spot). Guest/viewer (`ProjectAccess` sem
 * alocação) NÃO é membro — é só visibilidade, fora da equipe. Squad também não
 * entra (pool/contexto — D9). Fonte única dos readers: `api/projects/[id]/members`,
 * vitoria `loadProjectMembers`, alpha `get_allocated_project_members`, task sheets.
 *
 * `isPM` distingue gestor de executor. `fpAllocation` (teto PFV de planning, vem de
 * ProjectMember) ≠ `percent`/`days` (custo, vem de labor_allocation) — D10, não fundir.
 */
export type ProjectTeamMember = {
  projectId: string;
  memberId: string;
  userId: string | null;
  name: string | null;
  /** Member.role (cargo bruto). Pra display preferir `position ?? role`. */
  role: string | null;
  position: string | null;
  fpCapacity: number | null;
  dedicationPercent: number | null;
  isExternal: boolean | null;
  /** true = PM (gestor); false = Builder (executor). */
  isPM: boolean;
  fpAllocation: number | null;
  /** Alocação do builder (null no PM sem alocação própria). */
  kind: "standing" | "spot" | null;
  percent: number | null;
  days: number | null;
  contractId: string | null;
};

type Row = {
  project_id: string;
  member_id: string | null;
  user_id: string | null;
  name: string | null;
  role: string | null;
  position: string | null;
  fp_capacity: number | null;
  dedication_percent: number | null;
  is_external: boolean | null;
  is_pm: boolean;
  fp_allocation: number | null;
  kind: string | null;
  percent: number | string | null;
  days: number | string | null;
  contract_id: string | null;
};

function mapRow(r: Row): ProjectTeamMember {
  return {
    projectId: r.project_id,
    memberId: r.member_id as string,
    userId: r.user_id,
    name: r.name,
    role: r.role,
    position: r.position,
    fpCapacity: r.fp_capacity,
    dedicationPercent: r.dedication_percent,
    isExternal: r.is_external,
    isPM: r.is_pm,
    fpAllocation: r.fp_allocation,
    kind: r.kind === "spot" ? "spot" : r.kind === "standing" ? "standing" : null,
    percent: r.percent == null ? null : Number(r.percent),
    days: r.days == null ? null : Number(r.days),
    contractId: r.contract_id,
  };
}

/**
 * Equipe de um projeto pela view canônica `finance.v_project_team` (PM + builders
 * alocados). Usa service-role (a view tem escape `auth.uid() IS NULL` pra esse caso);
 * os callers fazem a própria checagem de acesso (rotas via `requireProjectViewApi`;
 * agentes são backend confiável). `member_id` nunca é null aqui (PM e alocados sempre
 * têm Member), mas o filtro fica como guarda defensiva.
 */
export async function getProjectTeam(
  projectId: string,
): Promise<ProjectTeamMember[]> {
  const fin = (db() as unknown as SupabaseClient).schema("finance");
  const { data, error } = await fin
    .from("v_project_team")
    .select("*")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[])
    .filter((r) => r.member_id != null)
    .map(mapRow);
}
