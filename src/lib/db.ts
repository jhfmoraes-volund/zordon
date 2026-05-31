import { createClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/database.types";

/**
 * Server-side database client using service_role key.
 * Bypasses RLS — same behavior as Prisma (postgres role).
 * Use for all API routes, Server Components, and CLI scripts (forge, ralph).
 *
 * Bundle safety: SUPABASE_SERVICE_ROLE_KEY is non-NEXT_PUBLIC, so it's never
 * embedded in client bundles even without the `server-only` guard.
 *
 * Node < 22 needs `ws` injected as realtime transport (native WebSocket missing).
 */
export function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  // Node < 22 lacks native WebSocket; inject `ws` so supabase-js realtime can load.
  // This only runs server-side and only when actually needed.
  if (typeof window === "undefined") {
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    if (nodeMajor < 22 && !globalThis.WebSocket) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (globalThis as { WebSocket?: unknown }).WebSocket = require("ws");
    }
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
