import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { OPEN_STATUSES } from "@/lib/function-points";
import { getUser, requireRole, ForbiddenError } from "@/lib/dal";
import {
  ADMIN_ROLE_NAMES,
  mapPositionToAccessLevel,
  type AccessLevel,
} from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const supabase = db();

  // Fetch members from view (includes squad_count and active_task_count)
  const [membersRes, tasksRes] = await Promise.all([
    supabase.from("member_summary").select("*").order("name"),
    // Fetch active tasks with assignments for FP calculation
    supabase
      .from("Task")
      .select("id, functionPoints, status, sprintId, assignments:TaskAssignment(memberId)")
      .in("status", [...OPEN_STATUSES]),
  ]);

  if (membersRes.error) {
    return NextResponse.json({ error: membersRes.error.message }, { status: 500 });
  }

  // Aggregate FP per member from active tasks
  const fpMap: Record<string, number> = {};
  for (const task of (tasksRes.data ?? []) as any[]) {
    const fp = task.functionPoints ?? 0;
    for (const a of task.assignments ?? []) {
      if (a.memberId) {
        fpMap[a.memberId] = (fpMap[a.memberId] ?? 0) + fp;
      }
    }
  }

  const result = (membersRes.data ?? []).map((m: any) => {
    const fpOpen = fpMap[m.id] ?? 0;
    return {
      ...m,
      _count: { squadMemberships: m.squad_count, taskAssignments: m.active_task_count },
      fpOpen,
    };
  });

  return NextResponse.json(result);
}

/**
 * POST /api/members → admin provisions a new member end-to-end.
 * Only admins (head-ops, ceo) can do this.
 *
 * Flow (all upfront — no email confirmation):
 *  1. requireRole(admin)
 *  2. validate email + password
 *  3. supabase.auth.admin.createUser({ email, password, email_confirm: true,
 *     user_metadata: { name }, app_metadata: { role } })
 *  4. insert Member row with userId linked
 *
 * The admin shares the password with the new user out of band (Slack, etc).
 * User logs in at /login with email + password and the role is already set.
 *
 * If member creation fails after the auth user exists, we delete the orphan.
 */
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  try {
    await requireRole(ADMIN_ROLE_NAMES);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return new NextResponse(e.message, { status: 403 });
    }
    throw e;
  }

  const body = await req.json();
  const {
    name,
    email,
    password,
    role,
    position,
    accessLevel,
    specialty,
    githubUsername,
    fpCapacity,
    isExternal,
  } = body;

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    return NextResponse.json(
      { error: "password required (min. 6 chars)" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Allocate the Member id upfront so we can embed it in app_metadata
  // on the auth user — RLS reads member_id from the JWT with zero lookups.
  const memberId = crypto.randomUUID();

  // Resolve the two axes independently:
  //   - position (cargo): from `position` (new), or `role` (legacy alias).
  //   - accessLevel (authz): from `accessLevel` (new), or derived from position.
  // Writing both `role` and `position` keeps the trigger-mirrored coexistence
  // window working; `access_level` is the new authoritative authz field.
  const effectivePosition: string = position ?? role ?? "product-builder";
  const effectiveAccessLevel: AccessLevel =
    (accessLevel as AccessLevel | undefined) ??
    mapPositionToAccessLevel(effectivePosition);

  // 1. Create the auth user — already confirmed, with role + member_id + name
  const { data: createData, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // skip email verification — admin-provisioned
      user_metadata: { name }, // display only; never used for authz
      app_metadata: {
        role: effectivePosition,
        access_level: effectiveAccessLevel,
        member_id: memberId,
      },
    });
  if (createError || !createData.user) {
    console.error("[members POST] createUser failed:", createError?.message);
    return NextResponse.json(
      { error: createError?.message ?? "Failed to create auth user" },
      { status: 400 },
    );
  }
  const authUserId = createData.user.id;

  // 2. Create the Member row linked to the auth user
  const { data: member, error: dbError } = await db()
    .from("Member")
    .insert({
      id: memberId,
      name,
      email,
      role: effectivePosition,
      position: effectivePosition,
      specialty: specialty ?? "fullstack",
      githubUsername: githubUsername ?? null,
      fpCapacity: fpCapacity ?? 125,
      isExternal: isExternal ?? false,
      userId: authUserId,
      updatedAt: new Date().toISOString(),
    })
    .select()
    .single();

  if (dbError) {
    console.error("[members POST] db create failed:", dbError);
    // Don't leave an orphan auth user
    await admin.auth.admin.deleteUser(authUserId).catch(() => {});
    return NextResponse.json(
      { error: "Failed to create member record" },
      { status: 500 },
    );
  }

  return NextResponse.json(member, { status: 201 });
}
