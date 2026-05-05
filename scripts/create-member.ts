/**
 * Create a Member + Supabase Auth user. Generates an 8-digit password.
 *
 * Usage:
 *   npx tsx scripts/create-member.ts \
 *     --name "Levi Nóbrega" \
 *     --email levi@beyondcompany.com.br \
 *     --position cro \
 *     --access admin \
 *     [--specialty fullstack] \
 *     [--external]
 *
 * Flags:
 *   --name        Full name (required)
 *   --email       Email (required)
 *   --position    Job title — one of: ceo, cro, head-ops, pm, principal-engineer, product-builder
 *   --access      Access level — one of: builder, manager, admin (defaults: derived from position)
 *   --specialty   Optional — one of: fullstack, ux-ui, backend, qa, infra, security
 *   --external    Mark as external (default false)
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import {
  POSITIONS,
  MEMBER_ACCESS_LEVELS,
  SPECIALTIES,
  mapPositionToAccessLevel,
  type Position,
  type AccessLevel,
  type Specialty,
} from "../src/lib/roles";

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

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function fail(msg: string): never {
  console.error(`[create-member] ${msg}`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const name = typeof args.name === "string" ? args.name.trim() : "";
  const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
  const position = typeof args.position === "string" ? (args.position as Position) : undefined;
  const accessArg = typeof args.access === "string" ? (args.access as AccessLevel) : undefined;
  const specialty = typeof args.specialty === "string" ? (args.specialty as Specialty) : null;
  const isExternal = args.external === true;

  if (!name) fail("--name is required");
  if (!email) fail("--email is required");
  if (!position) fail(`--position is required. One of: ${POSITIONS.join(", ")}`);
  if (!POSITIONS.includes(position)) {
    fail(`invalid --position "${position}". One of: ${POSITIONS.join(", ")}`);
  }
  if (accessArg && !MEMBER_ACCESS_LEVELS.includes(accessArg)) {
    fail(`invalid --access "${accessArg}". One of: ${MEMBER_ACCESS_LEVELS.join(", ")}`);
  }
  if (specialty && !SPECIALTIES.includes(specialty)) {
    fail(`invalid --specialty "${specialty}". One of: ${SPECIALTIES.join(", ")}`);
  }

  const accessLevel: AccessLevel = accessArg ?? mapPositionToAccessLevel(position);

  const { data: existing } = await supabase
    .from("Member")
    .select("id, email, userId")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    fail(`Member with email ${email} already exists (id=${existing.id})`);
  }

  const password = generate8DigitPassword();
  const memberId = crypto.randomUUID();

  const { data: createData, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
    app_metadata: {
      access_level: accessLevel,
      role: position,
      member_id: memberId,
    },
  });
  if (createError || !createData.user) {
    throw createError ?? new Error("Failed to create auth user");
  }
  const authUserId = createData.user.id;

  const { data: member, error: dbError } = await supabase
    .from("Member")
    .insert({
      id: memberId,
      name,
      email,
      position,
      role: position,
      specialty,
      githubUsername: null,
      fpCapacity: 0,
      isExternal,
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
  console.log(`    position:     ${position}`);
  console.log(`    access_level: ${accessLevel}`);
  if (specialty) console.log(`    specialty:    ${specialty}`);
  console.log(`    email:        ${email}`);
  console.log(`    senha:        ${password}`);
  console.log(`    userId:       ${authUserId}`);
  console.log(`    memberId:     ${memberId}\n`);
}

main().catch((e) => {
  console.error("[create-member] failed:", e);
  process.exit(1);
});
