import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/database.types";

/**
 * Server-side database client using service_role key.
 * Bypasses RLS — same behavior as Prisma (postgres role).
 * Use for all API routes and Server Components.
 */
export function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
