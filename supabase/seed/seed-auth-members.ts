/**
 * Provision Supabase Auth for all members that don't have a userId yet.
 *
 * Usage:
 *   npx tsx supabase/seed/seed-auth-members.ts
 *
 * For each member without auth:
 *   1. Creates an auth user with a random temporary password
 *   2. Links the member row via userId
 *   3. Prints credentials so admin can share out-of-band
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function generatePassword(): string {
  // 12-char alphanumeric — temporary, admin should ask users to change
  return crypto.randomBytes(9).toString("base64url").slice(0, 12);
}

async function main() {
  // 1. Fetch members without auth (userId is null)
  const { data: members, error } = await supabase
    .from("Member")
    .select("id, name, email, role")
    .is("userId", null);

  if (error) throw error;
  if (!members || members.length === 0) {
    console.log("All members already have auth users. Nothing to do.");
    return;
  }

  console.log(`Found ${members.length} member(s) without auth:\n`);

  const credentials: { name: string; email: string; password: string }[] = [];

  for (const m of members) {
    const password = generatePassword();

    // Create auth user
    const { data, error: createError } =
      await supabase.auth.admin.createUser({
        email: m.email,
        password,
        email_confirm: true,
        user_metadata: { name: m.name },
        app_metadata: { role: m.role },
      });

    if (createError || !data.user) {
      console.error(`  ✗ ${m.name} (${m.email}): ${createError?.message}`);
      continue;
    }

    // Link member to auth user
    const { error: updateError } = await supabase
      .from("Member")
      .update({ userId: data.user.id })
      .eq("id", m.id);

    if (updateError) {
      console.error(`  ✗ ${m.name}: auth created but failed to link: ${updateError.message}`);
      // Clean up orphan
      await supabase.auth.admin.deleteUser(data.user.id).catch(() => {});
      continue;
    }

    credentials.push({ name: m.name, email: m.email, password });
    console.log(`  ✓ ${m.name} (${m.email}) → auth user ${data.user.id}`);
  }

  if (credentials.length > 0) {
    console.log("\n═══════════════════════════════════════════════");
    console.log("  CREDENCIAIS (compartilhe fora do sistema)");
    console.log("═══════════════════════════════════════════════\n");
    for (const c of credentials) {
      console.log(`  ${c.name}`);
      console.log(`    email:  ${c.email}`);
      console.log(`    senha:  ${c.password}`);
      console.log("");
    }
    console.log("Peça aos membros que troquem a senha no primeiro acesso.");
  }
}

main().catch((e) => {
  console.error("[seed-auth-members] failed:", e);
  process.exit(1);
});
