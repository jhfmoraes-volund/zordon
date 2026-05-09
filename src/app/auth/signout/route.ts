import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * POST only — prevents drive-by logout via <img src="/auth/signout">.
 * Returns a relative-path 303 so the browser stays on the public host.
 * NextResponse.redirect(new URL(..., request.url)) leaks the internal
 * host (e.g. 0.0.0.0:8080 behind Cloud Run) into the Location header.
 */
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete("volund_impersonate");
  return new Response(null, {
    status: 303,
    headers: { Location: "/login" },
  });
}
