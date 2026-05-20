import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMinLevelApi, getCurrentMember } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import {
  extractActions,
  type ExtractedTask,
  type ExtractedTodo,
} from "@/lib/agent/agents/alpha/extractors/actions";
import { getMeetingDetail } from "@/lib/meetings";
import { getMemberIntegrationToken } from "@/lib/member-integrations";
import type { Database } from "@/lib/supabase/database.types";

type ActionInsert = Database["public"]["Tables"]["MeetingTaskAction"]["Insert"];
type TodoInsert = Database["public"]["Tables"]["Todo"]["Insert"];

/**
 * POST /api/meetings/[id]/suggest-actions
 *
 * Roda o sub-agente `extractActions` na transcrição/notas da reunião e
 * persiste o resultado em batch:
 *   - tasks → MeetingTaskAction (source='ai', decision='pending')
 *   - todos → Todo (source='meeting')
 *   - skipped → retorna na resposta pra UI exibir
 *
 * Idempotente: antes de inserir, apaga propostas pending pré-existentes
 * com source='ai' deste meeting. To-dos source='meeting' não são apagados
 * (podem ter sido criados manualmente; preserva).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const me = await getCurrentMember();
  if (!me) {
    return NextResponse.json({ error: "No member" }, { status: 401 });
  }

  const { id: meetingId } = await params;
  const supabase = db();

  // ─── 1. Carrega meeting + projetos vinculados + contexto ─────────────────
  type MeetingRow = {
    id: string;
    type: string;
    notes: string | null;
    transcript: string | null;
    transcriptSource: string | null;
    transcriptSourceId: string | null;
    projectLinks: Array<{
      project: { id: string; name: string } | null;
    }> | null;
  };

  const { data: meetingRaw, error: meetingErr } = await supabase
    .from("Meeting")
    .select(
      `id, type, notes, transcript, transcriptSource, transcriptSourceId,
       projectLinks:MeetingProjectLink(project:Project(id, name))`,
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

  if (projects.length === 0) {
    return NextResponse.json(
      {
        error:
          "Reunião sem projetos vinculados. Vincule ao menos 1 projeto antes de usar Sugerir com IA.",
      },
      { status: 400 },
    );
  }

  // ─── 2. Resolve transcrição (cached / live API / notes fallback) ─────────
  let transcript = meeting.transcript?.trim() || "";

  const transcriptSource = meeting.transcriptSource;
  const transcriptSourceId = meeting.transcriptSourceId;
  if (!transcript && transcriptSource && transcriptSourceId) {
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
      // Cai pro fallback de notes silenciosamente — o sub-agente lida com input curto.
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

  // ─── 3. Hidrata contexto pro sub-agente ──────────────────────────────────
  const projectIds = projects.map((p) => p.id);

  const [pmRes, pmsRes, storiesRes, tasksRes] = await Promise.all([
    supabase
      .from("ProjectMember")
      .select("member:Member(id, name, role)")
      .in("projectId", projectIds),
    supabase
      .from("Project")
      .select("pm:Member!Project_pmId_fkey(id, name, role)")
      .in("id", projectIds),
    supabase
      .from("UserStory")
      .select("id, reference, title")
      .in("projectId", projectIds)
      .in("refinementStatus", ["refined", "committed"])
      .order("reference", { ascending: true }),
    supabase
      .from("Task")
      .select("reference, title, status, updatedAt")
      .in("projectId", projectIds)
      .neq("status", "done")
      .order("updatedAt", { ascending: false })
      .limit(500),
  ]);

  const memberMap = new Map<
    string,
    { id: string; name: string; role: string }
  >();
  for (const pm of pmRes.data || []) {
    const m = (pm as { member: { id: string; name: string; role: string } | null }).member;
    if (m) memberMap.set(m.id, m);
  }
  for (const p of pmsRes.data || []) {
    const pm = (p as { pm: { id: string; name: string; role: string } | null }).pm;
    if (pm) memberMap.set(pm.id, pm);
  }

  const members = Array.from(memberMap.values());

  const userStories = (storiesRes.data || []).map((s) => ({
    id: s.id as string,
    reference: s.reference as string,
    title: s.title as string,
  }));

  const tasksList = (tasksRes.data || []).map((t) => ({
    reference: t.reference as string,
    title: t.title as string,
    status: t.status as string,
  }));

  // ─── 4. Chama o sub-agente ───────────────────────────────────────────────
  let extraction;
  try {
    extraction = await extractActions({
      transcript,
      meetingType: meeting.type as
        | "pm_review"
        | "general"
        | "daily"
        | "super_planning"
        | "private",
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      members,
      userStories,
      tasks: tasksList,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Sub-agente falhou: ${msg}` },
      { status: 500 },
    );
  }

  // ─── 5. Idempotência: apaga propostas AI pending anteriores ──────────────
  await supabase
    .from("MeetingTaskAction")
    .delete()
    .eq("meetingId", meetingId)
    .eq("source", "ai")
    .eq("decision", "pending");

  // ─── 6. Resolve nomes → ids e monta inserts ──────────────────────────────
  const projectByName = new Map(
    projects.map((p) => [p.name.toLowerCase(), p.id] as const),
  );
  const memberByName = new Map(
    members.map((m) => [m.name.toLowerCase(), m.id] as const),
  );

  // Pra resolver taskId e userStoryId precisamos buscar refs no banco
  // (o sub-agente só devolve reference, não UUID).
  const taskRefs = extraction.tasks
    .map((t: ExtractedTask) => t.taskReference)
    .filter((r): r is string => !!r);
  const usRefs = extraction.tasks
    .map((t: ExtractedTask) => t.userStoryReference)
    .filter((r): r is string => !!r);

  const [taskIdMapRes, usIdMapRes] = await Promise.all([
    taskRefs.length > 0
      ? supabase
          .from("Task")
          .select("id, reference")
          .in("reference", taskRefs)
      : Promise.resolve({ data: [] as { id: string; reference: string }[] }),
    usRefs.length > 0
      ? supabase
          .from("UserStory")
          .select("id, reference")
          .in("reference", usRefs)
      : Promise.resolve({ data: [] as { id: string; reference: string }[] }),
  ]);

  const taskIdByRef = new Map<string, string>();
  for (const t of taskIdMapRes.data || []) {
    if (t.reference) taskIdByRef.set(t.reference, t.id);
  }
  const usIdByRef = new Map<string, string>();
  for (const u of usIdMapRes.data || []) {
    if (u.reference) usIdByRef.set(u.reference, u.id);
  }

  // ─── 7. Constrói MeetingTaskAction inserts ───────────────────────────────
  const actionRows: ActionInsert[] = [];
  const unresolvedTasks: Array<{ title: string; reason: string }> = [];

  for (const t of extraction.tasks) {
    const projectId = projectByName.get(t.projectName.toLowerCase());
    if (!projectId) {
      unresolvedTasks.push({
        title: t.title,
        reason: `projeto "${t.projectName}" não vinculado à reunião`,
      });
      continue;
    }

    const assigneeId = t.assigneeName
      ? memberByName.get(t.assigneeName.toLowerCase())
      : null;

    const taskId =
      t.taskReference && taskIdByRef.get(t.taskReference)
        ? taskIdByRef.get(t.taskReference)!
        : null;

    // Validação: update/review precisa de taskId resolvido
    if ((t.type === "update" || t.type === "review") && !taskId) {
      unresolvedTasks.push({
        title: t.title,
        reason: `taskReference "${t.taskReference}" não encontrada — proposta ignorada`,
      });
      continue;
    }

    const userStoryId =
      t.userStoryReference && usIdByRef.get(t.userStoryReference)
        ? usIdByRef.get(t.userStoryReference)!
        : null;

    const payload: Record<string, unknown> = {
      title: t.title,
    };
    if (t.description) payload.description = t.description;
    if (assigneeId) payload.assigneeIds = [assigneeId];
    if (userStoryId) payload.userStoryId = userStoryId;
    if (t.type === "create") payload.status = "backlog";

    let reviewReasons: string[] | null = null;
    let reviewNote: string | null = null;
    if (t.type === "review") {
      reviewReasons = ["other"];
      reviewNote = t.reasoning;
    }

    actionRows.push({
      id: crypto.randomUUID(),
      meetingId,
      projectId,
      type: t.type,
      taskId,
      targetSprintId: null,
      payload: payload as ActionInsert["payload"],
      decision: "pending",
      execution: "pending",
      source: "ai",
      aiReasoning: t.reasoning,
      aiConfidence: t.confidence,
      reviewReasons,
      reviewNote,
      updatedAt: new Date().toISOString(),
    });
  }

  // ─── 8. Constrói Todo inserts ────────────────────────────────────────────
  const todoRows: TodoInsert[] = [];
  const unresolvedTodos: Array<{ description: string; reason: string }> = [];

  for (const t of extraction.todos as ExtractedTodo[]) {
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
      source: "meeting",
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

  // ─── 9. Executa inserts em paralelo ──────────────────────────────────────
  const [actionsRes, todosRes] = await Promise.all([
    actionRows.length > 0
      ? supabase.from("MeetingTaskAction").insert(actionRows).select("id")
      : Promise.resolve({ data: [], error: null }),
    todoRows.length > 0
      ? supabase.from("Todo").insert(todoRows).select("id")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (actionsRes.error) {
    return NextResponse.json(
      { error: `Falha ao inserir propostas: ${actionsRes.error.message}` },
      { status: 500 },
    );
  }
  if (todosRes.error) {
    return NextResponse.json(
      { error: `Falha ao inserir To-dos: ${todosRes.error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    counts: {
      tasksProposed: actionRows.length,
      todosCreated: todoRows.length,
      skipped: extraction.skipped.length,
      unresolvedTasks: unresolvedTasks.length,
      unresolvedTodos: unresolvedTodos.length,
    },
    skipped: extraction.skipped,
    unresolvedTasks,
    unresolvedTodos,
  });
}
