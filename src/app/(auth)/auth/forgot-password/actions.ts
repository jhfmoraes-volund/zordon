"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isEmailAllowed, passwordResetEmail, sendEmail } from "@/lib/email";

export type ForgotState =
  | { ok: true }
  | { error: string }
  | undefined;

/**
 * Fluxo "esqueci a senha" / primeiro acesso.
 *
 * Gera um link de recovery (Supabase admin) e manda por email via Resend.
 * O link cai em /auth/set-password?recovery=1, onde o user define a senha.
 *
 * Regras:
 *  - Só manda email pra domínios autorizados (@volund / @beyond). Domínio fora
 *    da lista recebe erro explícito (é política, não vaza existência de conta).
 *  - Se o email é de domínio válido mas a conta não existe, devolvemos sucesso
 *    genérico — não revelamos quem está (ou não) cadastrado.
 */
export async function requestPasswordReset(
  _prev: ForgotState,
  formData: FormData,
): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email || !email.includes("@")) {
    return { error: "Email inválido." };
  }
  if (!isEmailAllowed(email)) {
    return {
      error:
        "Só enviamos link de acesso pra emails @volund.com.br ou @beyondcompany.com.br.",
    };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const redirectTo = `${siteUrl}/auth/set-password?next=${encodeURIComponent(
    "/projects",
  )}&recovery=1`;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  // generateLink falha quando o email não existe em auth.users. Não vaza:
  // loga e devolve o mesmo sucesso genérico do caminho feliz.
  if (error || !data?.properties?.action_link) {
    console.error("[forgot-password] generateLink:", error?.message);
    return { ok: true };
  }

  const { subject, html, text } = passwordResetEmail({
    resetLink: data.properties.action_link,
  });
  const sent = await sendEmail({ to: email, subject, html, text });

  if (!sent.ok) {
    console.error("[forgot-password] sendEmail failed:", sent.error);
    return { error: "Não foi possível enviar o email agora. Tente de novo." };
  }

  return { ok: true };
}
