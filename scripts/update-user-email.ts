/**
 * One-shot: atualiza o e-mail de UM usuário (busca pelo e-mail atual) via admin API.
 * Run: npx tsx scripts/update-user-email.ts <emailAtual> <emailNovo>
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
  const [current, next] = process.argv.slice(2);
  if (!current || !next) {
    console.error("Usage: npx tsx scripts/update-user-email.ts <emailAtual> <emailNovo>");
    process.exit(1);
  }

  const user = await findUserByEmail(current);
  if (!user) throw new Error(`Usuário não encontrado: ${current}`);

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    email: next,
    email_confirm: true,
  });
  if (error) throw error;

  console.log(`\n  ✓ ${user.id}`);
  console.log(`    ${current} -> ${next}\n`);
}

main().catch((e) => {
  console.error("[update-user-email] failed:", e);
  process.exit(1);
});
