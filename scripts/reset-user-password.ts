/**
 * One-shot: reseta a senha de UM usuário (por e-mail) via admin API.
 * Run: npx tsx scripts/reset-user-password.ts <email> <novaSenha>
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function findUserByEmail(email: string) {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 1000) return null;
    page += 1;
  }
}

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: npx tsx scripts/reset-user-password.ts <email> <novaSenha>");
    process.exit(1);
  }

  const user = await findUserByEmail(email);
  if (!user) throw new Error(`Usuário não encontrado: ${email}`);

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
  });
  if (error) throw error;

  console.log(`\n  ✓ ${user.email} (${(user.user_metadata?.name as string) ?? "?"})`);
  console.log(`    senha agora: ${password}\n`);
}

main().catch((e) => {
  console.error("[reset-user-password] failed:", e);
  process.exit(1);
});
