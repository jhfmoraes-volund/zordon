import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getUser, canViewProject } from "@/lib/dal";
import { NARRATIVE_SECTION_KEYS } from "@/lib/wiki/schemas";
import { parseSuppressed } from "@/lib/wiki/suppressed";

/**
 * GET /api/projects/[id]/wiki — seções narrativas auto-geradas (PRD §8):
 * data + suppressed + sources agregadas (com título/url resolvidos por tipo,
 * pra "↳ fonte" clicável na UI). Edição manual não existe mais — o PUT
 * legado /wiki/[sectionKey] foi removido (Wiki é write-only via composer).
 */

type EnrichedSource = {
  bulletHash: string;
  sourceType: string;
  sourceId: string;
  title: string | null;
  url: string | null;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project id" }, { status: 400 });
  }
  if (!(await canViewProject(parsed.data))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const supabase = db();
  const { data: sections, error } = await supabase
    .from("ProjectWikiSection")
    .select(
      "id, sectionKey, title, data, suppressed, generatedAt, generatedBy, order"
    )
    .eq("projectId", parsed.data)
    .in("sectionKey", [...NARRATIVE_SECTION_KEYS])
    .order("order");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sectionIds = (sections ?? []).map((s) => s.id);
  let sources: Array<{
    wikiSectionId: string;
    bulletHash: string;
    sourceType: string;
    sourceId: string;
  }> = [];
  if (sectionIds.length > 0) {
    const { data: sourceRows, error: sourcesError } = await supabase
      .from("ProjectWikiSectionSource")
      .select("wikiSectionId, bulletHash, sourceType, sourceId")
      .in("wikiSectionId", sectionIds);
    if (sourcesError) {
      return NextResponse.json({ error: sourcesError.message }, { status: 500 });
    }
    sources = sourceRows ?? [];
  }

  // Resolve título/url por tipo num lookup batched (fonte clicável na UI).
  const idsByType = new Map<string, string[]>();
  for (const s of sources) {
    idsByType.set(s.sourceType, [
      ...(idsByType.get(s.sourceType) ?? []),
      s.sourceId,
    ]);
  }
  const meta = new Map<string, { title: string | null; url: string | null }>();
  const collect = (
    rows:
      | Array<{
          id: string;
          title?: string | null;
          name?: string | null;
          externalUrl?: string | null;
        }>
      | null
  ) => {
    for (const r of rows ?? []) {
      meta.set(r.id, {
        title: r.title ?? r.name ?? null,
        url: r.externalUrl ?? null,
      });
    }
  };
  const [csRes, meetingRes, dsRes, taskRes, sprintRes] = await Promise.all([
    idsByType.has("context_source")
      ? supabase
          .from("ContextSource")
          .select("id, title, externalUrl")
          .in("id", idsByType.get("context_source")!)
      : Promise.resolve({ data: null }),
    idsByType.has("meeting")
      ? supabase
          .from("Meeting")
          .select("id, title")
          .in("id", idsByType.get("meeting")!)
      : Promise.resolve({ data: null }),
    idsByType.has("design_session")
      ? supabase
          .from("DesignSession")
          .select("id, title")
          .in("id", idsByType.get("design_session")!)
      : Promise.resolve({ data: null }),
    idsByType.has("task")
      ? supabase
          .from("Task")
          .select("id, title")
          .in("id", idsByType.get("task")!)
      : Promise.resolve({ data: null }),
    idsByType.has("sprint")
      ? supabase
          .from("Sprint")
          .select("id, name")
          .in("id", idsByType.get("sprint")!)
      : Promise.resolve({ data: null }),
  ]);
  collect(csRes.data);
  collect(meetingRes.data);
  collect(dsRes.data);
  collect(taskRes.data);
  collect(sprintRes.data);
  if (idsByType.has("pm_review")) {
    const { data: pmRows } = await supabase
      .from("PMReview")
      .select("id, referenceWeek")
      .in("id", idsByType.get("pm_review")!);
    for (const r of pmRows ?? []) {
      meta.set(r.id, { title: `PM Review ${r.referenceWeek}`, url: null });
    }
  }

  const enriched = new Map<string, EnrichedSource[]>();
  for (const s of sources) {
    const m = meta.get(s.sourceId);
    enriched.set(s.wikiSectionId, [
      ...(enriched.get(s.wikiSectionId) ?? []),
      {
        bulletHash: s.bulletHash,
        sourceType: s.sourceType,
        sourceId: s.sourceId,
        title: m?.title ?? null,
        url: m?.url ?? null,
      },
    ]);
  }

  return NextResponse.json({
    sections: (sections ?? []).map((s) => ({
      id: s.id,
      sectionKey: s.sectionKey,
      title: s.title,
      data: s.data,
      suppressed: parseSuppressed(s.suppressed),
      generatedAt: s.generatedAt,
      generatedBy: s.generatedBy,
      sources: enriched.get(s.id) ?? [],
    })),
  });
}
