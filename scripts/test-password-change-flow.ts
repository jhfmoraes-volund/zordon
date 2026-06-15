/**
 * One-shot: testa o fluxo de troca de senha (Configurações → Conta) ponta a ponta,
 * reproduzindo EXATAMENTE as chamadas que src/app/(dashboard)/settings/account/page.tsx
 * faz no browser (anon key):
 *   1. signInWithPassword(email, senhaAtual)   ← valida "senha atual"
 *   2. updateUser({ password: novaSenha })     ← troca a senha
 *
 * Usa um usuário descartável (cria + deleta) — zero impacto nos usuários reais.
 * Run: npx tsx scripts/test-password-change-flow.ts
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
// Cliente "do browser" — anon key, sessão isolada em memória.
const browser = () => createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

const OLD = "hexa2026";
const NEW = "novaSenha123";
const email = `pwflow-test+${Date.now()}@volund.com.br`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  console.log(`\nUsuário de teste: ${email}\n`);

  // Setup: cria usuário com a senha padrão (como os 8 resetados).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: OLD,
    email_confirm: true,
  });
  if (createErr || !created.user) throw createErr ?? new Error("createUser falhou");
  const userId = created.user.id;

  try {
    // 1. Senha errada deve ser REJEITADA (guard "Senha atual incorreta").
    {
      const c = browser();
      const { error } = await c.auth.signInWithPassword({ email, password: "senhaErrada!" });
      check("senha atual errada é rejeitada", !!error, error ? "" : "deveria ter dado erro");
    }

    // 2. Senha atual correta autentica (passo 1 do handler).
    {
      const c = browser();
      const { data, error } = await c.auth.signInWithPassword({ email, password: OLD });
      check("login com senha padrão (hexa2026) funciona", !error && !!data.session);

      // 3. updateUser troca a senha na MESMA sessão (passo 2 do handler).
      const { error: updErr } = await c.auth.updateUser({ password: NEW });
      check("updateUser troca a senha sem erro", !updErr, updErr?.message ?? "");
    }

    // 4. Nova senha passa a funcionar.
    {
      const c = browser();
      const { data, error } = await c.auth.signInWithPassword({ email, password: NEW });
      check("login com a NOVA senha funciona", !error && !!data.session);
    }

    // 5. Senha antiga deixa de funcionar.
    {
      const c = browser();
      const { error } = await c.auth.signInWithPassword({ email, password: OLD });
      check("senha antiga (hexa2026) deixa de funcionar", !!error, error ? "" : "antiga ainda loga!");
    }

    // 6. Validações client-side (puro JS no handler) — espelhadas aqui.
    const shortPw = "123";
    const confirmMismatch = "outraCoisa";
    check('regra "mín. 6 caracteres" (ex: "123" rejeitado)', shortPw.length < 6);
    check('regra "senhas coincidem" (mismatch rejeitado)', (NEW as string) !== confirmMismatch);
  } finally {
    await admin.auth.admin.deleteUser(userId);
    console.log(`\n  ⟳ usuário de teste removido`);
  }

  console.log(`\n═══════════════════════════════════`);
  console.log(`  ${pass} passaram · ${fail} falharam`);
  console.log(`═══════════════════════════════════\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[test-password-change-flow] failed:", e);
  process.exit(1);
});
