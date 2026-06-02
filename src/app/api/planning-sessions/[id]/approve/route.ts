import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import { createClient } from "@/lib/supabase/server";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // Auth
  const user = await getUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const params = paramsSchema.parse(await context.params);
  const sessionId = params.id;

  const supabase = await createClient();

  // 1. Load session + verify access
  const { data: session, error: sessionError } = await supabase
    .from("PlanningSession")
    .select("*, Project!inner(id, slug)")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return NextResponse.json(
      { error: "Session not found" },
      { status: 404 }
    );
  }

  // Validate status
  if (session.status !== "in-review") {
    return NextResponse.json(
      {
        error: `Cannot approve session in status ${session.status}. Must be in-review.`,
      },
      { status: 400 }
    );
  }

  // 2. Load PRDs in order
  const { data: prds, error: prdsError } = await supabase
    .from("PlanningSessionPRD")
    .select("*")
    .eq("planningSessionId", sessionId)
    .order("sprintStart", { ascending: true })
    .order("order", { ascending: true });

  if (prdsError || !prds) {
    return NextResponse.json(
      { error: "Failed to load PRDs" },
      { status: 500 }
    );
  }

  // 3. Atomic update: session status
  // Note: Postgres transaction is implicit for single update.
  // In v2/v3, we'll need explicit transaction when creating UserStory/Task rows.
  const { error: updateError } = await supabase
    .from("PlanningSession")
    .update({
      status: "approved",
      approvedAt: new Date().toISOString(),
      approvedBy: user.id,
    })
    .eq("id", sessionId);

  if (updateError) {
    console.error("Failed to approve session:", updateError);
    return NextResponse.json(
      { error: "Failed to approve session" },
      { status: 500 }
    );
  }

  // 4. Filesystem move: backlog/ → ready/
  // This happens AFTER DB commit. If it fails, we log but don't rollback DB.
  const repoRoot = process.cwd();
  const backlogDir = path.join(repoRoot, "docs/prd/backlog");
  const readyDir = path.join(repoRoot, "docs/prd/ready");

  const moveErrors: string[] = [];

  // Só PRDs slug-backed (output da cascata em docs/prd/) movem de arquivo.
  // PRDs entity-backed (ProductRequirement vinculado conversacionalmente) são
  // "aprovados" só pelo flip de status da session — não têm arquivo pra mover.
  const slugPrds = prds.filter((prd) => !!prd.prdSlug);

  for (const prd of slugPrds) {
    const filename = `prd-${prd.prdSlug}.md`;
    const sourcePath = path.join(backlogDir, filename);
    const destPath = path.join(readyDir, filename);

    try {
      // Check if source exists
      await fs.access(sourcePath);
      // Move file
      await fs.rename(sourcePath, destPath);
    } catch (err) {
      // Log error but continue — DB already committed
      const errorMsg = `Failed to move ${filename}: ${err}`;
      console.warn(errorMsg);
      moveErrors.push(errorMsg);
    }
  }

  return NextResponse.json({
    ok: true,
    hierarchyTreeUpdated: false, // v1 doesn't create hierarchy rows yet
    filesMovedCount: slugPrds.length - moveErrors.length,
    moveErrors: moveErrors.length > 0 ? moveErrors : undefined,
  });
}
