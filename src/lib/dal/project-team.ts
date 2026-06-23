import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { db } from "@/lib/db";

/**
 * Roster canônico do projeto (F2.8 — convergência de alocação SSOT).
 *
 * UMA fonte (`finance.v_project_team`) pros 3 readers que antes faziam UNIONs
 * divergentes: `api/projects/[id]/members`, vitoria `loadProjectMembers`, alpha
 * `get_allocated_project_members`. Roster = alocados (`labor_allocation` vigente,
 * incl. spot) ∪ acesso-only (`ProjectAccess` sem alocação: guests/viewers + PMs
 * backfilled). Squad NÃO entra (pool/contexto, não membership — D9).
 *
 * `fpAllocation` (teto PFV de planning, vem de ProjectMember) ≠ `percent`/`days`
 * (custo, vem de labor_allocation) — D10, não fundir.
 */
export type ProjectTeamMember = {
  projectId: string;
  memberId: string;
  userId: string | null;
  source: "allocated" | "access";
  name: string | null;
  /** Member.role (cargo bruto). Pra display preferir `position ?? role`. */
  role: string | null;
  position: string | null;
  fpCapacity: number | null;
  dedicationPercent: number | null;
  isExternal: boolean | null;
  isPM: boolean;
  fpAllocation: number | null;
  kind: "standing" | "spot" | null;
  percent: number | null;
  days: number | null;
  contractId: string | null;
  accessRole: string | null;
};

type Row = {
  project_id: string;
  member_id: string | null;
  user_id: string | null;
  source: string;
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
  access_role: string | null;
};

function mapRow(r: Row): ProjectTeamMember {
  return {
    projectId: r.project_id,
    memberId: r.member_id as string,
    userId: r.user_id,
    source: r.source === "access" ? "access" : "allocated",
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
    accessRole: r.access_role,
  };
}

/**
 * Roster de um projeto pela view canônica `finance.v_project_team`. Usa service-role
 * (a view tem escape `auth.uid() IS NULL` pra esse caso); os callers já fazem a
 * própria checagem de acesso (rotas via `requireMinLevelApi`; agentes são backend
 * confiável). Linhas de acesso sem `Member` resolvido (sem member_id) são
 * filtradas — não são membros de equipe.
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
