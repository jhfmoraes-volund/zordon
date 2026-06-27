import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/projects/[id]/access/[userId]/regenerate-link
 *
 * Manager-only. Gera um novo link de acesso pro guest informado:
 *   - se ele ainda não definiu senha → link de set-password (type=invite)
 *   - se já definiu senha → magic link 1-shot pra esse projeto
 *
 * Não dispara email. Retorna `{ link, type, expiresInHours }` pro manager
 * copiar e mandar pelo canal dele.
 *
 * Pré-condição: o user precisa ter ProjectAccess nesse projeto.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: projectId, userId } = await params;
  const denied = await requireCapabilityApi("project.manage_access", {
    projectId,
  });
  if (denied) return denied;

  // Confirma que o user é um guest do projeto.
  const { data: access } = await db()
    .from("ProjectAccess")
    .select("userId, projectId")
    .eq("projectId", projectId)
    .eq("userId", userId)
    .maybeSingle();

  if (!access) {
    return NextResponse.json(
      { error: "Esse usuário não tem acesso a este projeto." },
      { status: 404 },
    );
  }

  const admin = createAdminClient();
  const { data: userData, error: userErr } =
    await admin.auth.admin.getUserById(userId);
  if (userErr || !userData?.user?.email) {
    return NextResponse.json(
      { error: "Usuário não encontrado em auth.users." },
      { status: 404 },
    );
  }
  const email = userData.user.email;
  const meta = userData.user.user_metadata as { password_set?: boolean } | null;
  const hasPassword = Boolean(meta?.password_set);

  const redirectTo = hasPassword
    ? `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/projects/${projectId}`
    : `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/auth/set-password?next=${encodeURIComponent(`/projects/${projectId}`)}`;

  // Pra user existente, "invite" falha ("user already registered"). Usamos
  // "recovery" pra forçar fluxo de definir/redefinir senha, e "magiclink" pra
  // quem já tem senha (entra direto).
  const { data: linkData, error: linkErr } = hasPassword
    ? await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo },
      })
    : await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });

  if (linkErr || !linkData?.properties?.action_link) {
    console.error(
      "[regenerate-link] generateLink failed:",
      linkErr?.message,
    );
    return NextResponse.json(
      { error: "Não foi possível gerar o link agora." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    link: linkData.properties.action_link,
    type: hasPassword ? "magic_link" : "set_password",
    expiresInHours: 24,
  });
}
