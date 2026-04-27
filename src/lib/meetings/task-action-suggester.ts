import { generateText } from "ai";
import { getModel, DEFAULT_MODEL } from "@/lib/ai/provider";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Supabase = SupabaseClient<Database>;

export type SuggestedAction = {
  type: "create" | "update" | "delete" | "move" | "review";
  taskId?: string | null;
  payload?: Record<string, unknown>;
  targetSprintId?: string | null;
  reasoning: string;
  confidence: number;
  reviewReasons?: string[];
  reviewNote?: string;
};

const SYSTEM_PROMPT = `Você é um assistente de planejamento de sprint.
A partir do contexto da reunião e do estado atual da sprint, sugira AÇÕES sobre as tasks.

Tipos de ação disponíveis:
- "create": criar uma task nova (sem taskId; payload com title, description, scope, complexity, priority, type, assigneeIds opcional)
- "update": editar campos de uma task existente (taskId obrigatório; payload com os campos a alterar)
- "delete": remover task da sprint atual e devolver pro backlog (taskId obrigatório)
- "move": mover task pra outra sprint (taskId + targetSprintId obrigatórios)
- "review": marcar task pra discussão posterior (taskId; reviewReasons[] e reviewNote)

Valores válidos:
- type (create.payload.type): "feature" | "bug" | "chore" | "spike" | "refactor"
- scope: "small" | "medium" | "large"
- complexity: "low" | "medium" | "high"
- status (create.payload.status): "backlog" | "todo"
- priority: 0-10 (int)
- reviewReasons: subset de ["scope","acceptance_criteria","dependencies","estimate","assignee","other"]

Regras:
- Seja conservador. Se não houver evidência clara nas notas da reunião, NÃO sugira ações.
- Confidence é 0..1 — use 0.5 como threshold mental abaixo do qual a sugestão deveria virar "review" em vez de ação direta.
- Cada sugestão precisa de uma "reasoning" curta (1-2 frases em pt-BR) explicando o porquê.
- Retorne APENAS JSON válido no formato { "actions": [ ... ] }. Sem texto antes ou depois.`;

type SprintContext = {
  meeting: {
    id: string;
    type: string;
    date: string;
    notes: string | null;
  };
  project: { id: string; name: string };
  sprint: { id: string; name: string; status: string } | null;
  tasks: Array<{
    id: string;
    reference: string | null;
    title: string;
    status: string;
    scope: string;
    complexity: string;
    priority: number;
    type: string;
    assignees: string[];
  }>;
  otherSprints: Array<{ id: string; name: string; status: string }>;
};

export async function buildSuggestionContext(
  supabase: Supabase,
  meetingId: string,
  projectId: string
): Promise<SprintContext> {
  const { data: meeting } = await supabase
    .from("Meeting")
    .select("id, type, date, notes, sprintId")
    .eq("id", meetingId)
    .single();
  if (!meeting) throw new Error("Meeting not found");

  const { data: project } = await supabase
    .from("Project")
    .select("id, name")
    .eq("id", projectId)
    .single();
  if (!project) throw new Error("Project not found");

  // Pra super_planning a sprint vem da meeting; pra daily, sprint ativa do projeto
  let sprint: SprintContext["sprint"] = null;
  if (meeting.type === "super_planning" && meeting.sprintId) {
    const { data } = await supabase
      .from("Sprint")
      .select("id, name, status")
      .eq("id", meeting.sprintId)
      .maybeSingle();
    sprint = data ?? null;
  } else {
    const { data } = await supabase
      .from("Sprint")
      .select("id, name, status")
      .eq("projectId", projectId)
      .eq("status", "active")
      .maybeSingle();
    sprint = data ?? null;
  }

  // Tasks da sprint (ou backlog se não tem sprint ativa)
  const tasksQuery = supabase
    .from("Task")
    .select(
      "id, reference, title, status, scope, complexity, priority, type, assignments:TaskAssignment(member:Member(name))"
    )
    .eq("projectId", projectId)
    .order("priority", { ascending: false });

  const { data: tasksRaw } = sprint
    ? await tasksQuery.eq("sprintId", sprint.id)
    : await tasksQuery.eq("status", "backlog").limit(20);

  const tasks = (tasksRaw ?? []).map((t) => ({
    id: t.id,
    reference: t.reference,
    title: t.title,
    status: t.status,
    scope: t.scope,
    complexity: t.complexity,
    priority: t.priority,
    type: t.type,
    assignees: (t.assignments ?? [])
      .map((a: { member: { name: string } | null }) => a.member?.name)
      .filter((n: string | undefined): n is string => Boolean(n)),
  }));

  // Sprints alternativas pra MOVE (planning ou active, exceto a atual)
  const { data: otherSprints } = await supabase
    .from("Sprint")
    .select("id, name, status")
    .eq("projectId", projectId)
    .in("status", ["planning", "active"])
    .neq("id", sprint?.id ?? "");

  return {
    meeting: {
      id: meeting.id,
      type: meeting.type,
      date: meeting.date,
      notes: meeting.notes,
    },
    project,
    sprint,
    tasks,
    otherSprints: otherSprints ?? [],
  };
}

function formatContext(ctx: SprintContext): string {
  const lines: string[] = [];
  lines.push(`# Reunião`);
  lines.push(`Tipo: ${ctx.meeting.type}`);
  lines.push(`Data: ${ctx.meeting.date}`);
  lines.push(`Projeto: ${ctx.project.name} (id=${ctx.project.id})`);
  lines.push(`Sprint: ${ctx.sprint ? `${ctx.sprint.name} (id=${ctx.sprint.id}, status=${ctx.sprint.status})` : "—"}`);
  lines.push("");
  lines.push(`## Notas da reunião`);
  lines.push(ctx.meeting.notes?.trim() || "(sem notas — IA deve ser cautelosa)");
  lines.push("");
  lines.push(`## Tasks atuais (${ctx.tasks.length})`);
  if (ctx.tasks.length === 0) {
    lines.push("(nenhuma)");
  } else {
    for (const t of ctx.tasks) {
      lines.push(
        `- [${t.reference ?? t.id}] ${t.title} · status=${t.status} · scope=${t.scope}/${t.complexity} · prio=${t.priority} · type=${t.type} · assignees=${t.assignees.join(", ") || "—"}`
      );
    }
  }
  lines.push("");
  lines.push(`## Sprints alternativas pra MOVE`);
  if (ctx.otherSprints.length === 0) {
    lines.push("(nenhuma — não sugira MOVE)");
  } else {
    for (const s of ctx.otherSprints) {
      lines.push(`- ${s.name} (id=${s.id}, status=${s.status})`);
    }
  }
  return lines.join("\n");
}

export async function suggestActions(
  supabase: Supabase,
  meetingId: string,
  projectId: string
): Promise<SuggestedAction[]> {
  const ctx = await buildSuggestionContext(supabase, meetingId, projectId);
  const userPrompt = formatContext(ctx);

  const { text } = await generateText({
    model: getModel(DEFAULT_MODEL),
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  return parseActions(text);
}

function parseActions(text: string): SuggestedAction[] {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Última tentativa: extrair primeiro bloco {...}
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  const obj = parsed as { actions?: unknown };
  if (!obj || !Array.isArray(obj.actions)) return [];

  const valid: SuggestedAction[] = [];
  for (const raw of obj.actions) {
    const a = raw as Partial<SuggestedAction>;
    if (!a.type || !["create", "update", "delete", "move", "review"].includes(a.type)) continue;
    if (a.type !== "create" && !a.taskId) continue;
    if (a.type === "move" && !a.targetSprintId) continue;
    valid.push({
      type: a.type,
      taskId: a.taskId ?? null,
      payload: a.payload ?? {},
      targetSprintId: a.targetSprintId ?? null,
      reasoning: a.reasoning ?? "",
      confidence: typeof a.confidence === "number" ? a.confidence : 0.5,
      reviewReasons: a.reviewReasons,
      reviewNote: a.reviewNote,
    });
  }
  return valid;
}
