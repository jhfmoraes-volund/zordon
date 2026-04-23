import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * Sign out the current user and redirect to /login.
 * POST only — prevents drive-by logout via <img src="/auth/signout">.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // Also clear impersonation cookie if any
  const cookieStore = await cookies();
  cookieStore.delete("volund_impersonate");
  return NextResponse.redirect(new URL("/login", request.url), {
    status: 303, // see other — converts POST → GET
  });
}
