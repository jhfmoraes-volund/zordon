"use client";

import Link from "next/link";
import { useActionState } from "react";
import { VolundLogo } from "@/components/volund-logo";
import styles from "../../login/login.module.css";
import { requestPasswordReset, type ForgotState } from "./actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(
    requestPasswordReset,
    undefined,
  );

  const sent = state && "ok" in state && state.ok;
  const error = state && "error" in state ? state.error : null;

  return (
    <div className={styles.stage}>
      <div className={styles.topbar}>
        <div className={styles.lockup}>
          <VolundLogo className={styles.logo} color="currentColor" />
          <span className={styles.zordonTag}>ZORDON</span>
        </div>
      </div>

      <div className={styles.layout}>
        <div className={styles.formWrap}>
          <div className={styles.formEyebrow}>
            <span className={styles.pip} />
            <span>ZORDON · ACESSO</span>
          </div>

          {sent ? (
            <div className={styles.formCard}>
              <p style={{ fontSize: 13, marginBottom: 12 }}>
                Se houver uma conta com esse email, enviamos um link pra você
                definir a senha e entrar.
              </p>
              <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 16 }}>
                O link vale por 1 hora. Confira a caixa de entrada (e o spam).
              </p>
              <Link
                href="/login"
                className={styles.submit}
                style={{ textDecoration: "none" }}
              >
                Voltar pro login
              </Link>
            </div>
          ) : (
            <form action={action} className={styles.formCard} autoComplete="off">
              <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
                Informe seu email <strong>@volund.com.br</strong> ou{" "}
                <strong>@beyondcompany.com.br</strong>. Enviamos um link pra você
                definir a senha e acessar.
              </p>

              <div className={styles.field}>
                <div className={styles.fieldLabel}>
                  <span>Email</span>
                  <span className={styles.hint}>REQ</span>
                </div>
                <input
                  className={styles.input}
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="operador@volund.com.br"
                  disabled={pending}
                  autoFocus
                />
              </div>

              {error && <p className={styles.error}>{error}</p>}

              <button type="submit" className={styles.submit} disabled={pending}>
                {pending ? "Enviando…" : "Enviar link de acesso"}
              </button>

              <p style={{ fontSize: 12, marginTop: 14, textAlign: "center" }}>
                <Link href="/login">Voltar pro login</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
