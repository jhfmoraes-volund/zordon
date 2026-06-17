import "server-only";

/**
 * Minimal email sender. Uses the Resend REST API directly (no SDK dep).
 *
 * If RESEND_API_KEY isn't set, logs to console — useful in dev and during
 * Phase-1 where email infra isn't wired yet. Returns { ok } either way.
 */

const RESEND_FROM = process.env.RESEND_FROM ?? "Zordon <onboarding@resend.dev>";

/**
 * Domínios autorizados a receber email transacional do Zordon. Regra de
 * negócio: só mandamos email pra gente da casa (Volund / Beyond). Qualquer
 * outro destinatário é silenciosamente recusado antes de chamar o Resend.
 */
export const ALLOWED_EMAIL_DOMAINS = [
  "volund.com.br",
  "beyondcompany.com.br",
] as const;

/** True se o email pertence a um domínio autorizado a receber email. */
export function isEmailAllowed(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return (ALLOWED_EMAIL_DOMAINS as readonly string[]).includes(domain);
}

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: SendArgs): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY missing — logging instead.\n  to: ${to}\n  subject: ${subject}\n  body:\n${text ?? html}`,
    );
    return { ok: true };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: RESEND_FROM, to, subject, html, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("[email] resend failed:", res.status, body);
      return { ok: false, error: `resend ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email] send threw:", msg);
    return { ok: false, error: msg };
  }
}

export function projectAccessInviteEmail(opts: {
  projectName: string;
  inviterName: string;
  magicLink: string;
}): { subject: string; html: string; text: string } {
  const { projectName, inviterName, magicLink } = opts;
  const subject = `${inviterName} compartilhou ${projectName} com você no Zordon`;
  const text = `${inviterName} te deu acesso ao projeto "${projectName}".

Acesse pelo link abaixo (válido por 24h):
${magicLink}

Se você não esperava este convite, ignore este email.
`;
  const html = `<!doctype html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
  <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 16px;">Você foi convidado ao Zordon</h2>
  <p style="margin: 0 0 12px;"><strong>${escapeHtml(inviterName)}</strong> compartilhou o projeto <strong>${escapeHtml(projectName)}</strong> com você.</p>
  <p style="margin: 0 0 24px;">Acesse pelo link abaixo (válido por 24h).</p>
  <p style="margin: 0 0 24px;">
    <a href="${magicLink}" style="display: inline-block; padding: 10px 18px; background: #111; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500;">Acessar projeto</a>
  </p>
  <p style="margin: 0; color: #666; font-size: 12px;">Se você não esperava este convite, ignore este email.</p>
</body></html>`;
  return { subject, html, text };
}

export function passwordResetEmail(opts: {
  resetLink: string;
}): { subject: string; html: string; text: string } {
  const { resetLink } = opts;
  const subject = "Seu acesso ao Zordon";
  const text = `Você pediu pra definir sua senha de acesso ao Zordon.

Abra o link abaixo (válido por 1 hora) pra criar sua senha e entrar:
${resetLink}

Se você não pediu isto, pode ignorar este email com segurança.
`;
  const html = `<!doctype html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
  <h2 style="font-size: 18px; font-weight: 600; margin: 0 0 16px;">Acesso ao Zordon</h2>
  <p style="margin: 0 0 12px;">Você pediu pra definir sua senha de acesso ao Zordon.</p>
  <p style="margin: 0 0 24px;">Clique no botão abaixo pra criar sua senha e entrar. O link é válido por 1 hora.</p>
  <p style="margin: 0 0 24px;">
    <a href="${resetLink}" style="display: inline-block; padding: 10px 18px; background: #111; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500;">Definir senha e entrar</a>
  </p>
  <p style="margin: 0; color: #666; font-size: 12px;">Se você não pediu isto, pode ignorar este email com segurança.</p>
</body></html>`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
