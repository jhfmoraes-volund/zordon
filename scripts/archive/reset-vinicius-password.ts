/**
 * One-shot: reset a member's auth password to a fresh 8-digit numeric.
 * Run: npx tsx scripts/reset-vinicius-password.ts <name-substring>
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
  // 8 numeric digits, uniform random
  let s = "";
  for (let i = 0; i < 8; i++) s += crypto.randomInt(0, 10).toString();
  return s;
}

async function main() {
  const needle = process.argv[2] ?? "vinicius";

  const { data: member, error: memErr } = await supabase
    .from("Member")
    .select("id, name, email, role, userId")
    .ilike("name", `%${needle}%`)
    .single();

  if (memErr || !member) throw memErr ?? new Error(`Member matching "${needle}" not found`);
  if (!member.userId) throw new Error(`Member ${member.name} has no userId linked`);

  const password = generate8DigitPassword();

  const { error: updErr } = await supabase.auth.admin.updateUserById(member.userId, {
    password,
    email_confirm: true,
    app_metadata: { role: member.role },
  });

  if (updErr) throw updErr;

  console.log("\n═══════════════════════════════════════════════");
  console.log("  CREDENCIAIS (compartilhe fora do sistema)");
  console.log("═══════════════════════════════════════════════\n");
  console.log(`  ${member.name}`);
  console.log(`    email:  ${member.email}`);
  console.log(`    senha:  ${password}`);
  console.log("");
}

main().catch((e) => {
  console.error("[reset-vinicius-password] failed:", e);
  process.exit(1);
});
