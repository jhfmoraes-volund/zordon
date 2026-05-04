/**
 * One-shot: sync auth.users email with Member.email and reset password.
 * Run: npx tsx scripts/reset-credentials.ts <memberId> [<memberId> ...]
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

async function resetOne(memberId: string) {
  const { data: member, error: memErr } = await supabase
    .from("Member")
    .select("id, name, email, role, userId")
    .eq("id", memberId)
    .single();

  if (memErr || !member) throw memErr ?? new Error(`Member ${memberId} not found`);
  if (!member.userId) throw new Error(`Member ${member.name} has no userId linked`);

  const password = generate8DigitPassword();

  const { error: updErr } = await supabase.auth.admin.updateUserById(member.userId, {
    email: member.email!,
    password,
    email_confirm: true,
    app_metadata: { role: member.role, member_id: member.id },
  });

  if (updErr) throw updErr;

  return { name: member.name, email: member.email, password };
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Usage: npx tsx scripts/reset-credentials.ts <memberId> [<memberId> ...]");
    process.exit(1);
  }

  const results = [];
  for (const id of ids) results.push(await resetOne(id));

  console.log("\n═══════════════════════════════════════════════");
  console.log("  CREDENCIAIS (compartilhe fora do sistema)");
  console.log("═══════════════════════════════════════════════\n");
  for (const r of results) {
    console.log(`  ${r.name}`);
    console.log(`    email:  ${r.email}`);
    console.log(`    senha:  ${r.password}`);
    console.log("");
  }
}

main().catch((e) => {
  console.error("[reset-credentials] failed:", e);
  process.exit(1);
});
