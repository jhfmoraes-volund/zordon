import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { OPEN_STATUSES } from "@/lib/function-points";
import { getUser, requireRole, ForbiddenError } from "@/lib/dal";
import {
  ADMIN_ROLE_NAMES,
  mapPositionToAccessLevel,
  SPECIALTIES,
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
    // Fetch active tasks with assignments for PFV calculation
    supabase
      .from("Task")
      .select("id, functionPoints, status, sprintId, assignments:TaskAssignment(memberId)")
      .in("status", [...OPEN_STATUSES])
      .is("dismissedAt", null),
  ]);

  if (membersRes.error) {
    return NextResponse.json({ error: membersRes.error.message }, { status: 500 });
  }

  // Aggregate PFV per member from active tasks
  type TaskRow = {
    functionPoints: number | null;
    assignments: { memberId: string | null }[] | null;
  };
  const fpMap: Record<string, number> = {};
  for (const task of (tasksRes.data ?? []) as TaskRow[]) {
    const fp = task.functionPoints ?? 0;
    for (const a of task.assignments ?? []) {
      if (a.memberId) {
        fpMap[a.memberId] = (fpMap[a.memberId] ?? 0) + fp;
      }
    }
  }

  type MemberSummaryRow = Record<string, unknown> & {
    id: string;
    squad_count: number;
    active_task_count: number;
  };
  const result = ((membersRes.data ?? []) as MemberSummaryRow[]).map((m) => {
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
 * POST /api/members → admin provisions a new member. Admin-only.
 *
 * Two modes (controlled by `createAccount`, default true):
 *  - **com conta** (`createAccount: true`): cria o auth user (email + senha,
 *    já confirmado) e vincula `Member.userId`. Senha definida pelo admin, nunca
 *    exibida em texto puro no cliente (campo mascarado). Position opcional.
 *  - **sem conta** (`createAccount: false`): só cria a `Member` row com
 *    `userId: null`. Pra registros externos (cedidos por outra empresa) que não
 *    precisam logar. Sem senha, sem cargo obrigatório.
 *
 * O admin entrega a senha pro membro fora do sistema; o membro loga em /login.
 * Se a Member row falhar depois do auth user existir, removemos o órfão.
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
  const createAccount = body.createAccount !== false; // default: cria conta

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  if (
    specialty != null &&
    !(SPECIALTIES as readonly string[]).includes(specialty)
  ) {
    return NextResponse.json(
      { error: `specialty deve ser uma torre: ${SPECIALTIES.join(", ")}` },
      { status: 400 },
    );
  }
  if (createAccount) {
    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "password required (min. 6 chars)" },
        { status: 400 },
      );
    }
  }

  const admin = createAdminClient();

  // Allocate the Member id upfront so we can embed it in app_metadata
  // on the auth user — RLS reads member_id from the JWT with zero lookups.
  const memberId = crypto.randomUUID();

  // Resolve the two axes independently:
  //   - position (cargo): from `position` (new), or `role` (legacy alias). Pode
  //     ficar null (ex: externo/conta a nível de grupo sem cargo).
  //   - accessLevel (authz): from `accessLevel` (new), or derived from position.
  const effectivePosition: string | null = position ?? role ?? null;
  const effectiveAccessLevel: AccessLevel =
    (accessLevel as AccessLevel | undefined) ??
    mapPositionToAccessLevel(effectivePosition);

  // 1. Cria o auth user só quando há conta de login.
  let authUserId: string | null = null;
  if (createAccount) {
    const { data: createData, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // skip email verification — admin-provisioned
        user_metadata: { name }, // display only; never used for authz
        app_metadata: {
          role: effectivePosition ?? "guest",
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
    authUserId = createData.user.id;
  }

  // 2. Create the Member row (linked to the auth user when there is one).
  const { data: member, error: dbError } = await db()
    .from("Member")
    .insert({
      id: memberId,
      name,
      email,
      // `role` é NOT NULL (default legado 'fullstack', sem sentido como cargo).
      // Espelha position; cai em 'guest' quando não há cargo (externo/grupo).
      role: effectivePosition ?? "guest",
      position: effectivePosition,
      specialty: specialty ?? null,
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
    if (authUserId) await admin.auth.admin.deleteUser(authUserId).catch(() => {});
    return NextResponse.json(
      { error: "Failed to create member record" },
      { status: 500 },
    );
  }

  return NextResponse.json(member, { status: 201 });
}
