"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/ui/markdown";
import { PageTitle } from "@/components/app-shell";
import {
  ArrowLeft, Plus,
  ChevronDown, ChevronRight, ChevronsUpDown, ExternalLink, Download,
  Sparkles, Loader2, MoreHorizontal, Check, X, Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAlphaChat } from "@/components/alpha-chat";
import { TaskActionWidget } from "@/components/meetings/task-action-widget";
import { ImportMeetingModal } from "@/components/meetings/import-meeting-modal";
import { PersonalNoteCard } from "@/components/meetings/personal-note-card";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { StatusChip } from "@/components/ui/status-chip";
import { StatusChipSelect } from "@/components/ui/status-chip-select";
import {
  StatusCycleIcon,
  StatusCycleChip,
  nextCycleStatus,
} from "@/components/ui/status-cycle-control";
import {
  TodoSheet,
  type Todo as TodoSheetTodo,
} from "@/components/todo-sheet";
import {
  MEETING_STATUS, MEETING_TYPE, HEALTH, lookupChip,
  meetingStatusFromDate, MEETING_TYPE_LONG_LABELS,
} from "@/lib/status-chips";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { fmtDateFull as fmtDate, fmtDateNumeric as fmtShortDate, isOverdue } from "@/lib/date-utils";

// ─── Types ────────────────────────────────────────────────

type Member = { id: string; name: string };

type ActionItem = {
  id: string;
  description: string;
  assigneeId: string;
  assignee: Member;
  dueDate: string | null;
  status: string;
  source: string;
  decision: "pending" | "approved" | "rejected";
  sourceReviewId: string | null;
  sourceReview?: { project: { name: string } } | null;
  notes: string | null;
  createdAt: string;
};

type ProjectReview = {
  id: string;
  projectId: string;
  memberId: string;
  nextSteps: string | null;
  sprintHealth: string;
  attentionPoints: string | null;
  additionalNotes: string | null;
  order: number;
  project: { id: string; name: string; status: string };
  member: Member;
  actionItems: ActionItem[];
};

type Attendee = {
  id: string;
  role: string | null;
  member: Member | null;
  externalName: string | null;
  externalEmail: string | null;
  externalRole: string | null;
};

type ProjectLink = {
  meetingId: string;
  projectId: string;
  project: { id: string; name: string; status: string } | null;
};

type Meeting = {
  id: string;
  date: string;
  notes: string | null;
  type: "pm_review" | "general" | "daily" | "super_planning" | "private";
  title: string | null;
  sprintId: string | null;
  createdById: string | null;
  transcript: string | null;
  transcriptSource: "roam" | "granola" | null;
  transcriptSourceId: string | null;
  projectReviews: ProjectReview[];
  actionItems: ActionItem[];
  attendees: Attendee[];
  projectLinks: ProjectLink[];
};

// ─── Constants ────────────────────────────────────────────

// Long-form labels for the detail-page header (registry has short labels for lists)
// ─── Main Page ────────────────────────────────────────────

export default function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { member: currentMember, effectiveAccessLevel } = useAuth();
  const { status: alphaStatus } = useAlphaChat();
  const [suggesting, setSuggesting] = useState(false);
  const isBuilder = effectiveAccessLevel === "builder";
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loadError, setLoadError] = useState<"forbidden" | "notfound" | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [notes, setNotes] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [todoSheetOpen, setTodoSheetOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<TodoSheetTodo | null>(null);
  const [collapsedPms, setCollapsedPms] = useState<Set<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const load = async () => {
    const r = await fetch(`/api/meetings/${id}`);
    if (r.status === 403) {
      setLoadError("forbidden");
      setMeeting(null);
      return;
    }
    if (r.status === 404) {
      setLoadError("notfound");
      setMeeting(null);
      return;
    }
    if (!r.ok) {
      setLoadError("forbidden");
      setMeeting(null);
      return;
    }
    const data = await r.json();
    setLoadError(null);
    setMeeting(data);
    setNotes(data.notes || "");
  };

  useEffect(() => {
    load();
    fetch("/api/members").then((r) => r.json()).then(setMembers);
  }, [id]);

  // O Alpha ingere a transcrição em background (kickoffIngest → thread nova) e
  // só então grava notes/To-dos/Tasks com o meetingId desta reunião. Como a
  // página só busca no mount, sem isto a seção de To-dos fica vazia até reload
  // manual (os To-dos aparecem no Meu Perfil, que monta depois). Re-buscamos na
  // borda de descida streaming/submitted → ready/idle, quando o Alpha terminou.
  const prevAlphaStatus = useRef(alphaStatus);
  useEffect(() => {
    const wasRunning =
      prevAlphaStatus.current === "streaming" ||
      prevAlphaStatus.current === "submitted";
    const settled = alphaStatus === "ready" || alphaStatus === "idle";
    if (wasRunning && settled) load();
    prevAlphaStatus.current = alphaStatus;
  }, [alphaStatus]);

  if (loadError === "forbidden") {
    return (
      <div className="p-6 space-y-4">
        <div className="text-sm text-muted-foreground">
          Você não tem acesso a esta reunião.
        </div>
        <Link href="/meetings">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Voltar para reuniões
          </Button>
        </Link>
      </div>
    );
  }

  if (loadError === "notfound") {
    return (
      <div className="p-6 space-y-4">
        <div className="text-sm text-muted-foreground">Reunião não encontrada.</div>
        <Link href="/meetings">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Voltar para reuniões
          </Button>
        </Link>
      </div>
    );
  }

  if (!meeting) {
    return <div className="p-6 text-muted-foreground">Carregando...</div>;
  }

  // ─── Handlers ─────────────────────────────────────────

  const saveNotes = async () => {
    try {
      await fetchOrThrow(`/api/meetings/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar notas" });
    }
  };

  const updateReview = async (reviewId: string, data: Partial<ProjectReview>) => {
    try {
      await fetchOrThrow(`/api/meetings/${id}/reviews/${reviewId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar review" });
    }
  };

  const cycleActionStatus = async (action: ActionItem) => {
    const nextStatus = nextCycleStatus(action.status);
    setMeeting((cur) =>
      cur
        ? {
            ...cur,
            actionItems: cur.actionItems.map((a) =>
              a.id === action.id ? { ...a, status: nextStatus } : a,
            ),
          }
        : cur,
    );
    try {
      await fetchOrThrow(`/api/meetings/${id}/actions/${action.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
    } catch (e) {
      setMeeting((cur) =>
        cur
          ? {
              ...cur,
              actionItems: cur.actionItems.map((a) =>
                a.id === action.id ? { ...a, status: action.status } : a,
              ),
            }
          : cur,
      );
      showErrorToast(e, { label: "Falha ao atualizar status" });
    }
  };

  const decideAction = async (action: ActionItem, decision: "approved" | "rejected") => {
    const prevDecision = action.decision;
    setMeeting((cur) =>
      cur
        ? {
            ...cur,
            actionItems: cur.actionItems.map((a) =>
              a.id === action.id ? { ...a, decision } : a,
            ),
          }
        : cur,
    );
    try {
      await fetchOrThrow(`/api/meetings/${id}/actions/${action.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
    } catch (e) {
      setMeeting((cur) =>
        cur
          ? {
              ...cur,
              actionItems: cur.actionItems.map((a) =>
                a.id === action.id ? { ...a, decision: prevDecision } : a,
              ),
            }
          : cur,
      );
      showErrorToast(e, { label: "Falha ao atualizar sugestão" });
    }
  };

  const deleteAction = (action: ActionItem) => {
    setConfirmState({
      title: action.decision === "pending" ? "Excluir sugestão?" : "Excluir To-do?",
      description:
        action.decision === "pending"
          ? "A sugestão da IA será removida. Isso é diferente de rejeitar — não fica histórico."
          : "Essa To-do será removida permanentemente.",
      confirmLabel: "Excluir",
      destructive: true,
      onConfirm: async () => {
        const prevItems = meeting?.actionItems ?? [];
        setMeeting((cur) =>
          cur
            ? {
                ...cur,
                actionItems: cur.actionItems.filter((a) => a.id !== action.id),
              }
            : cur,
        );
        try {
          await fetchOrThrow(`/api/meetings/${id}/actions/${action.id}`, {
            method: "DELETE",
          });
        } catch (e) {
          setMeeting((cur) => (cur ? { ...cur, actionItems: prevItems } : cur));
          showErrorToast(e, { label: "Falha ao excluir" });
        }
      },
    });
  };

  const openCreateTodo = () => {
    setEditingTodo(null);
    setTodoSheetOpen(true);
  };

  const openEditTodo = (action: ActionItem) => {
    setEditingTodo({
      id: action.id,
      description: action.description,
      status: action.status as TodoSheetTodo["status"],
      dueDate: action.dueDate,
      notes: action.notes ?? null,
      source: "meeting",
      meetingId: meeting?.id ?? null,
      sourceReviewId: action.sourceReviewId,
      assigneeId: action.assigneeId,
      createdAt: action.createdAt,
      resolvedAt: null,
    });
    setTodoSheetOpen(true);
  };

  const reviewsByPm = meeting.projectReviews.reduce<Record<string, ProjectReview[]>>(
    (acc, review) => {
      const pmId = review.memberId;
      if (!acc[pmId]) acc[pmId] = [];
      acc[pmId].push(review);
      return acc;
    },
    {}
  );

  const togglePm = (pmId: string) => {
    setCollapsedPms((prev) => {
      const next = new Set(prev);
      if (next.has(pmId)) next.delete(pmId);
      else next.add(pmId);
      return next;
    });
  };

  const toggleProject = (reviewId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(reviewId)) next.delete(reviewId);
      else next.add(reviewId);
      return next;
    });
  };

  const allPmIds = Object.keys(reviewsByPm);
  const allCollapsed = allPmIds.length > 0 && allPmIds.every((id) => collapsedPms.has(id));

  const toggleAll = () => {
    if (allCollapsed) {
      setCollapsedPms(new Set());
      setExpandedProjects(new Set(meeting.projectReviews.map((r) => r.id)));
    } else {
      setCollapsedPms(new Set(allPmIds));
      setExpandedProjects(new Set());
    }
  };

  // Mode de edição: manager+ edita normalmente; builder só pode editar
  // privadas que ele mesmo criou (server enforces — UI mantém clean).
  const canEdit = !isBuilder
    ? true
    : meeting.type === "private" && !!currentMember && meeting.createdById === currentMember.id;

  // Título: prioriza título explícito; senão deriva por tipo.
  const derivedHeaderTitle =
    meeting.type === "pm_review"
      ? meeting.attendees
          .filter((a) => a.member)
          .map((a) => a.member!.name)
          .join(", ") || "Reunião com PMs"
      : meeting.type === "daily"
        ? "Daily"
        : meeting.type === "super_planning"
          ? "Super Planning"
          : meeting.type === "private"
            ? "Reunião privada"
            : "Reunião geral";
  const headerTitle = meeting.title || derivedHeaderTitle;

  // "Conteúdo" = qualquer dado que o Alpha possa sobrescrever ao ingerir.
  // Notes/reviews preenchidos e To-dos contam; sprintHealth default ("healthy"
  // sem outros campos) NÃO conta — é o estado zerado de pm_review.
  const meetingHasContent =
    !!(meeting.notes && meeting.notes.trim()) ||
    meeting.actionItems.length > 0 ||
    meeting.projectReviews.some(
      (r) =>
        (r.nextSteps && r.nextSteps.trim()) ||
        (r.attentionPoints && r.attentionPoints.trim()) ||
        (r.additionalNotes && r.additionalNotes.trim()) ||
        r.sprintHealth !== "healthy",
    );

  const handleImportClick = () => {
    if (!meetingHasContent) {
      setImportOpen(true);
      return;
    }
    setConfirmState({
      title: "Sobrescrever conteúdo da reunião?",
      description:
        "Essa reunião já tem conteúdo (notas, reviews ou To-dos). A ingestão pelo Alpha pode sobrescrever ou duplicar esses dados. Deseja prosseguir?",
      confirmLabel: "Prosseguir",
      destructive: true,
      onConfirm: () => setImportOpen(true),
    });
  };

  const handleSuggest = async () => {
    if (suggesting) return;
    setSuggesting(true);
    try {
      const res = await fetchOrThrow(`/api/meetings/${id}/suggest-actions`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        counts: {
          tasksProposed: number;
          todosCreated: number;
          skipped: number;
          unresolvedTasks: number;
          unresolvedTodos: number;
        };
      };
      const { counts } = data;
      const summary: string[] = [];
      summary.push(`${counts.tasksProposed} Task${counts.tasksProposed === 1 ? "" : "s"} proposta${counts.tasksProposed === 1 ? "" : "s"}`);
      summary.push(`${counts.todosCreated} To-do${counts.todosCreated === 1 ? "" : "s"} criada${counts.todosCreated === 1 ? "" : "s"}`);
      if (counts.skipped > 0) summary.push(`${counts.skipped} descartada${counts.skipped === 1 ? "" : "s"}`);
      if (counts.unresolvedTasks + counts.unresolvedTodos > 0) {
        summary.push(
          `${counts.unresolvedTasks + counts.unresolvedTodos} sem resolver`,
        );
      }
      toast.success(summary.join(" · "), { id: "suggest-actions" });
      await load();
    } catch (e) {
      showErrorToast(e, { label: "Sugerir com IA" });
    } finally {
      setSuggesting(false);
    }
  };

  const canSuggest =
    !!(meeting.transcript && meeting.transcript.trim()) ||
    !!(meeting.transcriptSource && meeting.transcriptSourceId) ||
    !!(meeting.notes && meeting.notes.trim());

  return (
    <div className="space-y-6">
      <PageTitle title={headerTitle} subtitle={fmtDate(meeting.date)} />
      {/* Header */}
      <div className="flex items-center gap-3 min-w-0">
        <Link href="/meetings">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold truncate">{headerTitle}</h1>
            <StatusChip
              tone={lookupChip(MEETING_TYPE, meeting.type).tone}
              label={MEETING_TYPE_LONG_LABELS[meeting.type] ?? meeting.type}
            />
            <StatusChip
              {...lookupChip(MEETING_STATUS, meetingStatusFromDate(meeting.date))}
              dot
            />
          </div>
          {(meeting.type === "general" || meeting.type === "private") && (
            <div className="text-sm text-muted-foreground mt-1">{fmtDate(meeting.date)}</div>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleImportClick}
              title={
                meeting.type === "private"
                  ? "Ingerir transcrição do Granola nesta reunião privada"
                  : "Ingerir uma transcrição do Roam ou Granola nesta reunião"
              }
            >
              <Download className="h-4 w-4 mr-1" />
              {meeting.type === "private" ? "Importar do Granola" : "Importar reunião"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSuggest}
              disabled={suggesting || !canSuggest}
              title={
                canSuggest
                  ? "Analisa transcrição/notas e cria Tasks (Plano de Tasks) e To-dos automaticamente"
                  : "Importe uma transcrição ou escreva notas antes de sugerir"
              }
            >
              {suggesting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  Analisando…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-1" />
                  Sugerir com IA
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Minhas notas — private to the acting member, no admin bypass.
          Skipped on private meetings because the whole meeting is already
          the owner's private workspace, so a "private inside private" card
          would be redundant. */}
      {meeting.type !== "private" && <PersonalNoteCard meetingId={meeting.id} />}

      {/* Attendees + project links (general/daily/super_planning) */}
      {(meeting.type === "general" || meeting.type === "daily" || meeting.type === "super_planning") && (
        <div className="surface p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Participantes
            </h2>
            <div className="flex flex-wrap gap-2">
              {meeting.attendees.length === 0 && (
                <span className="text-sm text-muted-foreground">Nenhum participante.</span>
              )}
              {meeting.attendees.map((a) => (
                <Badge key={a.id} variant="outline" className="text-xs">
                  {a.member?.name ?? a.externalName}
                  {a.externalRole && (
                    <span className="ml-1 text-muted-foreground">({a.externalRole})</span>
                  )}
                  {!a.member && (
                    <span className="ml-1 text-xs text-muted-foreground">externo</span>
                  )}
                </Badge>
              ))}
            </div>
          </div>

          {meeting.projectLinks.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Projetos vinculados
              </h2>
              <div className="flex flex-wrap gap-2">
                {meeting.projectLinks.map((l) =>
                  l.project ? (
                    <Link
                      key={l.projectId}
                      href={`/projects/${l.project.id}`}
                      className="px-2 py-0.5 rounded-md bg-muted hover:bg-accent text-xs"
                    >
                      {l.project.name}
                    </Link>
                  ) : null
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Private: só projetos vinculados (escopo do Plano de Tasks). Sem
          participantes — owner é implícito. */}
      {meeting.type === "private" && meeting.projectLinks.length > 0 && (
        <div className="surface p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Projetos vinculados
          </h2>
          <div className="flex flex-wrap gap-2">
            {meeting.projectLinks.map((l) =>
              l.project ? (
                <Link
                  key={l.projectId}
                  href={`/projects/${l.project.id}`}
                  className="px-2 py-0.5 rounded-md bg-muted hover:bg-accent text-xs"
                >
                  {l.project.name}
                </Link>
              ) : null,
            )}
          </div>
        </div>
      )}

      {/* Project Reviews — only for pm_review */}
      {meeting.type === "pm_review" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Revisão por projeto</h2>
            {allPmIds.length > 0 && (
              <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs text-muted-foreground">
                <ChevronsUpDown className="mr-1 h-3.5 w-3.5" />
                {allCollapsed ? "Expandir todos" : "Colapsar todos"}
              </Button>
            )}
          </div>

          {Object.entries(reviewsByPm).map(([pmId, reviews]) => {
            const pmName = reviews[0].member.name;
            const pmCollapsed = collapsedPms.has(pmId);
            return (
              <div key={pmId} className="surface p-4 space-y-4">
                <button
                  onClick={() => togglePm(pmId)}
                  className="flex items-center gap-2 w-full text-left group py-2 sm:py-0"
                >
                  {pmCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide group-hover:text-foreground transition-colors">
                    {pmName} (PM)
                  </h3>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {reviews.length} {reviews.length === 1 ? "projeto" : "projetos"}
                  </span>
                </button>

                {!pmCollapsed && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {reviews.map((review) => (
                      <ReviewCard
                        key={review.id}
                        review={review}
                        collapsed={!expandedProjects.has(review.id)}
                        onToggle={() => toggleProject(review.id)}
                        onUpdate={
                          canEdit
                            ? (data) => updateReview(review.id, data)
                            : () => Promise.resolve()
                        }
                        readOnly={!canEdit}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {meeting.projectReviews.length === 0 && (
            <div className="surface p-8 text-center text-muted-foreground">
              Nenhum projeto vinculado. Verifique se os PMs selecionados têm projetos ativos.
            </div>
          )}
        </div>
      )}

      {/* Task Action widgets — 1 por projeto vinculado em daily/super_planning/private */}
      {(meeting.type === "daily" ||
        meeting.type === "super_planning" ||
        meeting.type === "private") &&
        meeting.projectLinks.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Plano de Tasks</h2>
            {meeting.type === "private" && (
              <p className="text-xs text-muted-foreground -mt-2">
                Alpha propõe Tasks aqui a partir da transcrição. Aprove ou rejeite
                cada uma — só você vê esse plano.
              </p>
            )}
            {meeting.projectLinks.map((l) =>
              l.project ? (
                <TaskActionWidget
                  key={l.projectId}
                  meetingId={meeting.id}
                  project={{ id: l.project.id, name: l.project.name }}
                />
              ) : null
            )}
          </div>
        )}

      {/* AI Suggestions — só ToDos source='ai' com decision='pending' */}
      {(() => {
        const pending = meeting.actionItems.filter((a) => a.decision === "pending");
        const visible = meeting.actionItems.filter((a) => a.decision !== "pending");
        return (
          <>
            {pending.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-500" />
                  <h2 className="text-lg font-semibold">Sugestões da IA</h2>
                  <span className="text-xs text-muted-foreground">
                    ({pending.length} pendente{pending.length === 1 ? "" : "s"})
                  </span>
                </div>
                <div className="surface divide-y">
                  {pending.map((action) => (
                    <ActionItemRow
                      key={action.id}
                      action={action}
                      canEdit={canEdit}
                      pending
                      fmtShortDate={fmtShortDate}
                      onOpen={openEditTodo}
                      onCycleStatus={cycleActionStatus}
                      onApprove={() => decideAction(action, "approved")}
                      onReject={() => decideAction(action, "rejected")}
                      onDelete={() => deleteAction(action)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* To-dos — só aprovados (default 'approved' p/ legacy + manuais) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">To-dos</h2>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={openCreateTodo}>
                    <Plus className="mr-1 h-4 w-4" />
                    Nova To-do
                  </Button>
                )}
              </div>

              <div className="surface divide-y">
                {visible.length === 0 && (
                  <div className="p-6 text-center text-muted-foreground text-sm">
                    Nenhuma To-do registrada.
                  </div>
                )}
                {visible.map((action) => (
                  <ActionItemRow
                    key={action.id}
                    action={action}
                    canEdit={canEdit}
                    pending={false}
                    fmtShortDate={fmtShortDate}
                    onOpen={openEditTodo}
                    onCycleStatus={cycleActionStatus}
                    onApprove={() => decideAction(action, "approved")}
                    onReject={() => decideAction(action, "rejected")}
                    onDelete={() => deleteAction(action)}
                  />
                ))}
              </div>
            </div>
          </>
        );
      })()}

      {/* General Notes */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Notas gerais</h2>
          {canEdit &&
            (editingNotes ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingNotes(false);
                  saveNotes();
                }}
              >
                Concluir
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setEditingNotes(true)}>
                Editar
              </Button>
            ))}
        </div>
        {canEdit && editingNotes ? (
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            rows={12}
            autoFocus
            placeholder="Anotações gerais da reunião... (suporta markdown: ## título, **negrito**, - listas)"
          />
        ) : notes.trim() ? (
          <div className="surface p-4 text-sm">
            <Markdown>{notes}</Markdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sem notas gerais.</p>
        )}
      </div>

      {/* Transcript bruto (read-only, collapsible) — exibido quando existe. */}
      {meeting.transcript && (
        <details className="space-y-2">
          <summary className="cursor-pointer text-sm font-semibold text-muted-foreground hover:text-foreground select-none">
            Transcript bruto
            {meeting.transcriptSource && (
              <span className="ml-2 text-xs font-normal">
                ({meeting.transcriptSource === "granola" ? "Granola" : "Roam"})
              </span>
            )}
          </summary>
          <div className="surface p-4 mt-2 whitespace-pre-wrap text-xs text-muted-foreground max-h-96 overflow-y-auto">
            {meeting.transcript}
          </div>
        </details>
      )}

      <TodoSheet
        todo={editingTodo}
        open={todoSheetOpen}
        onOpenChange={(v) => {
          setTodoSheetOpen(v);
          if (!v) load();
        }}
        onChange={() => load()}
        endpoint={{
          create: `/api/meetings/${id}/actions`,
          itemUrl: (todoId) => `/api/meetings/${id}/actions/${todoId}`,
          updateMethod: "PUT",
        }}
        members={members}
        projectReviews={
          meeting.type === "pm_review"
            ? meeting.projectReviews.map((r) => ({
                id: r.id,
                projectName: r.project.name,
                pmName: r.member.name,
              }))
            : undefined
        }
      />

      <ImportMeetingModal
        open={importOpen}
        onOpenChange={setImportOpen}
        mode="existing"
        meetingId={meeting.id}
        visibility={meeting.type === "private" ? "private" : "public"}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

// ─── Review Card Component ──────────────────────────────

function ReviewCard({
  review,
  collapsed,
  onToggle,
  onUpdate,
  readOnly = false,
}: {
  review: ProjectReview;
  collapsed: boolean;
  onToggle: () => void;
  onUpdate: (data: Partial<ProjectReview>) => void;
  readOnly?: boolean;
}) {
  const [nextSteps, setNextSteps] = useState(review.nextSteps || "");
  const [sprintHealth, setSprintHealth] = useState(review.sprintHealth);
  const [attentionPoints, setAttentionPoints] = useState(review.attentionPoints || "");
  const [additionalNotes, setAdditionalNotes] = useState(review.additionalNotes || "");

  const save = (overrides?: Partial<ProjectReview>) => {
    if (readOnly) return;
    onUpdate({
      nextSteps,
      sprintHealth,
      attentionPoints,
      additionalNotes,
      ...overrides,
    });
  };

  return (
    <div className="surface-inset p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onToggle} className="text-muted-foreground hover:text-foreground transition-colors">
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            onClick={onToggle}
            className="font-medium text-left hover:text-muted-foreground transition-colors"
          >
            {review.project.name}
          </button>
          <Link
            href={`/projects/${review.projectId}`}
            aria-label="Abrir projeto"
            title="Abrir projeto"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <Badge variant="outline" className="text-xs">
            {review.project.status}
          </Badge>
        </div>
        {readOnly ? (
          <StatusChip {...lookupChip(HEALTH, sprintHealth)} />
        ) : (
          <StatusChipSelect
            value={sprintHealth}
            options={HEALTH}
            onValueChange={(v) => {
              setSprintHealth(v);
              save({ sprintHealth: v });
            }}
          />
        )}
      </div>

      {!collapsed && (
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Próximos passos</Label>
            <Textarea
              value={nextSteps}
              onChange={(e) => setNextSteps(e.target.value)}
              onBlur={() => save()}
              rows={2}
              disabled={readOnly}
              placeholder={readOnly ? "" : "Quais são os próximos passos do projeto..."}
            />
          </div>

          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Pontos de atenção</Label>
            <Textarea
              value={attentionPoints}
              onChange={(e) => setAttentionPoints(e.target.value)}
              onBlur={() => save()}
              rows={2}
              disabled={readOnly}
              placeholder={readOnly ? "" : "Riscos, bloqueios, preocupações..."}
            />
          </div>

          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">OBS</Label>
            <Textarea
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              onBlur={() => save()}
              rows={2}
              disabled={readOnly}
              placeholder={readOnly ? "" : "Observações adicionais..."}
            />
          </div>
        </div>
      )}

    </div>
  );
}

// ─── ActionItemRow ──────────────────────────────────────────
// Linha única de To-do. Renderizada em 2 contextos: Sugestões da IA (pending)
// e lista normal (approved). O menu de 3 pontinhos muda conforme decision.

function ActionItemRow({
  action,
  canEdit,
  pending,
  fmtShortDate,
  onOpen,
  onCycleStatus,
  onApprove,
  onReject,
  onDelete,
}: {
  action: ActionItem;
  canEdit: boolean;
  pending: boolean;
  fmtShortDate: (d: string) => string;
  onOpen: (a: ActionItem) => void;
  onCycleStatus: (a: ActionItem) => void;
  onApprove: () => void;
  onReject: () => void;
  onDelete: () => void;
}) {
  const overdue = isOverdue(action.dueDate, action.status);
  const isAi = action.source === "ai";

  return (
    <div
      role={canEdit ? "button" : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onClick={canEdit ? () => onOpen(action) : undefined}
      onKeyDown={
        canEdit
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(action);
              }
            }
          : undefined
      }
      className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 transition-colors ${
        canEdit ? "cursor-pointer hover:bg-muted/40" : ""
      }`}
    >
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <StatusCycleIcon
          status={action.status}
          canEdit={canEdit}
          disabled={pending}
          onCycle={() => onCycleStatus(action)}
          className="mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <p
            className={`text-sm ${
              action.status === "done" ? "line-through text-muted-foreground" : ""
            }`}
          >
            {action.description}
          </p>
          {action.sourceReview?.project && (
            <span className="text-xs text-muted-foreground">
              Projeto: {action.sourceReview.project.name}
            </span>
          )}
          {pending && action.notes && (
            <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">
              {action.notes}
            </p>
          )}
        </div>
      </div>

      <div
        className="flex items-center gap-2 flex-wrap pl-8 sm:pl-0 sm:shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {isAi && (
          <StatusChip tone="purple" label="IA" />
        )}
        <Badge variant="outline" className="text-xs">
          {action.assignee.name}
        </Badge>
        {action.dueDate && (
          <span
            className={`text-xs ${
              overdue ? "text-red-500 font-medium" : "text-muted-foreground"
            }`}
          >
            {overdue && "⚠ "}
            {fmtShortDate(action.dueDate)}
          </span>
        )}
        {!pending && (
          <StatusCycleChip
            status={action.status}
            canEdit={canEdit}
            onCycle={() => onCycleStatus(action)}
          />
        )}
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  aria-label="Mais ações"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-44">
              {pending && (
                <>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onApprove();
                    }}
                  >
                    <Check className="mr-2 size-3.5 text-green-700" />
                    Aprovar
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      onReject();
                    }}
                  >
                    <X className="mr-2 size-3.5 text-red-700" />
                    Rejeitar
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="mr-2 size-3.5" />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
