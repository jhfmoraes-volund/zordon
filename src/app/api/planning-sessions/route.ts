import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser, getMemberId, requireProjectViewApi } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  createSession,
  listForProject,
  findActiveSessionForProject,
  type PlanningSessionStatus,
} from "@/lib/dal/planning-session";

/** Postgres unique_violation — corrida de dois POSTs simultâneos. */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "23505"
  );
}

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

  const denied = await requireCapabilityApi("ritual.planning", {
    projectId: parsed.data.projectId,
  });
  if (denied) return denied;

  // Singleton: "1 planning viva por projeto". Se já existe uma ATIVA, devolve ela
  // (resolve-or-create) em vez de nascer uma 2ª — a UI abre a existente com toast
  // informativo. O índice único parcial é a garantia dura; isto dá a resposta
  // amigável antes de bater nele.
  const existing = await findActiveSessionForProject(parsed.data.projectId);
  if (existing) {
    return NextResponse.json({ session: existing, existed: true }, { status: 200 });
  }

  const memberId = await getMemberId();

  try {
    const session = await createSession({
      ...parsed.data,
      status: "draft" as PlanningSessionStatus,
      facilitatorId: parsed.data.facilitatorId ?? memberId,
    });
    return NextResponse.json({ session, existed: false }, { status: 201 });
  } catch (e) {
    // Corrida: dois POSTs concorrentes passam pelo check acima e batem no índice
    // único (23505). Re-resolve e devolve a vencedora em vez de 500.
    if (isUniqueViolation(e)) {
      const raced = await findActiveSessionForProject(parsed.data.projectId);
      if (raced) {
        return NextResponse.json({ session: raced, existed: true }, { status: 200 });
      }
    }
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

  // db() bypassa RLS — gate explícito (grant-aware via canViewProject).
  const denied = await requireProjectViewApi(projectId);
  if (denied) return denied;

  try {
    const sessions = await listForProject(projectId);
    return NextResponse.json({ sessions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "list failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
