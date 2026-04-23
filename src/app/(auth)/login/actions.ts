"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = {
  error?: string;
} | undefined;

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !email.includes("@")) {
    return { error: "Email inválido." };
  }
  if (!password) {
    return { error: "Informe sua senha." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Mensagem genérica — não vaza se o email existe ou se a senha está errada.
    console.error("[login] signInWithPassword error:", error.message);
    return { error: "Email ou senha incorretos." };
  }

  redirect("/");
}
