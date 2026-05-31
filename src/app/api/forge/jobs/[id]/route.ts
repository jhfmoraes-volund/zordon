/**
 * PATCH /api/forge/jobs/[id]
 * Cancel a ForgeJob (only if status is queued or claimed).
 * Auth: is_manager OR is_admin only.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMinAccessLevelApi } from "@/lib/dal";
import { getJob, updateJobStatus } from "@/lib/forge/dal/job";

const CancelJobSchema = z.object({
  action: z.literal("cancel"),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth: only manager or admin
  const denied = await requireMinAccessLevelApi("manager");
  if (denied) return denied;

  const { id: jobId } = await params;

  // Parse and validate body
  const body = await req.json().catch(() => null);
  const parsed = CancelJobSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.format() },
      { status: 400 },
    );
  }

  try {
    // Get current job to check status
    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Only allow cancel if status is queued or claimed
    if (job.status !== "queued" && job.status !== "claimed") {
      return NextResponse.json(
        {
          error: `Cannot cancel job with status '${job.status}'. Only 'queued' or 'claimed' jobs can be cancelled.`,
        },
        { status: 409 },
      );
    }

    const updatedJob = await updateJobStatus(jobId, "cancelled");

    return NextResponse.json({ job: updatedJob });
  } catch (error) {
    console.error("Failed to cancel ForgeJob:", error);
    return NextResponse.json(
      { error: "Failed to cancel job" },
      { status: 500 },
    );
  }
}
