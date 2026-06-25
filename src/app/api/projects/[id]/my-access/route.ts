import { NextResponse } from "next/server";

import {
  getUser,
  getEffectiveAccessLevel,
  getProjectAccessList,
  getAccessGrantList,
} from "@/lib/dal";
import { hasMinAccessLevel } from "@/lib/roles";

/**
 * Como o usuário ACTING alcança este projeto. Usado pela page do projeto pra
 * decidir o modo restrito (grant_only → só o app/ritual concedido aparece).
 *
 *   via "manager"         → access_level manager+ (vê tudo)
 *   via "project_access"  → tem linha em ProjectAccess (vê o projeto inteiro)
 *   via "grant_only"      → só via MemberAccessGrant project-scoped → dock restrito
 *   via "none"            → sem acesso (a RLS não devolveria o projeto mesmo)
 *
 * Grants globais (projectId null) NÃO contam aqui: não dão visibilidade de
 * projeto (espelho de has_any_project_grant, que casa só projectId =).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id: projectId } = await params;

  const level = await getEffectiveAccessLevel();
  if (hasMinAccessLevel(level, "manager")) {
    return NextResponse.json({ via: "manager", grantedCapabilities: [] });
  }

  const access = await getProjectAccessList();
  if (access.some((r) => r.projectId === projectId)) {
    return NextResponse.json({ via: "project_access", grantedCapabilities: [] });
  }

  const grants = await getAccessGrantList();
  const grantedCapabilities = grants
    .filter((g) => g.projectId === projectId)
    .map((g) => g.capabilityKey);

  return NextResponse.json({
    via: grantedCapabilities.length > 0 ? "grant_only" : "none",
    grantedCapabilities,
  });
}
