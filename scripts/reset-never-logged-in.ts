/**
 * One-shot: reseta a senha de TODOS os usuários que nunca acessaram
 * (auth.users.last_sign_in_at IS NULL) para uma senha padrão fixa.
 *
 * Run: npx tsx scripts/reset-never-logged-in.ts [--apply]
 *   sem --apply → dry-run (só lista quem seria afetado)
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_PASSWORD = "hexa2026";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function listNeverLoggedIn() {
  const targets: { id: string; email: string; name: string }[] = [];
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) {
      if (!u.last_sign_in_at) {
        targets.push({
          id: u.id,
          email: u.email ?? "(sem email)",
          name: (u.user_metadata?.name as string) ?? "",
        });
      }
    }
    if (data.users.length < 1000) break;
    page += 1;
  }
  return targets;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const targets = await listNeverLoggedIn();

  console.log(`\n${targets.length} usuário(s) nunca acessaram:\n`);
  for (const t of targets) console.log(`  • ${t.name.padEnd(20)} ${t.email}`);

  if (!apply) {
    console.log(`\n[dry-run] Nada alterado. Rode com --apply para resetar a senha para "${DEFAULT_PASSWORD}".\n`);
    return;
  }

  console.log(`\nResetando senha para "${DEFAULT_PASSWORD}"...\n`);
  for (const t of targets) {
    const { error } = await supabase.auth.admin.updateUserById(t.id, {
      password: DEFAULT_PASSWORD,
      email_confirm: true,
    });
    if (error) {
      console.error(`  ✗ ${t.email}: ${error.message}`);
    } else {
      console.log(`  ✓ ${t.email}`);
    }
  }
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  Senha padrão para todos acima: ${DEFAULT_PASSWORD}`);
  console.log(`  (compartilhe fora do sistema; peça troca no 1º acesso)`);
  console.log(`═══════════════════════════════════════════════\n`);
}

main().catch((e) => {
  console.error("[reset-never-logged-in] failed:", e);
  process.exit(1);
});
