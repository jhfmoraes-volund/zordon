"use client";

import { useActionState, useEffect, useState } from "react";
import { LiveStream } from "./live-terminal";
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
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(
        [d.getHours(), d.getMinutes(), d.getSeconds()]
          .map((n) => String(n).padStart(2, "0"))
          .join(":"),
      );
    };
    queueMicrotask(tick);
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Quando o Supabase rejeita o `redirect_to` (por falta de allowlist),
  // ele cai em /login com o token no fragmento. Detectamos isso aqui,
  // hidratamos a sessão e redirecionamos pra set-password.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || !hash.includes("access_token=")) return;

    const params = new URLSearchParams(hash.slice(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    const type = params.get("type");
    if (!access_token || !refresh_token) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setTokenProcessing(true);
    });

    (async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      if (cancelled) return;
      if (error) {
        console.error("[login] setSession from hash failed:", error.message);
        setTokenProcessing(false);
        return;
      }
      window.history.replaceState(null, "", "/login");
      const dest =
        type === "recovery"
          ? "/auth/set-password?next=/projects&recovery=1"
          : "/projects";
      window.location.replace(dest);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
          <span>{tokenProcessing ? "validando" : "acesso"}</span>
        </header>

        <LiveStream focusActive={focusActive} />

        {tokenProcessing ? (
          <div className={styles.form}>
            <p className={styles.label}>validando link de acesso · aguarde</p>
          </div>
        ) : (
          <form action={action} className={styles.form} autoComplete="off">
            <div className={styles.field}>
              <span className={styles.arrow} aria-hidden>›</span>
              <label htmlFor="email" className={styles.label}>email</label>
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
              <span className={styles.arrow} aria-hidden>›</span>
              <label htmlFor="password" className={styles.label}>chave</label>
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
                <span className={styles.toggle}>{remember ? "[x]" : "[ ]"}</span>
                manter sessão
              </label>
              <a href="/auth/forgot-password">esqueci a chave</a>
            </div>

            {state?.error && <p className={styles.error}>{state.error}</p>}

            <button type="submit" className={styles.submit} disabled={pending}>
              <span className={styles.arrow} aria-hidden>›</span>
              {pending ? "verificando" : "authenticate"}
            </button>
          </form>
        )}

        <footer className={styles.footer}>
          <span>
            <span className={styles.footerDot} />
            br-sp-01 · stream
          </span>
          <span>{now || "--:--:--"}</span>
        </footer>
      </div>
    </div>
  );
}
