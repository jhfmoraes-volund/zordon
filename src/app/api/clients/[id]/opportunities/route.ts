import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser, getMemberId } from "@/lib/dal";
import { listByClient, create } from "@/lib/dal/opportunities";
import type { OpportunityStatus } from "@/lib/dal/opportunities";

// Validation schema for POST body
const createSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().nullable().optional(),
  impact: z.number().int().min(1).max(5),
  effort: z.number().int().min(1).max(5),
  status: z
    .enum(["discovery", "evaluating", "approved", "in_project", "rejected"])
    .optional(),
  priorityRank: z.number().nullable().optional(),
  sourceMeetingId: z.string().nullable().optional(),
  sourceDesignSessionId: z.string().nullable().optional(),
  sourceTranscriptRefId: z.string().nullable().optional(),
});

/**
 * GET /api/clients/[id]/opportunities
 * Returns list of opportunities for the client, ordered by priority.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id: clientId } = await params;

  try {
    const opportunities = await listByClient(clientId);
    return NextResponse.json({ opportunities }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "list failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/clients/[id]/opportunities
 * Creates a new opportunity for the client.
 * Validates input via Zod (title required, impact/effort 1-5).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const memberId = await getMemberId();
  if (!memberId) {
    return new Response("Forbidden — no Member linked to user", { status: 403 });
  }

  const { id: clientId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const opportunity = await create({
      clientId,
      title: parsed.data.title,
      description: parsed.data.description,
      impact: parsed.data.impact,
      effort: parsed.data.effort,
      status: parsed.data.status as OpportunityStatus | undefined,
      priorityRank: parsed.data.priorityRank,
      sourceMeetingId: parsed.data.sourceMeetingId,
      sourceDesignSessionId: parsed.data.sourceDesignSessionId,
      sourceTranscriptRefId: parsed.data.sourceTranscriptRefId,
      createdBy: memberId,
    });

    return NextResponse.json({ opportunity }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "create failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
