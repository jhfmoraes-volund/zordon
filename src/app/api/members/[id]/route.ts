import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser, requireRole, ForbiddenError } from "@/lib/dal";
import {
  ADMIN_ROLE_NAMES,
  mapPositionToAccessLevel,
  type AccessLevel,
  ACCESS_LEVELS,
} from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type MemberUpdate = Database["public"]["Tables"]["Member"]["Update"];

/**
 * PUT /api/members/[id] — admin-only.
 *
 * Body accepts `position` (cargo) and `accessLevel` (authz) independently.
 * Legacy `role` is mapped onto both for backwards compat.
 *
 * Mirror rules to the auth user:
 *   - position changed → write to `app_metadata.role` (legacy mirror) and
 *     `Member.position` (via the trigger, which also keeps `Member.role` in sync).
 *   - accessLevel changed → write to `app_metadata.access_level`.
 *   - Changing only the position does NOT touch accessLevel (independent axes).
 *
 * Caveat: the JWT picks up the new app_metadata only on the next refresh
 * (~1h or after logout/login).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  try {
    await requireRole(ADMIN_ROLE_NAMES);
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse(e.message, { status: 403 });
    throw e;
  }

  const { id } = await params;
  const body = await req.json();
  // Pull authz/cargo fields out separately; the rest goes straight to Member.
  const { password, position, accessLevel, role, ...rest } = body;

  // Legacy `role` in body maps to position for cargo updates. New callers
  // should use `position`; we keep the alias so older clients keep working.
  const newPosition: string | undefined = position ?? role;

  if (
    accessLevel !== undefined &&
    !(typeof accessLevel === "string" && accessLevel in ACCESS_LEVELS)
  ) {
    return NextResponse.json(
      { error: "accessLevel must be one of: builder, manager, admin, guest" },
      { status: 400 },
    );
  }

  const supabase = db();
  const { data: existing } = await supabase
    .from("Member")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Build the Member update payload. Write both `role` and `position` when
  // position changes — the DB trigger would mirror anyway, but being explicit
  // keeps the intent clear and survives trigger removal in M2.
  const memberUpdate: MemberUpdate = { ...rest } as MemberUpdate;
  if (newPosition !== undefined) {
    memberUpdate.position = newPosition;
    memberUpdate.role = newPosition;
  }

  const { data: member, error: updateError } = await supabase
    .from("Member")
    .update(memberUpdate)
    .eq("id", id)
    .select()
    .single();
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // Mirror to auth user: app_metadata is replaced wholesale by updateUserById,
  // so we always include member_id and any unchanged fields.
  if (existing.userId) {
    const admin = createAdminClient();

    const positionChanged =
      newPosition !== undefined && newPosition !== existing.position;
    const accessLevelChanged = accessLevel !== undefined;
    const passwordChanged = password !== undefined;

    if (positionChanged || accessLevelChanged || passwordChanged) {
      // Read current app_metadata so we can preserve fields we're not changing.
      const { data: authUser } = await admin.auth.admin.getUserById(
        existing.userId,
      );
      const currentMeta =
        (authUser?.user?.app_metadata as
          | { role?: string; access_level?: string; member_id?: string }
          | null) ?? {};

      const nextRole = positionChanged
        ? newPosition!
        : currentMeta.role ?? existing.position;
      const nextAccessLevel: AccessLevel = accessLevelChanged
        ? (accessLevel as AccessLevel)
        : ((currentMeta.access_level as AccessLevel | undefined) ??
          mapPositionToAccessLevel(nextRole));

      const updates: {
        app_metadata?: {
          role: string;
          access_level: AccessLevel;
          member_id: string;
        };
        password?: string;
      } = {
        app_metadata: {
          role: nextRole,
          access_level: nextAccessLevel,
          member_id: id,
        },
      };

      if (passwordChanged) {
        if (typeof password !== "string" || password.length < 6) {
          return NextResponse.json(
            { error: "password must be at least 6 chars" },
            { status: 400 },
          );
        }
        updates.password = password;
      }

      const { error } = await admin.auth.admin.updateUserById(
        existing.userId,
        updates,
      );
      if (error) {
        console.error("[members PUT] auth update failed:", error.message);
        return NextResponse.json(
          { error: `Member updated, but auth sync failed: ${error.message}` },
          { status: 500 },
        );
      }
    }
  }

  return NextResponse.json(member);
}

/**
 * DELETE /api/members/[id] — admin-only.
 * Removes the Member row AND deletes the linked auth user (if any).
 * Note: deleting the auth user does NOT invalidate existing JWTs — they remain
 * valid until expiry. For sensitive cases, also revoke sessions via the dashboard.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  try {
    await requireRole(ADMIN_ROLE_NAMES);
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse(e.message, { status: 403 });
    throw e;
  }

  const { id } = await params;
  const supabase = db();
  const { data: existing } = await supabase
    .from("Member")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ ok: true }); // already gone
  }

  await supabase.from("Member").delete().eq("id", id);

  if (existing.userId) {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(existing.userId);
    if (error) {
      console.error("[members DELETE] auth delete failed:", error.message);
      // Member row is already gone; orphan auth user can be cleaned up manually
    }
  }

  return NextResponse.json({ ok: true });
}
