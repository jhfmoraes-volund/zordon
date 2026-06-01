import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";
import { getStepsForSession } from "@/lib/design-session-steps";
import type { StepKey, StickyNote } from "@/lib/design-session/types";
import { listSessionTranscripts } from "@/lib/dal/design-session-transcripts";

/**
 * Aggregated read endpoint — returns the session plus every normalized table
 * that has data for it, in one request. Only the steps active for this
 * session (via `getStepsForSession`) are queried. Sticky notes are returned
 * grouped by stepKey.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;

  const { data: session } = await db()
    .from("DesignSession")
    .select(
      "*, project:Project!DesignSession_projectId_fkey(id, name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const stepKeys = new Set(
    getStepsForSession({
      type: session.type,
      selectedSteps: session.selectedSteps ?? null,
    }).map((s) => s.key),
  );

  // Run only the queries relevant to the steps active in this session.
  const [
    productVisionResp,
    scopeResp,
    personasResp,
    brainstormResp,
    risksResp,
    gapsResp,
    priorityResp,
    techSpecsResp,
    hypothesesResp,
    notesResp,
    researchResp,
    transcriptsResp,
    filesResp,
  ] = await Promise.all([
    stepKeys.has("product_vision")
      ? db().from("DesignSessionProductVision").select("*").eq("sessionId", id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    stepKeys.has("scope_definition")
      ? db().from("DesignSessionScope").select("*").eq("sessionId", id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    stepKeys.has("personas_journeys")
      ? db()
          .from("DesignSessionPersona")
          .select("*")
          .eq("sessionId", id)
          .order("orderIndex", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    stepKeys.has("brainstorm")
      ? db()
          .from("DesignSessionBrainstormFeature")
          .select("*")
          .eq("sessionId", id)
          .order("orderIndex", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    stepKeys.has("risks_gaps")
      ? db()
          .from("DesignSessionRisk")
          .select("*")
          .eq("sessionId", id)
          .order("orderIndex", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    stepKeys.has("risks_gaps")
      ? db()
          .from("DesignSessionGap")
          .select("*")
          .eq("sessionId", id)
          .order("orderIndex", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    stepKeys.has("prioritization")
      ? db()
          .from("DesignSessionPriorityItem")
          .select("*")
          .eq("sessionId", id)
          .order("orderIndex", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    stepKeys.has("technical_specs")
      ? db().from("DesignSessionTechnicalSpecs").select("*").eq("sessionId", id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    stepKeys.has("hypotheses")
      ? db()
          .from("DesignSessionHypothesis")
          .select("*")
          .eq("sessionId", id)
          .order("orderIndex", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    db()
      .from("DesignSessionStepNote")
      .select("*")
      .eq("sessionId", id)
      .order("orderIndex", { ascending: true }),
    stepKeys.has("pre_work")
      ? db().from("DesignSessionResearch").select("*").eq("sessionId", id)
      : Promise.resolve({ data: [], error: null }),
    stepKeys.has("pre_work")
      ? listSessionTranscripts(db(), id).then((items) => ({ data: items, error: null }))
      : Promise.resolve({ data: [], error: null }),
    stepKeys.has("pre_work")
      ? db()
          .from("DesignSessionFile")
          .select("id, sessionId, name, size, mimeType, extractionStatus, uploadedByMemberId, createdAt")
          .eq("sessionId", id)
          .order("createdAt", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const stepNotes: Partial<Record<StepKey, StickyNote[]>> = {};
  for (const note of (notesResp.data ?? []) as StickyNote[]) {
    const key = note.stepKey as StepKey;
    if (!stepNotes[key]) stepNotes[key] = [];
    stepNotes[key]!.push(note);
  }

  return NextResponse.json({
    session,
    productVision: productVisionResp.data,
    scope: scopeResp.data,
    personas: personasResp.data ?? [],
    brainstormFeatures: brainstormResp.data ?? [],
    risks: risksResp.data ?? [],
    gaps: gapsResp.data ?? [],
    priorityItems: priorityResp.data ?? [],
    technicalSpecs: techSpecsResp.data,
    hypotheses: hypothesesResp.data ?? [],
    stepNotes,
    research: researchResp.data ?? [],
    transcripts: transcriptsResp.data ?? [],
    files: filesResp.data ?? [],
  });
}
