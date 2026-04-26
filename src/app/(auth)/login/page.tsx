"use client";

import { useActionState, useState } from "react";
import { VolundLogo } from "@/components/volund-logo";
import { LiveTerminal } from "./live-terminal";
import { login, type LoginState } from "./actions";
import styles from "./login.module.css";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    login,
    undefined,
  );
  const [focusActive, setFocusActive] = useState(false);
  const [remember, setRemember] = useState(true);

  return (
    <div className={styles.stage}>
      <div className={styles.topbar}>
        <div className={styles.lockup}>
          <VolundLogo className={styles.logo} color="currentColor" />
          <span className={styles.zordonTag}>ZORDON</span>
        </div>
      </div>

      <div className={styles.layout}>
        <LiveTerminal focusActive={focusActive} />

        <div className={styles.formWrap}>
          <div className={styles.formEyebrow}>
            <span className={styles.pip} />
            <span>ZORDON · ACESSO</span>
          </div>
          <form action={action} className={styles.formCard} autoComplete="off">
            <div className={styles.field}>
              <div className={styles.fieldLabel}>
                <span>Usuário</span>
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
                onFocus={() => setFocusActive(true)}
                onBlur={() => setFocusActive(false)}
                disabled={pending}
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <div className={styles.fieldLabel}>
                <span>Chave de acesso</span>
                <span className={styles.hint}>REQ</span>
              </div>
              <input
                className={styles.input}
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••••••"
                onFocus={() => setFocusActive(true)}
                onBlur={() => setFocusActive(false)}
                disabled={pending}
              />
            </div>

            <div className={styles.row}>
              <label>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span className={styles.check} />
                Manter sessão
              </label>
              <a href="#" onClick={(e) => e.preventDefault()}>
                Esqueci a chave
              </a>
            </div>

            {state?.error && <p className={styles.error}>{state.error}</p>}

            <button type="submit" className={styles.submit} disabled={pending}>
              {pending ? "Verificando…" : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
