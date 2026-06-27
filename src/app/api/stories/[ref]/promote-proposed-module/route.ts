import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  approveProposedModule,
  getStoryByReference,
} from "@/lib/dal/story-hierarchy";

/**
 * POST /api/stories/[ref]/promote-proposed-module
 *
 * Para stories MANUAIS (fora de Design Session): promove `proposedModuleName`
 * em Module real e re-aponta a story. Não há cascata de tasks aqui — stories
 * manuais não passam pelo ciclo draft→backlog (já nascem com tasks 'backlog').
 *
 * Stories de Design Session NÃO devem usar essa rota — sua aprovação acontece
 * em massa via /api/design-sessions/[id]/complete.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  const story = await getStoryByReference(ref);
  if (!story) return new NextResponse("Not found", { status: 404 });

  const denied = await requireCapabilityApi("story.edit", {
    projectId: story.projectId,
  });
  if (denied) return denied;
  const member = await getCurrentMember();

  if (!story.proposedModuleName) {
    return NextResponse.json(
      { error: "story has no proposedModuleName" },
      { status: 400 },
    );
  }
  if (story.designSessionId) {
    return NextResponse.json(
      {
        error:
          "Story de Design Session não promove módulo individualmente — use /api/design-sessions/[id]/complete",
      },
      { status: 400 },
    );
  }

  try {
    const result = await approveProposedModule(
      story.id,
      story.projectId,
      story.proposedModuleName,
      member?.id ?? null,
    );
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "promote failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
