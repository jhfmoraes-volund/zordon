import { NextRequest, NextResponse } from "next/server";
import { deployOrchestrator } from "@/lib/deploy";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { projectIdForSprint } from "@/lib/dal/sprint";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const projectId = await projectIdForSprint(id);
  if (!projectId) return new NextResponse("Sprint não encontrada", { status: 404 });
  const denied = await requireCapabilityApi("sprint.write", { projectId });
  if (denied) return denied;

  const { environment, triggeredBy } = await req.json();

  try {
    let deploy;
    if (environment === "production") {
      deploy = await deployOrchestrator.promoteToProduction(id, triggeredBy);
    } else {
      deploy = await deployOrchestrator.mergeSprintToStaging(id, triggeredBy);
    }

    return NextResponse.json(deploy);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
