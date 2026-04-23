import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Magic link / invite callback.
 * Supabase sends the user here with ?token_hash=...&type=... after they click
 * the email link. We verify the OTP, which sets the session cookie via the
 * server client. Then redirect into the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

  if (!token_hash || !type) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_link", request.url),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash });

  if (error) {
    console.error("[auth/confirm] verifyOtp error:", error.message);
    return NextResponse.redirect(
      new URL("/login?error=verify_failed", request.url),
    );
  }

  return NextResponse.redirect(new URL(next, request.url));
}
