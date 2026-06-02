import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser, getMemberId } from "@/lib/dal";
import {
  createSession,
  listForProject,
  type PlanningSessionStatus,
} from "@/lib/dal/planning-session";

const createSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(3).max(160),
  sprintCount: z.number().int().min(1).max(12).default(6),
  facilitatorId: z.string().uuid().nullable().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const memberId = await getMemberId();

  try {
    const session = await createSession({
      ...parsed.data,
      status: "draft" as PlanningSessionStatus,
      facilitatorId: parsed.data.facilitatorId ?? memberId,
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "create failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId query param required" },
      { status: 400 },
    );
  }

  try {
    const sessions = await listForProject(projectId);
    return NextResponse.json({ sessions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "list failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
