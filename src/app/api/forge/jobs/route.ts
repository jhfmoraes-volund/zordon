/**
 * POST /api/forge/jobs
 * Create a new ForgeJob (status=queued).
 * Auth: forge.operate (manager+ ou grant app.forge).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMemberId } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { createJob } from "@/lib/forge/dal/job";
import type { Database } from "@/lib/supabase/database.types";

type Json = Database["public"]["Tables"]["ForgeJob"]["Insert"]["meta"];

const CreateJobSchema = z.object({
  prdSlug: z.string().min(1, "prdSlug is required"),
  projectId: z.string().uuid().optional().nullable(),
  assignToAnyone: z.boolean().optional(),
  maxStories: z.number().int().positive().optional().nullable(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  // Auth: forge.operate (manager+ ou grant app.forge)
  const denied = await requireCapabilityApi("forge.operate");
  if (denied) return denied;

  const memberId = await getMemberId();
  if (!memberId) {
    return NextResponse.json(
      { error: "User has no linked Member" },
      { status: 403 },
    );
  }

  // Parse and validate body
  const body = await req.json().catch(() => null);
  const parsed = CreateJobSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { prdSlug, projectId, assignToAnyone, maxStories, meta } = parsed.data;

  try {
    const job = await createJob({
      prdSlug,
      projectId: projectId ?? null,
      ownerId: memberId,
      status: "queued",
      claimedBy: null,
      claimedAt: null,
      heartbeatAt: null,
      runId: null,
      assignToAnyone: assignToAnyone ?? false,
      maxStories: maxStories ?? null,
      meta: (meta ?? {}) as Json,
    });

    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (error) {
    console.error("Failed to create ForgeJob:", error);
    return NextResponse.json(
      { error: "Failed to create job" },
      { status: 500 },
    );
  }
}
