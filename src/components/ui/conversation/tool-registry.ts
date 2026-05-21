import {
  AlertTriangle,
  BookOpen,
  Brain,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  Database,
  Eye,
  FileText,
  GitBranch,
  HelpCircle,
  Layers,
  Lightbulb,
  ListChecks,
  ListTodo,
  type LucideIcon,
  MessageCircle,
  Mic,
  NotebookPen,
  Pencil,
  Plus,
  Save,
  Search,
  Send,
  Sparkles,
  Tag,
  Target,
  Trash2,
  UserCircle,
  Users,
  Wand2,
  XCircle,
} from "lucide-react";

type ToolMeta = {
  label: (args: Record<string, unknown>) => string;
  icon: LucideIcon;
};

export const TOOL_REGISTRY: Record<string, ToolMeta> = {
  set_field: {
    label: (a) => `Preenchendo ${a.field} em ${a.stepKey}`,
    icon: Pencil,
  },
  add_item: {
    label: (a) => `Criando item em ${a.arrayKey} (${a.stepKey})`,
    icon: Plus,
  },
  update_item: {
    label: (a) => `Atualizando item em ${a.arrayKey} (${a.stepKey})`,
    icon: Pencil,
  },
  delete_item: {
    label: (a) => `Removendo item de ${a.arrayKey} (${a.stepKey})`,
    icon: Trash2,
  },
  get_step_data: {
    label: (a) => `Consultando ${a.stepKey}`,
    icon: Database,
  },
  web_search: {
    label: (a) => `Pesquisando: "${a.query}"`,
    icon: Search,
  },
  create_task: {
    label: (a) => `Criando task: ${a.title}`,
    icon: ListTodo,
  },

  // Alpha (ops) — sprint / tasks
  get_sprint_overview: { label: () => "Lendo sprint atual", icon: Eye },
  get_tasks: { label: () => "Buscando tasks", icon: ListChecks },
  get_alerts: { label: () => "Checando alertas", icon: AlertTriangle },
  list_sprints: { label: () => "Listando sprints", icon: Layers },
  get_backlog: { label: () => "Lendo backlog", icon: ClipboardList },
  get_allocated_project_members: {
    label: () => "Conferindo alocação",
    icon: Users,
  },
  load_heuristic: {
    label: (a) => `Lendo heurística: ${a.name ?? "?"}`,
    icon: BookOpen,
  },
  create_sprint: {
    label: (a) => `Criando sprint: ${a.name ?? ""}`.trim(),
    icon: Plus,
  },
  update_task: {
    label: (a) => `Atualizando task ${a.taskRef ?? a.id ?? ""}`.trim(),
    icon: Pencil,
  },
  manage_allocation: { label: () => "Ajustando alocação", icon: Users },

  // Alpha — meetings
  get_recent_meetings: { label: () => "Listando reuniões", icon: Calendar },
  get_meeting_transcript: { label: () => "Lendo transcrição", icon: Mic },
  ask_meeting: {
    label: (a) => `Consultando reunião: "${a.question ?? ""}"`.trim(),
    icon: MessageCircle,
  },
  get_meeting_reviews: { label: () => "Lendo reviews", icon: FileText },
  list_meeting_actions: {
    label: () => "Listando ações da reunião",
    icon: ListTodo,
  },
  create_meeting: {
    label: (a) => `Criando reunião: ${a.title ?? ""}`.trim(),
    icon: Plus,
  },
  update_meeting_review: {
    label: () => "Atualizando review",
    icon: Pencil,
  },
  create_todo: {
    label: (a) => `Criando todo: ${a.title ?? ""}`.trim(),
    icon: ListTodo,
  },
  propose_task_action: {
    label: () => "Propondo ação na task",
    icon: Wand2,
  },
  discard_meeting_action: {
    label: () => "Descartando ação",
    icon: XCircle,
  },
  get_pending_actions: {
    label: () => "Listando ações pendentes",
    icon: CheckCircle2,
  },

  // Alpha — outros
  search_doc: {
    label: (a) => `Pesquisando docs: "${a.query ?? ""}"`.trim(),
    icon: Search,
  },
  send_message: {
    label: () => "Enviando mensagem",
    icon: Send,
  },

  // Alpha — stories / hierarchy
  approve_module: {
    label: (a) => `Aprovando módulo ${a.moduleRef ?? a.id ?? ""}`.trim(),
    icon: CheckSquare,
  },
  bulk_update_tasks: { label: () => "Atualizando tasks em massa", icon: Pencil },
  get_story: {
    label: (a) => `Lendo story ${a.storyRef ?? a.id ?? ""}`.trim(),
    icon: NotebookPen,
  },
  list_stories: { label: () => "Listando stories", icon: NotebookPen },
  list_modules: { label: () => "Listando módulos", icon: Layers },
  list_personas: { label: () => "Listando personas", icon: UserCircle },
  list_unplanned_tasks: {
    label: () => "Listando tasks sem sprint",
    icon: ListChecks,
  },
  manage_story_ac: {
    label: (a) => `Ajustando AC da story ${a.storyRef ?? ""}`.trim(),
    icon: CheckSquare,
  },
  set_story_refinement: {
    label: (a) => `Marcando refinamento: ${a.status ?? ""}`.trim(),
    icon: GitBranch,
  },
  update_user_story: {
    label: (a) => `Atualizando story ${a.storyRef ?? a.id ?? ""}`.trim(),
    icon: Pencil,
  },
  create_user_story: {
    label: (a) => `Criando story: ${a.title ?? ""}`.trim(),
    icon: Plus,
  },

  // Alpha — capacity / sprint
  get_project_capacity: {
    label: () => "Calculando capacidade do projeto",
    icon: Target,
  },
  verify_sprint_distribution: {
    label: () => "Verificando distribuição do sprint",
    icon: Target,
  },

  // Design session — listings
  list_tasks: { label: () => "Listando tasks da sessão", icon: ListChecks },
  list_project_tasks: { label: () => "Listando tasks do projeto", icon: ListChecks },
  list_project_sessions: {
    label: () => "Listando design sessions",
    icon: Layers,
  },
  list_project_tags: { label: () => "Listando tags do projeto", icon: Tag },
  list_decisions: { label: () => "Listando decisões", icon: NotebookPen },
  list_open_questions: { label: () => "Listando perguntas abertas", icon: HelpCircle },
  list_research: { label: () => "Listando pesquisas", icon: BookOpen },

  // Design session — decisions / questions
  record_decision: {
    label: (a) => `Registrando decisão: "${a.title ?? a.summary ?? ""}"`.trim(),
    icon: NotebookPen,
  },
  revise_decision: {
    label: (a) => `Revisando decisão ${a.decisionId ?? a.id ?? ""}`.trim(),
    icon: Pencil,
  },
  add_open_question: {
    label: (a) => `Abrindo pergunta: "${a.question ?? ""}"`.trim(),
    icon: HelpCircle,
  },
  resolve_open_question: {
    label: () => "Resolvendo pergunta aberta",
    icon: CheckCircle2,
  },

  // Design session — memory / context
  read_business_context: {
    label: () => "Lendo contexto de negócio",
    icon: FileText,
  },
  read_session_memory: { label: () => "Lendo memória da sessão", icon: Brain },
  update_session_memory: {
    label: () => "Atualizando memória da sessão",
    icon: Save,
  },
  read_project_memory: { label: () => "Lendo memória do projeto", icon: Brain },
  update_project_memory: {
    label: () => "Atualizando memória do projeto",
    icon: Save,
  },
  compact_session_to_project: {
    label: () => "Consolidando sessão na memória do projeto",
    icon: Save,
  },

  // Design session — tasks
  delete_task: {
    label: (a) => `Removendo task ${a.taskRef ?? a.id ?? ""}`.trim(),
    icon: Trash2,
  },

  // Design session — stories (compartilhadas com Alpha mas reusam pattern)
  delete_user_story: {
    label: (a) => `Removendo story ${a.storyRef ?? a.id ?? ""}`.trim(),
    icon: Trash2,
  },

  // Design session — propostas / mvp
  propose_modules: { label: () => "Propondo módulos", icon: Lightbulb },
  mvp_check: { label: () => "Avaliando MVP", icon: Target },
  sync_project_personas: {
    label: () => "Sincronizando personas no projeto",
    icon: UserCircle,
  },

  // Design session — write tools (batched). Mostra ação + contagem do batch.
  write_brainstorm: { label: (a) => batchLabel("brainstorm", a), icon: Lightbulb },
  write_priority: { label: (a) => batchLabel("priorização", a), icon: Target },
  write_risk: { label: (a) => batchLabel("risco", a, "riscos"), icon: AlertTriangle },
  write_gap: { label: (a) => batchLabel("lacuna", a, "lacunas"), icon: HelpCircle },
  write_hypothesis: {
    label: (a) => batchLabel("hipótese", a, "hipóteses"),
    icon: Sparkles,
  },
};

function batchLabel(
  singular: string,
  args: Record<string, unknown>,
  plural?: string,
): string {
  const action = typeof args.action === "string" ? args.action : "";
  const items = Array.isArray(args.items) ? args.items : [];
  const n = items.length;
  const noun = n === 1 ? singular : plural ?? `${singular}s`;
  const verb =
    action === "create"
      ? "Criando"
      : action === "update"
        ? "Atualizando"
        : action === "delete"
          ? "Removendo"
          : action === "move"
            ? "Movendo"
            : action === "archive"
              ? "Arquivando"
              : "Gravando";
  return n > 0 ? `${verb} ${n} ${noun}` : `${verb} ${noun}`;
}

export function resolveToolMeta(
  toolName: string,
  args: Record<string, unknown>,
): { label: string; icon: LucideIcon } {
  const meta = TOOL_REGISTRY[toolName];
  if (!meta) return { label: toolName, icon: Sparkles };
  try {
    return { label: meta.label(args ?? {}), icon: meta.icon };
  } catch {
    return { label: toolName, icon: meta.icon };
  }
}
