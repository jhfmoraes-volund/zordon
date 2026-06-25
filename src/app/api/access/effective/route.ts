import { NextRequest, NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { db } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveAccessLevel,
  mapPositionToAccessLevel,
  type AccessLevel,
} from "@/lib/roles";
import { listActiveGrantsForUser } from "@/lib/access/grants-dal";

/**
 * Acesso EFETIVO de um membro (admin-only) — alimenta a coluna "Acesso efetivo"
 * do app Acessos. Combina os três eixos: access_level global + ProjectAccess +
 * grants ativos. Usa db()/admin (service-role); o gate é requireMinAccessLevelApi.
 */
export async function GET(req: NextRequest) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;

  const memberId = req.nextUrl.searchParams.get("memberId");
  if (!memberId) {
    return NextResponse.json({ error: "memberId required" }, { status: 400 });
  }

  const { data: member } = await db()
    .from("Member")
    .select("id, name, position, role, userId")
    .eq("id", memberId)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "member not found" }, { status: 404 });
  }

  const userId = member.userId as string | null;

  // access_level real do membro (do JWT app_metadata, via admin client).
  // Sem conta → deriva da position (mesma regra do mapeamento de cargo).
  let accessLevel: AccessLevel;
  if (userId) {
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.getUserById(userId);
    accessLevel = resolveAccessLevel(
      (data?.user?.app_metadata as { access_level?: string } | null)
        ?.access_level,
      (data?.user?.app_metadata as { role?: string } | null)?.role,
    );
  } else {
    accessLevel = mapPositionToAccessLevel(member.position ?? member.role ?? "");
  }

  // ProjectAccess (eixo por-projeto) + grants ativos (eixo override).
  const [accessRes, grants] = await Promise.all([
    userId
      ? db()
          .from("ProjectAccess")
          .select("projectId, role, project:Project(name)")
          .eq("userId", userId)
      : Promise.resolve({ data: [] }),
    userId ? listActiveGrantsForUser(userId) : Promise.resolve([]),
  ]);

  return NextResponse.json({
    member: {
      id: member.id,
      name: member.name,
      position: member.position ?? member.role ?? null,
      hasAccount: userId != null,
    },
    accessLevel,
    projectAccess: accessRes.data ?? [],
    grants,
  });
}
