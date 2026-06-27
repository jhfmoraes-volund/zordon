import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import {
  extractActions,
  type ExtractedTodo,
} from "@/lib/agent/agents/alpha/extractors/actions";
import { getMeetingDetail } from "@/lib/meetings";
import { getMemberIntegrationToken } from "@/lib/member-integrations";
import type { Database } from "@/lib/supabase/database.types";

type TodoInsert = Database["public"]["Tables"]["Todo"]["Insert"];

/**
 * POST /api/meetings/[id]/suggest-actions
 *
 * Roda o sub-agente `extractActions` na transcrição/notas da reunião e
 * persiste apenas To-dos (Plano de Tasks vive em Planning Ceremony agora —
 * meetings só criam Todo).
 *
 * Idempotente: antes de inserir, apaga todos source='ai' decision='pending'
 * pré-existentes deste meeting.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return await handle(params);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error("[suggest-actions] unhandled error", { msg, stack });
    return NextResponse.json(
      { error: `Erro inesperado: ${msg}` },
      { status: 500 },
    );
  }
}

async function handle(params: Promise<{ id: string }>) {
  // Disparar extração de IA + persistir Todos é operação de PM. Reconcilia
  // requireMinLevelApi(MANAGER): sem projectId, meeting.edit gateia manager+.
  const denied = await requireCapabilityApi("meeting.edit");
  if (denied) return denied;

  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "No member" }, { status: 401 });
  }

  const { id: meetingId } = await params;
  const supabase = db();

  type MeetingRow = {
    id: string;
    type: string;
    notes: string | null;
    transcriptRefs: Array<{
      source: string | null;
      sourceId: string | null;
      fullText: string | null;
    }> | null;
    projectLinks: Array<{
      project: { id: string; name: string } | null;
    }> | null;
  };

  const { data: meetingRaw, error: meetingErr } = await supabase
    .from("Meeting")
    .select(
      "id, type, notes, transcriptRefs:ContextSource!ContextSource_meetingId_fkey(source, sourceId, fullText), projectLinks:MeetingProjectLink(project:Project(id, name))",
    )
    .eq("id", meetingId)
    .maybeSingle();

  if (meetingErr) {
    return NextResponse.json({ error: meetingErr.message }, { status: 500 });
  }
  if (!meetingRaw) {
    return NextResponse.json({ error: "Reunião não encontrada" }, { status: 404 });
  }

  const meeting = meetingRaw as unknown as MeetingRow;

  const projects = (meeting.projectLinks || [])
    .map((l) => l.project)
    .filter((p): p is { id: string; name: string } => !!p);

  // Resolve transcrição via SSOT (TranscriptRef joined). Fallback chain:
  // fullText cacheado → live fetch via Roam/Granola → notas do Meeting.
  const primaryRef = meeting.transcriptRefs?.[0] ?? null;
  let transcript = primaryRef?.fullText?.trim() || "";

  const transcriptSource = primaryRef?.source ?? null;
  const transcriptSourceId = primaryRef?.sourceId ?? null;
  // Live fetch só pra sources externas com API conhecida (Roam / Granola).
  // Manual / spreadsheet não têm endpoint pra re-fetch — seguem com fullText
  // cacheado ou nada.
  const liveFetchable =
    transcriptSource === "roam" || transcriptSource === "granola";
  if (!transcript && liveFetchable && transcriptSourceId) {
    try {
      const source = transcriptSource as "roam" | "granola";
      const [roamToken, granolaToken] = await Promise.all([
        getMemberIntegrationToken(me.id, "roam"),
        getMemberIntegrationToken(me.id, "granola"),
      ]);
      const detail = await getMeetingDetail(
        { roamToken, granolaToken },
        source,
        transcriptSourceId,
      );
      transcript = detail.transcriptText;
    } catch (e) {
      console.warn("suggest-actions: failed to fetch live transcript", e);
    }
  }

  if (!transcript) {
    transcript = meeting.notes?.trim() || "";
  }

  if (!transcript) {
    return NextResponse.json(
      {
        error:
          "Reunião não tem transcrição nem notas. Importe uma transcrição ou escreva notas antes de usar Sugerir com IA.",
      },
      { status: 400 },
    );
  }

  // Hidrata contexto pro sub-agente (membros do squad p/ resolver assignees)
  const projectIds = projects.map((p) => p.id);

  const [pmRes, pmsRes] = await Promise.all([
    projectIds.length > 0
      ? supabase
          .from("ProjectMember")
          .select("member:Member(id, name, role)")
          .in("projectId", projectIds)
      : Promise.resolve({ data: [] as Array<{ member: { id: string; name: string; role: string } | null }> }),
    projectIds.length > 0
      ? supabase
          .from("Project")
          .select("pm:Member!Project_pmId_fkey(id, name, role)")
          .in("id", projectIds)
      : Promise.resolve({ data: [] as Array<{ pm: { id: string; name: string; role: string } | null }> }),
  ]);

  const memberMap = new Map<
    string,
    { id: string; name: string; role: string }
  >();
  // Owner sempre é assignee válido (especialmente em private sem squad).
  memberMap.set(me.id, { id: me.id, name: me.name, role: me.role });
  for (const pm of pmRes.data || []) {
    const m = (pm as { member: { id: string; name: string; role: string } | null }).member;
    if (m) memberMap.set(m.id, m);
  }
  for (const p of pmsRes.data || []) {
    const pm = (p as { pm: { id: string; name: string; role: string } | null }).pm;
    if (pm) memberMap.set(pm.id, pm);
  }

  const members = Array.from(memberMap.values());

  // Chama o sub-agente — meetingType="general" porque meetings não geram
  // Tasks. Mesmo que o sub-agente devolva tasks, ignoramos.
  let extraction;
  try {
    extraction = await extractActions({
      transcript,
      meetingType: "general",
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      members,
      userStories: [],
      tasks: [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Sub-agente falhou: ${msg}` },
      { status: 500 },
    );
  }

  // Idempotência: apaga Todos AI pending anteriores deste meeting.
  await supabase
    .from("Todo")
    .delete()
    .eq("meetingId", meetingId)
    .eq("source", "ai")
    .eq("decision", "pending");

  const memberByName = new Map(
    members.map((m) => [m.name.toLowerCase(), m.id] as const),
  );

  const todoRows: TodoInsert[] = [];
  const unresolvedTodos: Array<{ description: string; reason: string }> = [];

  for (const t of extraction.todos as ExtractedTodo[]) {
    if (!t.assigneeName) {
      unresolvedTodos.push({
        description: t.description,
        reason: "Todo sem assignee — sub-agente não identificou responsável",
      });
      continue;
    }
    const assigneeId = memberByName.get(t.assigneeName.toLowerCase());
    if (!assigneeId) {
      unresolvedTodos.push({
        description: t.description,
        reason: `assignee "${t.assigneeName}" não está no squad da reunião`,
      });
      continue;
    }

    todoRows.push({
      id: crypto.randomUUID(),
      meetingId,
      source: "ai",
      decision: "pending",
      description: t.description.slice(0, 500),
      assigneeId,
      createdById: me.id,
      dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
      status: "todo",
      sourceReviewId: null,
      notes: t.reasoning,
      updatedAt: new Date().toISOString(),
    });
  }

  const todosRes =
    todoRows.length > 0
      ? await supabase.from("Todo").insert(todoRows).select("id")
      : { data: [], error: null };

  if (todosRes.error) {
    return NextResponse.json(
      { error: `Falha ao inserir To-dos: ${todosRes.error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    counts: {
      todosCreated: todoRows.length,
      skipped: extraction.skipped.length,
      unresolvedTodos: unresolvedTodos.length,
    },
    skipped: extraction.skipped,
    unresolvedTodos,
  });
}
