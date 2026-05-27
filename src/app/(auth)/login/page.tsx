"use client";

import { useActionState, useEffect, useState } from "react";
import { VolundLogo } from "@/components/volund-logo";
import { LiveTerminal } from "./live-terminal";
import { login, type LoginState } from "./actions";
import styles from "./login.module.css";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    login,
    undefined,
  );
  const [focusActive, setFocusActive] = useState(false);
  const [remember, setRemember] = useState(true);
  const [tokenProcessing, setTokenProcessing] = useState(false);

  // Quando o Supabase rejeita o `redirect_to` (por falta de allowlist),
  // ele cai em /login com o token no fragmento. Detectamos isso aqui,
  // hidratamos a sessão e redirecionamos pra set-password.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || !hash.includes("access_token=")) return;

    setTokenProcessing(true);
    const params = new URLSearchParams(hash.slice(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    const type = params.get("type");

    if (!access_token || !refresh_token) {
      setTokenProcessing(false);
      return;
    }

    (async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      if (error) {
        console.error("[login] setSession from hash failed:", error.message);
        setTokenProcessing(false);
        return;
      }
      // Limpa o fragmento da URL antes de navegar.
      window.history.replaceState(null, "", "/login");
      const dest =
        type === "recovery"
          ? "/auth/set-password?next=/projects"
          : "/projects";
      window.location.replace(dest);
    })();
  }, []);

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
            <span>
              {tokenProcessing ? "ZORDON · VALIDANDO LINK" : "ZORDON · ACESSO"}
            </span>
          </div>
          {tokenProcessing ? (
            <div className={styles.formCard}>
              <p>Validando link de acesso… aguarde.</p>
            </div>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}
