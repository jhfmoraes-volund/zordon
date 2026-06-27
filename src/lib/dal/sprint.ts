import "server-only";
import { db } from "@/lib/db";

/**
 * projectId de uma sprint (ou null se não existir). Usado para gatear as rotas
 * /api/sprints/[id]/* — elas recebem o id da sprint, mas a capability
 * `sprint.*` é project-scoped (precisa do projeto pra checar a role do builder).
 * Roda via service_role (db()); resolve o projeto independentemente do acesso
 * do caller — o gate (requireCapabilityApi) é quem decide a autorização.
 */
export async function projectIdForSprint(
  sprintId: string,
): Promise<string | null> {
  const { data } = await db()
    .from("Sprint")
    .select("projectId")
    .eq("id", sprintId)
    .maybeSingle();
  return data?.projectId ?? null;
}
