import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getUser, requireMinAccessLevelApi } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { CAPABILITY_BY_KEY } from "@/lib/access/capabilities";
import {
  getMemberUserId,
  listActiveGrantsForUser,
  findActiveGrant,
  createGrant,
} from "@/lib/access/grants-dal";

/** Postgres unique_violation — grant ativo idêntico já existe. */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "23505"
  );
}

/** GET ?memberId= → grants ativos do membro (admin-only). */
export async function GET(req: NextRequest) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;

  const memberId = req.nextUrl.searchParams.get("memberId");
  if (!memberId) {
    return NextResponse.json({ error: "memberId required" }, { status: 400 });
  }

  const userId = await getMemberUserId(memberId);
  if (!userId) {
    // Membro sem conta de login não pode receber grant.
    return NextResponse.json({ grants: [], hasAccount: false });
  }
  const grants = await listActiveGrantsForUser(userId);
  return NextResponse.json({ grants, hasAccount: true });
}

const createSchema = z.object({
  memberId: z.string(),
  capabilityKey: z.string(),
  projectId: z.string().uuid().nullable().optional(),
});

/** POST → concede uma capability a um membro (admin-only). */
export async function POST(req: NextRequest) {
  const denied = await requireCapabilityApi("access_grant.manage");
  if (denied) return denied;
  const actor = await getUser();
  if (!actor) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const cap = CAPABILITY_BY_KEY.get(parsed.data.capabilityKey);
  if (!cap) {
    return NextResponse.json({ error: "invalid capabilityKey" }, { status: 400 });
  }
  // Consistência de escopo: project exige projectId; global ignora/proíbe.
  const projectId = cap.scope === "project" ? parsed.data.projectId ?? null : null;
  if (cap.scope === "project" && !projectId) {
    return NextResponse.json(
      { error: "projectId required for project-scoped capability" },
      { status: 400 },
    );
  }

  const userId = await getMemberUserId(parsed.data.memberId);
  if (!userId) {
    return NextResponse.json(
      { error: "member has no login account — cannot receive a grant" },
      { status: 400 },
    );
  }

  // Resolve-or-create: já existe um ativo idêntico? devolve ele.
  const existing = await findActiveGrant(userId, cap.key, projectId);
  if (existing) {
    return NextResponse.json({ grant: existing, existed: true }, { status: 200 });
  }

  try {
    const { data, error } = await createGrant({
      userId,
      capabilityKey: cap.key,
      scope: cap.scope,
      projectId,
      grantedBy: actor.id,
    });
    if (error) {
      if (isUniqueViolation(error)) {
        const raced = await findActiveGrant(userId, cap.key, projectId);
        if (raced) {
          return NextResponse.json({ grant: raced, existed: true }, { status: 200 });
        }
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ grant: data, existed: false }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "grant failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
