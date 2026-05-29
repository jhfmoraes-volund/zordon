import "server-only";
import { canCreatePMReview, type ProjectAccessRole } from "@/lib/roles";
import { getCurrentMember, getProjectAccessList } from "@/lib/dal";
import type { AccessLevel } from "@/lib/roles";

/**
 * Resolve se o caller pode criar/editar PM Review num projeto específico.
 *
 * Combina:
 *   • `getCurrentMember()` → `accessLevel` global (admin bypassa tudo).
 *   • `getProjectAccessList()` → procura ProjectAccess.role do user no projeto.
 *
 * Espelha o helper SQL `can_create_pm_review(projectId)` da migration
 * 20260529d. Mudou aqui → mudou na migration (e vice-versa).
 */
export async function canCreatePMReviewForProject(
  projectId: string,
): Promise<boolean> {
  const me = await getCurrentMember();
  if (!me) return false;

  const accessLevel = (me as { accessLevel?: string }).accessLevel ?? null;
  if (accessLevel === "admin") return true;

  const list = await getProjectAccessList();
  const row = list.find((r) => r.projectId === projectId);
  return canCreatePMReview(
    accessLevel as AccessLevel | null,
    (row?.role ?? null) as ProjectAccessRole | null,
  );
}
