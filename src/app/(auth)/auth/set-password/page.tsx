import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SetPasswordForm } from "./set-password-form";

/**
 * /auth/set-password
 *
 * Página de definição de senha pra guests recém-convidados. Acessada via link
 * de invite (Supabase generateLink type=invite) que cria a sessão e redireciona
 * pra cá. Aqui o user define email+senha pra logins futuros.
 *
 * `?next=` controla pra onde redirecionar depois (default /projects).
 * `?recovery=1` sinaliza fluxo "esqueci a senha": permite redefinir mesmo se
 * o user já tinha senha (sem isso, a checagem `password_set` o expulsaria).
 */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; recovery?: string }>;
}) {
  const { next, recovery } = await searchParams;
  const isRecovery = recovery === "1";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Sem sessão → o link expirou ou nunca foi clicado. Manda pro login.
  if (!user) {
    redirect("/login?error=invalid_link");
  }

  // Se já definiu senha, pula direto pro destino (idempotente) — exceto no
  // fluxo de recovery, onde o objetivo É redefinir a senha.
  const meta = user.user_metadata as { password_set?: boolean } | null;
  if (meta?.password_set && !isRecovery) {
    redirect(next ?? "/projects");
  }

  return (
    <SetPasswordForm
      email={user.email ?? ""}
      next={next ?? "/projects"}
    />
  );
}
