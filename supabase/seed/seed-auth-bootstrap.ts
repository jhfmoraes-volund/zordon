/**
 * Bootstrap the first admin auth user (password-based).
 *
 * Run once after enabling auth, before anyone tries to log in:
 *
 *   BOOTSTRAP_EMAIL=you@company.com \
 *   BOOTSTRAP_PASSWORD='senha-forte-aqui' \
 *   BOOTSTRAP_NAME="Your Name" \
 *     npx tsx supabase/seed/seed-auth-bootstrap.ts
 *
 * Env vars consumed:
 *   - SUPABASE_SERVICE_ROLE_KEY (required)
 *   - NEXT_PUBLIC_SUPABASE_URL  (required)
 *   - BOOTSTRAP_EMAIL           (required)
 *   - BOOTSTRAP_PASSWORD        (required, min 6 chars)
 *   - BOOTSTRAP_NAME            (optional, defaults to email local-part)
 *   - BOOTSTRAP_ROLE            (optional, defaults to "head-ops")
 *
 * What it does:
 *   1. If an auth user with this email already exists: update password + role
 *      (idempotent reset).
 *   2. Otherwise: create the auth user with email_confirm=true (no email sent).
 *   3. Upsert the Member row, linked to the auth user via userId.
 *
 * Safe to re-run — useful to reset a forgotten admin password.
 */
import "dotenv/config";
import { createClient as createSupabase } from "@supabase/supabase-js";

const supabase = createSupabase(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  const email = process.env.BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_PASSWORD;
  const name =
    process.env.BOOTSTRAP_NAME?.trim() || (email ? email.split("@")[0] : "");
  const role = process.env.BOOTSTRAP_ROLE?.trim() || "head-ops";

  if (!email) throw new Error("BOOTSTRAP_EMAIL is required");
  if (!password || password.length < 6) {
    throw new Error("BOOTSTRAP_PASSWORD is required (min 6 chars)");
  }
  const admin = supabase;

  console.log(`[bootstrap] email=${email} role=${role}`);

  // 1. Look for an existing auth user
  const { data: list, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw listError;
  const existing = list.users.find((u) => u.email?.toLowerCase() === email);

  let authUserId: string;
  if (existing) {
    console.log(`[bootstrap] auth user already exists: ${existing.id} → resetting password + role`);
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      app_metadata: { role },
      user_metadata: { name },
      email_confirm: true,
    });
    if (error) throw error;
    authUserId = existing.id;
  } else {
    console.log(`[bootstrap] creating auth user…`);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
      app_metadata: { role },
    });
    if (error || !data.user) {
      throw error ?? new Error("createUser returned no user");
    }
    authUserId = data.user.id;
    console.log(`[bootstrap] created; auth user id = ${authUserId}`);
  }

  // 2. Upsert the Member row linked to this auth user
  const now = new Date().toISOString();
  const { data: existing_member } = await supabase
    .from("Member").select("id").eq("userId", authUserId).maybeSingle();

  let member;
  if (existing_member) {
    const { data } = await supabase
      .from("Member").update({ name, email, role }).eq("id", existing_member.id).select().single();
    member = data;
  } else {
    const { data } = await supabase
      .from("Member").insert({ name, email, role, userId: authUserId, fpCapacity: 50, updatedAt: now }).select().single();
    member = data;
  }

  console.log(
    `[bootstrap] member ready: id=${member.id} name=${member.name} role=${member.role}`,
  );
  console.log("");
  console.log("───────────────────────────────────────────────");
  console.log("Login at /login with:");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log("───────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error("[bootstrap] failed:", e);
    process.exit(1);
  });
