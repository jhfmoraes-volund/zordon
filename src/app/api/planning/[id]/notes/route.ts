/**
 * POST /api/planning/[id]/notes
 * Adiciona uma PlanningContextNote disparada pelo PM via UI.
 *
 * Body: { kind, content, sourceTranscriptIds?, sourceMeetingIds?,
 *         sourceRepoPath?, priority? }
 *
 * Notes do Alpha NÃO passam aqui — vão via tool server-side, chamando
 * `addContextNote` direto no DAL com `generatedByAgent='alpha'`.
 * Aqui o XOR é fixo: `generatedByMemberId = current member`.
 */
import { NextRequest, NextResponse } from "next/server";
import { getActorMemberId, requireProjectViewApi } from "@/lib/dal";
import {
  addContextNote,
  getPlanningById,
  type ContextNoteKind,
} from "@/lib/dal/planning";

const VALID_KINDS: readonly ContextNoteKind[] = [
  "summary",
  "theme",
  "risk",
  "capacity_signal",
  "code_observation",
  "open_question",
];

type Body = {
  kind?: string;
  content?: string;
  sourceTranscriptIds?: string[];
  sourceMeetingIds?: string[];
  sourceRepoPath?: string | null;
  priority?: number;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const planning = await getPlanningById(id);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }
  const denied = await requireProjectViewApi(planning.projectId);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as Body | null;
  const kind = body?.kind as ContextNoteKind | undefined;
  if (!kind || !VALID_KINDS.includes(kind)) {
    return NextResponse.json(
      { error: `kind inválido. válidos: ${VALID_KINDS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!body?.content?.trim()) {
    return NextResponse.json({ error: "content obrigatório" }, { status: 400 });
  }

  const memberId = await getActorMemberId();
  if (!memberId) {
    return NextResponse.json({ error: "sem memberId no contexto" }, { status: 401 });
  }

  const note = await addContextNote({
    planningCeremonyId: id,
    kind,
    content: body.content,
    sourceTranscriptIds: body.sourceTranscriptIds ?? [],
    sourceMeetingIds: body.sourceMeetingIds ?? [],
    sourceRepoPath: body.sourceRepoPath ?? null,
    priority: body.priority ?? 0,
    generatedByMemberId: memberId,
  });
  return NextResponse.json(note, { status: 201 });
}
