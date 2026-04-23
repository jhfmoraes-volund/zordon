"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getRealRole } from "@/lib/dal";
import { hasMinLevel, ADMIN } from "@/lib/roles";

const COOKIE = "volund_impersonate";

/**
 * Set or clear the impersonation cookie. Only admins can impersonate.
 * After setting, we revalidate the root layout so the sidebar reflects the change.
 */
export async function setImpersonation(memberId: string | null) {
  const realRole = await getRealRole();
  if (!hasMinLevel(realRole, ADMIN)) {
    throw new Error("Forbidden: only admins can impersonate");
  }

  const cookieStore = await cookies();
  if (memberId) {
    cookieStore.set(COOKIE, memberId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // session cookie (no maxAge) — clears on browser close
    });
  } else {
    cookieStore.delete(COOKIE);
  }

  revalidatePath("/", "layout");
}
