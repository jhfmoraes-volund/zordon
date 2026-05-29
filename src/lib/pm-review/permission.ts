import "server-only";
import { canCreatePMReview, type ProjectAccessRole } from "@/lib/roles";
import { getAccessLevel, getProjectAccessList } from "@/lib/dal";

/**
 * Resolve se o caller pode criar/editar PM Review num projeto específico.
 *
 * Combina:
 *   • `getAccessLevel()` → access_level global lido do JWT (admin bypassa).
 *   • `getProjectAccessList()` → procura ProjectAccess.role do user no projeto.
 *
 * Espelha o helper SQL `can_create_pm_review(projectId)` da migration
 * 20260529d. Mudou aqui → mudou na migration (e vice-versa).
 *
 * Nota: NÃO usar `getCurrentMember().accessLevel` — Member não tem essa
 * coluna; access_level vive em auth.users.app_metadata (acessível via
 * getAccessLevel).
 */
export async function canCreatePMReviewForProject(
  projectId: string,
): Promise<boolean> {
  const accessLevel = await getAccessLevel();
  if (accessLevel === "admin") return true;

  const list = await getProjectAccessList();
  const row = list.find((r) => r.projectId === projectId);
  return canCreatePMReview(
    accessLevel,
    (row?.role ?? null) as ProjectAccessRole | null,
  );
}
