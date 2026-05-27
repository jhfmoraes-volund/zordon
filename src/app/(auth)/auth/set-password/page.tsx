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
 */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Sem sessão → o link expirou ou nunca foi clicado. Manda pro login.
  if (!user) {
    redirect("/login?error=invalid_link");
  }

  // Se já definiu senha, pula direto pro destino (idempotente).
  const meta = user.user_metadata as { password_set?: boolean } | null;
  if (meta?.password_set) {
    redirect(next ?? "/projects");
  }

  return (
    <SetPasswordForm
      email={user.email ?? ""}
      next={next ?? "/projects"}
    />
  );
}
