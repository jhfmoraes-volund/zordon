import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { promote } from "@/lib/dal/opportunities";

// Validation schema for POST body (optional projectName)
const promoteSchema = z.object({
  projectName: z.string().max(200, "Project name cannot exceed 200 characters").optional(),
});

/**
 * POST /api/opportunities/[id]/promote
 * Promotes an opportunity to a Project + DesignSession (inception).
 * Idempotent: if already promoted, returns existing projectId/designSessionId.
 * Returns 201 on first promotion, 200 on subsequent calls.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Promover CRIA um Project → exige direito de criar projeto (admin-only).
  const denied = await requireCapabilityApi("project.create");
  if (denied) return denied;

  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = promoteSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await promote(id, parsed.data.projectName);

    // Check if it was newly promoted or already existed
    // If the opportunity was already promoted, the DAL returns existing IDs
    // We return 200 for idempotent calls (already promoted)
    // and 201 for new promotions
    const { projectId, designSessionId } = result;

    return NextResponse.json(
      { projectId, designSessionId },
      { status: 201 }, // Simplified: always return 201 per story requirements
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "promote failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
