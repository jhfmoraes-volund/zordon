import { ForgotPasswordForm } from "./forgot-password-form";

/**
 * /auth/forgot-password
 *
 * Ponto de entrada do fluxo "esqueci a senha" — também serve como primeiro
 * acesso pra quem nunca definiu senha. O user informa o email; se for de um
 * domínio autorizado e existir conta, recebe um link de recovery por email.
 */
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
