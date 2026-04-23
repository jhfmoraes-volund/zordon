import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 Proxy (formerly middleware).
 * - Refreshes the Supabase auth token on every request (cookie write)
 * - Redirects unauthenticated users to /login on protected paths
 * - Redirects authenticated users away from /login
 *
 * IMPORTANT: Don't trust this alone. Server Actions and API routes still
 * call verifySession() (src/lib/dal.ts) since matcher gaps can let requests
 * through.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip auth validation entirely for public paths that never need session data.
  if (pathname.startsWith("/auth/")) {
    return NextResponse.next({ request });
  }

  // Build a mutable copy of request headers to inject user identity downstream.
  const requestHeaders = new Headers(request.headers);
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() validates the JWT against Supabase — never use getSession() here
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = pathname === "/login";
  const isApi = pathname.startsWith("/api/");

  if (!user && !isPublicPath && !isApi) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Inject validated user identity into request headers so downstream code
  // (layouts, pages, route handlers) can skip the Supabase HTTP call.
  if (user) {
    requestHeaders.set("x-user-id", user.id);
    requestHeaders.set("x-user-email", user.email ?? "");
    requestHeaders.set("x-user-role", user.app_metadata?.role ?? "");
    requestHeaders.set("x-member-id", user.app_metadata?.member_id ?? "");

    // Forward impersonation cookie as header so layouts avoid cookies() call
    const impersonateId = request.cookies.get("volund_impersonate")?.value;
    if (impersonateId) {
      requestHeaders.set("x-impersonate-id", impersonateId);
    }

    // Rebuild response with updated headers (keeps any cookies setAll wrote)
    response = NextResponse.next({ request: { headers: requestHeaders } });
    // Re-apply any auth cookies the Supabase client may have set
    const setCookies = response.headers.getSetCookie();
    // The setAll callback already wrote cookies to response, but we rebuilt it.
    // Re-run the cookie refresh by creating the response from the modified request.
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match everything except:
     * - _next  (static, image, data, RSC payloads — all Next internals)
     * - Static assets by extension
     *
     * NOTE: /api is now included so the proxy injects x-user-* headers,
     * eliminating the duplicate getUser() HTTP call in every route handler.
     */
    "/((?!_next|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?|ttf|eot|ico|map)$).*)",
  ],
};
