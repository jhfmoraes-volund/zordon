// Granola auto-import — member-facing toggle + run-now endpoint.
//
//   GET  → current status (enabled, cursor, last run, last job summary)
//   PUT  → flip the toggle. When turning ON, set cursor=now() so the first
//          tick scans only what comes next (no surprise backlog import).
//   POST → "Varrer agora": enqueue a manual job and ping the drain route.
//
// All three require:
//   - signed-in user
//   - a connected Granola integration (no token → 409)
//
// Writes go through the admin client so we can touch MemberIntegration and
// GranolaImportJob without depending on RLS — the DAL has already proven
// caller identity via getCurrentMember().

import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember, getUser } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueManualGranolaImport } from "@/lib/granola-auto-import";
import type { Database } from "@/lib/supabase/database.types";

export type AutoImportStatus = {
  enabled: boolean;
  cursor: string | null;
  lastRunAt: string | null;
  lastJob: {
    id: string;
    status: "pending" | "running" | "done" | "failed";
    source: "cron" | "manual";
    notesScanned: number | null;
    meetingsCreated: number | null;
    meetingsSkipped: number | null;
    error: string | null;
    createdAt: string;
    finishedAt: string | null;
  } | null;
  inFlight: { id: string; status: "pending" | "running" } | null;
};

async function loadStatus(memberId: string): Promise<AutoImportStatus | { error: string; status: number }> {
  const admin = createAdminClient();

  const { data: integration } = await admin
    .from("MemberIntegration")
    .select("autoImportEnabled, autoImportCursor, autoImportLastRunAt")
    .eq("memberId", memberId)
    .eq("provider", "granola")
    .maybeSingle();

  if (!integration) {
    return { error: "granola_not_connected", status: 409 };
  }

  const { data: lastJob } = await admin
    .from("GranolaImportJob")
    .select(
      "id, status, source, notesScanned, meetingsCreated, meetingsSkipped, error, createdAt, finishedAt",
    )
    .eq("memberId", memberId)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: inFlight } = await admin
    .from("GranolaImportJob")
    .select("id, status")
    .eq("memberId", memberId)
    .in("status", ["pending", "running"])
    .limit(1)
    .maybeSingle();

  return {
    enabled: !!integration.autoImportEnabled,
    cursor: (integration.autoImportCursor as string | null) ?? null,
    lastRunAt: (integration.autoImportLastRunAt as string | null) ?? null,
    lastJob: lastJob
      ? {
          id: lastJob.id as string,
          status: lastJob.status as "pending" | "running" | "done" | "failed",
          source: lastJob.source as "cron" | "manual",
          notesScanned: (lastJob.notesScanned as number | null) ?? null,
          meetingsCreated: (lastJob.meetingsCreated as number | null) ?? null,
          meetingsSkipped: (lastJob.meetingsSkipped as number | null) ?? null,
          error: (lastJob.error as string | null) ?? null,
          createdAt: lastJob.createdAt as string,
          finishedAt: (lastJob.finishedAt as string | null) ?? null,
        }
      : null,
    inFlight: inFlight
      ? {
          id: inFlight.id as string,
          status: inFlight.status as "pending" | "running",
        }
      : null,
  };
}

export async function GET() {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "No member linked" }, { status: 404 });

  const status = await loadStatus(member.id);
  if ("error" in status) {
    return NextResponse.json({ error: status.error }, { status: status.status });
  }
  return NextResponse.json(status);
}

export async function PUT(req: NextRequest) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "No member linked" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { enabled?: boolean } | null;
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "Expected { enabled: boolean }" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Confirm Granola is connected before letting the user enable the toggle.
  // If they're disabling, allow even with no token (defensive: cleans up
  // orphaned state).
  const { data: integration } = await admin
    .from("MemberIntegration")
    .select("memberId, autoImportCursor")
    .eq("memberId", member.id)
    .eq("provider", "granola")
    .maybeSingle();

  if (body.enabled && !integration) {
    return NextResponse.json(
      { error: "granola_not_connected" },
      { status: 409 },
    );
  }
  if (!integration) {
    // Nothing to flip — treat as a no-op success.
    return NextResponse.json(await loadStatus(member.id));
  }

  // First time turning on: anchor the cursor to "now" so we don't import
  // the user's entire Granola backlog by surprise. Subsequent toggles keep
  // the existing cursor — turning off and back on a few minutes later does
  // NOT lose data; we just resume scanning from where we paused.
  const update: Database["public"]["Tables"]["MemberIntegration"]["Update"] = {
    autoImportEnabled: body.enabled,
  };
  if (body.enabled && !integration.autoImportCursor) {
    update.autoImportCursor = new Date().toISOString();
  }

  const { error: updateErr } = await admin
    .from("MemberIntegration")
    .update(update)
    .eq("memberId", member.id)
    .eq("provider", "granola");
  if (updateErr) {
    return NextResponse.json(
      { error: "update_failed", message: updateErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json(await loadStatus(member.id));
}

export async function POST(req: NextRequest) {
  // "Varrer agora" — enqueue a manual job and kick the drain.
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "No member linked" }, { status: 404 });

  const admin = createAdminClient();

  const { data: integration } = await admin
    .from("MemberIntegration")
    .select("memberId")
    .eq("memberId", member.id)
    .eq("provider", "granola")
    .maybeSingle();
  if (!integration) {
    return NextResponse.json({ error: "granola_not_connected" }, { status: 409 });
  }

  const { enqueued, jobId } = await enqueueManualGranolaImport(admin, member.id);
  if (!enqueued && jobId) {
    return NextResponse.json(
      { ok: false, reason: "in_flight", jobId },
      { status: 409 },
    );
  }

  // Best-effort drain kick — same pattern as the insights rerun routes.
  const cronUrl = new URL("/api/cron/run-granola-import", req.url);
  const token = process.env.GRANOLA_IMPORT_AUTH_TOKEN;
  if (token && jobId) {
    fetch(cronUrl.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jobId }),
    }).catch((e) => {
      console.warn(
        "[granola-auto-import] drain kick failed:",
        (e as Error).message,
      );
    });
  }

  return NextResponse.json({ ok: true, jobId }, { status: 202 });
}
