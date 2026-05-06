import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser, getRealRole, requireMinLevelApi } from "@/lib/dal";
import {
  MANAGER,
  hasMinLevel,
  resolveAccessLevel,
  positionLabel,
  type AccessLevel,
  type Position,
} from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { projectAccessInviteEmail, sendEmail } from "@/lib/email";

const ALLOWED_ROLES = [
  "viewer",
  "session_participant",
  "contributor",
  "lead",
] as const;
type AccessRole = (typeof ALLOWED_ROLES)[number];

type AccessRow = {
  userId: string;
  email: string | null;
  name: string | null;
  role: AccessRole;
  isMember: boolean;
  memberId: string | null;
  fpAllocation: number | null;
  grantedAt: string;
  // Manager rows have implicit full access (is_manager() bypass) and are
  // surfaced even without a ProjectAccess row. UI hides role-edit / revoke.
  isManager: boolean;
  /** Job title (cargo) — for display next to the manager chip. */
  managerPosition: Position | null;
  managerPositionLabel: string | null;
  /** Resolved access level (manager / admin). */
  managerAccessLevel: AccessLevel | null;
};

/**
 * GET /api/projects/[id]/access
 * Lists every user with access to this project, joined with member info
 * (name, fpAllocation) when applicable. Manager-only.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;
  const { id: projectId } = await params;

  const supabase = db();
  const admin = createAdminClient();

  // Pull every auth.user upfront for name/email fallback and to resolve the
  // PM responsável's position/access level for the chip.
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr)
    return NextResponse.json({ error: listErr.message }, { status: 500 });

  const authMap = new Map<
    string,
    {
      email: string | null;
      name: string | null;
      position: Position | null;
      accessLevel: AccessLevel;
    }
  >();
  for (const u of list.users) {
    const meta = (u.app_metadata as {
      role?: string;
      access_level?: string;
    } | null) ?? null;
    // Legacy `role` doubled as cargo; new schema uses `access_level` for authz
    // and the user's Member.position for cargo. Until JWTs rotate, derive
    // accessLevel via resolveAccessLevel and read cargo from meta.role.
    authMap.set(u.id, {
      email: u.email ?? null,
      name: (u.user_metadata as { name?: string } | null)?.name ?? null,
      position: (meta?.role as Position | undefined) ?? null,
      accessLevel: resolveAccessLevel(meta?.access_level, meta?.role),
    });
  }

  // Project members allocated to this project (or with historical access),
  // plus the responsible PM (Project.pmId → Member.id). Other managers/admins
  // are not surfaced — they have implicit access via is_manager() but aren't
  // relevant to this project's roster.
  const [
    { data: accessRows, error },
    { data: project, error: projectErr },
    { data: projectMembers, error: pmErr },
  ] = await Promise.all([
    supabase
      .from("ProjectAccess")
      .select("userId, role, grantedAt")
      .eq("projectId", projectId),
    supabase.from("Project").select("pmId").eq("id", projectId).maybeSingle(),
    supabase
      .from("ProjectMember")
      .select("memberId, fpAllocation")
      .eq("projectId", projectId),
  ]);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (projectErr)
    return NextResponse.json({ error: projectErr.message }, { status: 500 });
  if (pmErr)
    return NextResponse.json({ error: pmErr.message }, { status: 500 });

  // Resolve member.id → userId for: allocated members, PM responsável, and
  // anyone with a ProjectAccess row whose Member.userId matches.
  const allocatedMemberIds = (projectMembers ?? []).map(
    (p) => p.memberId as string,
  );
  const memberIdsToResolve = Array.from(
    new Set([...allocatedMemberIds, ...(project?.pmId ? [project.pmId] : [])]),
  );

  const { data: membersByMemberId } = memberIdsToResolve.length
    ? await supabase
        .from("Member")
        .select("id, name, email, userId")
        .in("id", memberIdsToResolve)
    : { data: [] as { id: string; name: string | null; email: string | null; userId: string | null }[] };

  const allocatedUserIds = (membersByMemberId ?? [])
    .filter((m) => allocatedMemberIds.includes(m.id) && m.userId)
    .map((m) => m.userId as string);
  const pmUserId =
    (membersByMemberId ?? []).find((m) => m.id === project?.pmId)?.userId ??
    null;

  const accessByUser = new Map(
    (accessRows ?? []).map((r) => [r.userId as string, r]),
  );
  const userIds = Array.from(
    new Set([
      ...(accessRows ?? []).map((r) => r.userId as string),
      ...allocatedUserIds,
      ...(pmUserId ? [pmUserId] : []),
    ]),
  );
  if (userIds.length === 0) return NextResponse.json([] as AccessRow[]);

  // Member info (name, fpAllocation) keyed by userId — pull again to cover
  // ProjectAccess rows whose user wasn't in the memberId-based fetch above.
  const { data: members } = await supabase
    .from("Member")
    .select("id, name, email, userId")
    .in("userId", userIds);

  const memberByUser = new Map(
    (members ?? []).map((m) => [m.userId as string, m]),
  );
  const pmFp = new Map(
    (projectMembers ?? []).map((p) => [
      p.memberId as string,
      p.fpAllocation ?? 0,
    ]),
  );

  const result: AccessRow[] = userIds.map((uid) => {
    const member = memberByUser.get(uid);
    const auth = authMap.get(uid);
    const access = accessByUser.get(uid);
    // Only the project's PM responsável is surfaced as a "manager" row here;
    // other managers/admins still bypass via is_manager() but aren't part of
    // this project's roster.
    const isProjectPm = !!pmUserId && uid === pmUserId;
    return {
      userId: uid,
      email: member?.email ?? auth?.email ?? null,
      name: member?.name ?? auth?.name ?? null,
      // PM without ProjectAccess gets a synthetic 'lead' for display only;
      // UI hides the editable control for managers anyway.
      role: (access?.role as AccessRole | undefined) ?? "lead",
      isMember: !!member,
      memberId: member?.id ?? null,
      fpAllocation: member ? pmFp.get(member.id) ?? null : null,
      grantedAt: access?.grantedAt ?? new Date(0).toISOString(),
      isManager: isProjectPm,
      managerPosition: isProjectPm ? auth?.position ?? null : null,
      managerPositionLabel: isProjectPm ? positionLabel(auth?.position) : null,
      managerAccessLevel: isProjectPm ? auth?.accessLevel ?? null : null,
    };
  });

  result.sort((a, b) => {
    // Managers first, then other members, then guests.
    const groupA = a.isManager ? 0 : a.isMember ? 1 : 2;
    const groupB = b.isManager ? 0 : b.isMember ? 1 : 2;
    if (groupA !== groupB) return groupA - groupB;
    return (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "");
  });

  return NextResponse.json(result);
}

/**
 * POST /api/projects/[id]/access
 * Body: { email, role: 'viewer'|..., name? }
 *
 * Lookup user by email; if not found, creates an auth user with role=guest
 * and dispatches a magic link. Inserts ProjectAccess. Manager-only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;
  const { id: projectId } = await params;
  const me = await getUser();
  if (!me) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => ({}));
  const email = (body?.email ?? "").trim().toLowerCase();
  const role = body?.role as AccessRole | undefined;
  const name = (body?.name ?? "").trim() || null;

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "email inválido" }, { status: 400 });
  }
  if (!role || !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "role inválido" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Find existing user by email (paginated listUsers; small org scale is fine).
  let userId: string | null = null;
  let userExisted = false;
  {
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listErr) {
      console.error("[access POST] listUsers failed:", listErr.message);
      return NextResponse.json({ error: "lookup failed" }, { status: 500 });
    }
    const found = list.users.find(
      (u) => (u.email ?? "").toLowerCase() === email,
    );
    if (found) {
      userId = found.id;
      userExisted = true;
    }
  }

  // No existing user → provision a guest.
  let createdGuest = false;
  if (!userId) {
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: name ? { name } : {},
        app_metadata: { role: "guest", access_level: "guest" },
      });
    if (createErr || !created.user) {
      console.error("[access POST] createUser failed:", createErr?.message);
      return NextResponse.json(
        { error: createErr?.message ?? "Failed to create user" },
        { status: 400 },
      );
    }
    userId = created.user.id;
    createdGuest = true;
  }

  // Insert ProjectAccess (or update role if already present).
  const { error: paErr } = await db()
    .from("ProjectAccess")
    .upsert(
      {
        userId: userId!,
        projectId,
        role,
        grantedBy: me.id,
      },
      { onConflict: "userId,projectId" },
    );
  if (paErr) {
    return NextResponse.json({ error: paErr.message }, { status: 500 });
  }

  // Magic link only on first access (new guest, or existing user being added
  // for the first time). For role changes we don't re-spam.
  let emailDispatched = false;
  if (createdGuest || !userExisted) {
    const { data: linkData } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/projects/${projectId}`,
      },
    });
    const magicLink = linkData?.properties?.action_link;
    if (magicLink) {
      const { data: project } = await db()
        .from("Project")
        .select("name")
        .eq("id", projectId)
        .maybeSingle();
      const inviterRole = await getRealRole();
      const inviterName = hasMinLevel(inviterRole, MANAGER)
        ? me.email ?? "Time"
        : "Time";
      const tpl = projectAccessInviteEmail({
        projectName: project?.name ?? "projeto",
        inviterName,
        magicLink,
      });
      const sent = await sendEmail({ to: email, ...tpl });
      emailDispatched = sent.ok;
    }
  }

  return NextResponse.json(
    { ok: true, userId, role, emailDispatched },
    { status: 201 },
  );
}
