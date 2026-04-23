import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser, requireRole, ForbiddenError } from "@/lib/dal";
import { ADMIN_ROLE_NAMES } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * PUT /api/members/[id] — admin-only.
 * Updates Member fields. If `role` changes and the member has a linked auth
 * user, mirrors the new role into auth.users.app_metadata. If `password` is
 * provided, resets the user's password (admin-driven reset).
 *
 * Caveat: the JWT only picks up the new role on the next refresh (~1h or after
 * logout/login). For urgent revocation, an admin should call
 * `admin.auth.admin.signOut(userId)` separately (not exposed yet).
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
  // password is admin-only and never persisted to the Member row
  const { password, ...memberData } = body;

  const supabase = db();
  const { data: existing } = await supabase
    .from("Member")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: member, error: updateError } = await supabase
    .from("Member")
    .update(memberData)
    .eq("id", id)
    .select()
    .single();
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // Mirror role + reset password on the auth user (if linked)
  if (existing.userId) {
    const admin = createAdminClient();
    const updates: {
      app_metadata?: { role: string; member_id: string };
      password?: string;
    } = {};
    if (memberData.role && memberData.role !== existing.role) {
      // app_metadata is replaced wholesale by updateUserById — must include
      // member_id so RLS keeps working.
      updates.app_metadata = { role: memberData.role, member_id: id };
    }
    if (password) {
      if (typeof password !== "string" || password.length < 6) {
        return NextResponse.json(
          { error: "password must be at least 6 chars" },
          { status: 400 },
        );
      }
      updates.password = password;
    }
    if (Object.keys(updates).length > 0) {
      const { error } = await admin.auth.admin.updateUserById(
        existing.userId,
        updates,
      );
      if (error) {
        console.error("[members PUT] auth update failed:", error.message);
        // Member row already updated — surface the error so admin knows the
        // role/password mirror didn't take effect.
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
