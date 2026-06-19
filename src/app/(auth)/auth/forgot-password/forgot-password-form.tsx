"use client";

import Link from "next/link";
import { useActionState } from "react";
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
      <span className={`${styles.corner} ${styles.cornerTL}`} aria-hidden />
      <span className={`${styles.corner} ${styles.cornerTR}`} aria-hidden />
      <span className={`${styles.corner} ${styles.cornerBL}`} aria-hidden />
      <span className={`${styles.corner} ${styles.cornerBR}`} aria-hidden />

      <div className={styles.layout}>
        <header className={styles.header}>
          <span className={styles.headerBrand}>volund</span>
          <span>·</span>
          <span>zordon</span>
          <span className={styles.headerRule} />
          <span>{sent ? "link enviado" : "recuperar acesso"}</span>
        </header>

        <div className={styles.body}>
          {sent ? (
            <div className={styles.sent}>
              <div className={styles.sentHead}>
                <span className={styles.sentDot} aria-hidden />
                link enviado
              </div>
              <p className={styles.sentText}>
                Se houver uma conta com esse email, enviamos um link pra você
                definir a senha e entrar.
              </p>
              <p className={styles.sentText}>
                O link vale por <strong>1 hora</strong>. Confira a caixa de
                entrada — e o spam, por via das dúvidas.
              </p>
              <Link href="/login" className={styles.submit}>
                <span className={styles.arrow} aria-hidden>
                  ›
                </span>
                voltar pro login
              </Link>
            </div>
          ) : (
            <>
              <p className={styles.lede}>
                Informe seu email <strong>@volund.com.br</strong> ou{" "}
                <strong>@beyondcompany.com.br</strong>. Enviamos um link pra
                você definir a senha e entrar.
              </p>

              <form action={action} className={styles.form} autoComplete="off">
                <div className={styles.field}>
                  <span className={styles.arrow} aria-hidden>
                    ›
                  </span>
                  <label htmlFor="email" className={styles.label}>
                    email
                  </label>
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

                <button
                  type="submit"
                  className={styles.submit}
                  disabled={pending}
                >
                  <span className={styles.arrow} aria-hidden>
                    ›
                  </span>
                  {pending ? "enviando" : "enviar link de acesso"}
                </button>

                <div className={styles.backRow}>
                  <Link href="/login" className={styles.backLink}>
                    ‹ voltar pro login
                  </Link>
                </div>
              </form>
            </>
          )}
        </div>

        <footer className={styles.footer}>
          <span>
            <span className={styles.footerDot} />
            br-sp-01 · recovery
          </span>
          <span>link · 1h</span>
        </footer>
      </div>
    </div>
  );
}
