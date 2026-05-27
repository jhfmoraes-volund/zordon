"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { VolundLogo } from "@/components/volund-logo";
import { createClient } from "@/lib/supabase/client";
import styles from "../../login/login.module.css";

const MIN_PASSWORD = 8;

export function SetPasswordForm({
  email,
  next,
}: {
  email: string;
  next: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`Senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError("As senhas não batem.");
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      const { error: updateErr } = await supabase.auth.updateUser({
        password,
        data: { password_set: true },
      });
      if (updateErr) {
        setError(updateErr.message);
        setPending(false);
        return;
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao definir senha.");
      setPending(false);
    }
  }

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
            <span>ZORDON · DEFINIR SENHA</span>
          </div>
          <form onSubmit={onSubmit} className={styles.formCard} autoComplete="off">
            <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
              Bem-vindo! Defina uma senha pra acessar como{" "}
              <strong>{email}</strong> nos próximos logins.
            </p>

            <div className={styles.field}>
              <div className={styles.fieldLabel}>
                <span>Nova senha</span>
                <span className={styles.hint}>MIN 8</span>
              </div>
              <input
                className={styles.input}
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD}
                autoComplete="new-password"
                placeholder="••••••••••••"
                disabled={pending}
                autoFocus
              />
            </div>

            <div className={styles.field}>
              <div className={styles.fieldLabel}>
                <span>Confirmar senha</span>
                <span className={styles.hint}>REQ</span>
              </div>
              <input
                className={styles.input}
                id="confirm"
                name="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={MIN_PASSWORD}
                autoComplete="new-password"
                placeholder="••••••••••••"
                disabled={pending}
              />
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <button type="submit" className={styles.submit} disabled={pending}>
              {pending ? "Salvando…" : "Definir senha e entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
