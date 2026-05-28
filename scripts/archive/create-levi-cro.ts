/**
 * One-shot: create Levi Nóbrega (CRO) — Member row + Supabase Auth user.
 * Run: npx tsx scripts/create-levi-cro.ts
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function generate8DigitPassword(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += crypto.randomInt(0, 10).toString();
  return s;
}

async function main() {
  const name = "Levi Nóbrega";
  const email = "levi@beyondcompany.com.br";
  const role = "cro";

  // Bail out if already provisioned
  const { data: existing } = await supabase
    .from("Member")
    .select("id, email, userId")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    throw new Error(`Member with email ${email} already exists (id=${existing.id})`);
  }

  const password = generate8DigitPassword();
  const memberId = crypto.randomUUID();

  // 1. Auth user
  const { data: createData, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
    app_metadata: { role, member_id: memberId },
  });
  if (createError || !createData.user) {
    throw createError ?? new Error("Failed to create auth user");
  }
  const authUserId = createData.user.id;

  // 2. Member row
  const { data: member, error: dbError } = await supabase
    .from("Member")
    .insert({
      id: memberId,
      name,
      email,
      role,
      specialty: "fullstack",
      githubUsername: null,
      fpCapacity: 0,
      isExternal: false,
      userId: authUserId,
      updatedAt: new Date().toISOString(),
    })
    .select()
    .single();

  if (dbError || !member) {
    await supabase.auth.admin.deleteUser(authUserId).catch(() => {});
    throw dbError ?? new Error("Failed to insert Member row");
  }

  console.log("\n═══════════════════════════════════════════════");
  console.log("  CREDENCIAIS (compartilhe fora do sistema)");
  console.log("═══════════════════════════════════════════════\n");
  console.log(`  ${name}`);
  console.log(`    role:   ${role}`);
  console.log(`    email:  ${email}`);
  console.log(`    senha:  ${password}`);
  console.log(`    userId: ${authUserId}`);
  console.log(`    memberId: ${memberId}\n`);
}

main().catch((e) => {
  console.error("[create-levi-cro] failed:", e);
  process.exit(1);
});
