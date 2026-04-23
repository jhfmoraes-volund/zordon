import { NextRequest, NextResponse } from "next/server";
import { deployOrchestrator } from "@/lib/deploy";
import { getUser } from "@/lib/dal";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
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
