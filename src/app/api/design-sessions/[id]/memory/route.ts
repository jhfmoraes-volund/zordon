import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";

/**
 * GET /api/design-sessions/[id]/memory
 *
 * Returns everything the SessionMemoryTab needs:
 *  - session: title + memoryMd + version + abstract
 *  - project: memoryMd + memoryVersion + name
 *  - businessContext (project-level)
 *  - activeDecisions (project-scoped, status=active)
 *  - openQuestions (session-scoped, status=open)
 *  - research (session-scoped, latest 50)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;

  const { data: session, error: sErr } = await db()
    .from("DesignSession")
    .select("id, title, type, status, projectId, memoryMd, memoryAbstract, memoryVersion, memoryUpdatedAt")
    .eq("id", id)
    .maybeSingle();
  if (sErr || !session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  const [project, businessContext, decisions, openQuestions, research] =
    await Promise.all([
      db()
        .from("Project")
        .select("id, name, memoryMd, memoryVersion, memoryUpdatedAt")
        .eq("id", session.projectId)
        .maybeSingle(),
      db()
        .from("ProjectBusinessContext")
        .select("*")
        .eq("projectId", session.projectId)
        .maybeSingle(),
      db()
        .from("DesignDecision")
        .select("id, statement, rationale, confidence, status, tags, createdAt, updatedAt, sessionId")
        .eq("projectId", session.projectId)
        .eq("status", "active")
        .order("createdAt", { ascending: false }),
      db()
        .from("DesignOpenQuestion")
        .select("id, question, blocksWhat, status, answer, createdAt, answeredAt")
        .eq("sessionId", id)
        .order("createdAt", { ascending: false }),
      db()
        .from("DesignSessionResearch")
        .select("id, query, summary, sources, createdAt")
        .eq("sessionId", id)
        .order("createdAt", { ascending: false })
        .limit(50),
    ]);

  return NextResponse.json({
    session: {
      id: session.id,
      title: session.title,
      type: session.type,
      status: session.status,
      memoryMd: session.memoryMd,
      memoryAbstract: session.memoryAbstract,
      memoryVersion: session.memoryVersion,
      memoryUpdatedAt: session.memoryUpdatedAt,
      projectId: session.projectId,
    },
    project: project.data ?? null,
    businessContext: businessContext.data ?? null,
    activeDecisions: decisions.data ?? [],
    openQuestions: openQuestions.data ?? [],
    research: research.data ?? [],
  });
}
