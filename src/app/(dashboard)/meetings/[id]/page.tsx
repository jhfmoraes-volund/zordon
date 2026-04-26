"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
  ResponsiveDialogBody,
} from "@/components/ui/responsive-dialog";
import {
  ArrowLeft, Plus, Trash2, CheckCircle2, Circle, Clock,
  ChevronDown, ChevronRight, ChevronsUpDown,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────

type Member = { id: string; name: string };

type ActionItem = {
  id: string;
  description: string;
  assigneeId: string;
  assignee: Member;
  dueDate: string | null;
  status: string;
  sourceReviewId: string | null;
  sourceReview?: { project: { name: string } } | null;
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
  status: string;
  notes: string | null;
  type: "pm_review" | "general";
  title: string | null;
  projectReviews: ProjectReview[];
  actionItems: ActionItem[];
  attendees: Attendee[];
  projectLinks: ProjectLink[];
};

// ─── Constants ────────────────────────────────────────────

const statusColors: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  done: "bg-green-100 text-green-800",
};

const statusLabels: Record<string, string> = {
  scheduled: "Agendada",
  in_progress: "Em andamento",
  done: "Concluída",
};

const typeLabels: Record<string, string> = {
  pm_review: "Reunião com PMs",
  general: "Reunião geral",
};

const typeColors: Record<string, string> = {
  pm_review: "bg-purple-100 text-purple-800",
  general: "bg-slate-100 text-slate-800",
};

const healthConfig: Record<string, { label: string; color: string; bg: string }> = {
  healthy: { label: "Saudável", color: "text-green-600", bg: "bg-green-100 text-green-800" },
  attention: { label: "Atenção", color: "text-yellow-600", bg: "bg-yellow-100 text-yellow-800" },
  critical: { label: "Crítico", color: "text-red-600", bg: "bg-red-100 text-red-800" },
};

const actionStatusConfig: Record<string, { label: string; icon: typeof Circle; color: string }> = {
  todo: { label: "TODO", icon: Circle, color: "text-red-500" },
  doing: { label: "DOING", icon: Clock, color: "text-yellow-500" },
  done: { label: "DONE", icon: CheckCircle2, color: "text-green-500" },
};

const actionStatusCycle: Record<string, string> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

// ─── Main Page ────────────────────────────────────────────

export default function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [notes, setNotes] = useState("");
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionForm, setActionForm] = useState({
    description: "",
    assigneeId: "",
    dueDate: "",
    sourceReviewId: "",
  });
  const [collapsedPms, setCollapsedPms] = useState<Set<string>>(new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());

  const load = () => {
    fetch(`/api/meetings/${id}`).then((r) => r.json()).then((data) => {
      setMeeting(data);
      setNotes(data.notes || "");
    });
  };

  useEffect(() => {
    load();
    fetch("/api/members").then((r) => r.json()).then(setMembers);
  }, [id]);

  if (!meeting) {
    return <div className="p-6 text-muted-foreground">Carregando...</div>;
  }

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

  const fmtShortDate = (d: string) =>
    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

  // ─── Handlers ─────────────────────────────────────────

  const updateStatus = async (status: string) => {
    await fetch(`/api/meetings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, notes }),
    });
    load();
  };

  const saveNotes = async () => {
    await fetch(`/api/meetings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: meeting.status, notes }),
    });
  };

  const updateReview = async (reviewId: string, data: Partial<ProjectReview>) => {
    await fetch(`/api/meetings/${id}/reviews/${reviewId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  };

  const cycleActionStatus = async (action: ActionItem) => {
    const nextStatus = actionStatusCycle[action.status];
    await fetch(`/api/meetings/${id}/actions/${action.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    load();
  };

  const deleteAction = async (actionId: string) => {
    await fetch(`/api/meetings/${id}/actions/${actionId}`, { method: "DELETE" });
    load();
  };

  const createAction = async () => {
    await fetch(`/api/meetings/${id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: actionForm.description,
        assigneeId: actionForm.assigneeId,
        dueDate: actionForm.dueDate || null,
        sourceReviewId: actionForm.sourceReviewId || null,
      }),
    });
    setActionDialogOpen(false);
    setActionForm({ description: "", assigneeId: "", dueDate: "", sourceReviewId: "" });
    load();
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
    setCollapsedProjects((prev) => {
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
      setCollapsedProjects(new Set());
    } else {
      setCollapsedPms(new Set(allPmIds));
    }
  };

  const isOverdue = (d: string | null) => {
    if (!d) return false;
    return new Date(d) < new Date();
  };

  const headerTitle =
    meeting.type === "general"
      ? meeting.title || "Reunião geral"
      : `Reunião com PMs — ${fmtDate(meeting.date)}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/meetings">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold truncate">{headerTitle}</h1>
              <Badge variant="secondary" className={typeColors[meeting.type]}>
                {typeLabels[meeting.type]}
              </Badge>
              <Badge className={statusColors[meeting.status]}>
                {statusLabels[meeting.status]}
              </Badge>
            </div>
            {meeting.type === "general" && (
              <div className="text-sm text-muted-foreground mt-1">{fmtDate(meeting.date)}</div>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {meeting.status === "scheduled" && (
            <Button size="sm" onClick={() => updateStatus("in_progress")}>
              Iniciar reunião
            </Button>
          )}
          {meeting.status === "in_progress" && (
            <Button size="sm" onClick={() => updateStatus("done")}>
              Concluir reunião
            </Button>
          )}
          {meeting.status === "done" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => updateStatus("in_progress")}
            >
              Reabrir
            </Button>
          )}
        </div>
      </div>

      {/* Attendees + project links (general meetings show this prominently) */}
      {meeting.type === "general" && (
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
                        collapsed={collapsedProjects.has(review.id)}
                        onToggle={() => toggleProject(review.id)}
                        onUpdate={(data) => updateReview(review.id, data)}
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

      {/* Action Items */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Pontos de ação</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setActionDialogOpen(true)}
          >
            <Plus className="mr-1 h-4 w-4" />
            Nova ação
          </Button>
        </div>

        <div className="surface divide-y">
          {meeting.actionItems.length === 0 && (
            <div className="p-6 text-center text-muted-foreground text-sm">
              Nenhuma ação registrada.
            </div>
          )}
          {meeting.actionItems.map((action) => {
            const cfg = actionStatusConfig[action.status];
            const Icon = cfg.icon;
            const overdue = action.status !== "done" && isOverdue(action.dueDate);
            return (
              <div
                key={action.id}
                className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3"
              >
                {/* Linha 1 mobile / bloco principal desktop */}
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <button
                    onClick={() => cycleActionStatus(action)}
                    className={`shrink-0 mt-0.5 ${cfg.color} hover:opacity-70 transition-opacity`}
                    title={`Clique para mudar: ${cfg.label}`}
                  >
                    <Icon className="h-5 w-5" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm ${
                        action.status === "done"
                          ? "line-through text-muted-foreground"
                          : ""
                      }`}
                    >
                      {action.description}
                    </p>
                    {action.sourceReview?.project && (
                      <span className="text-xs text-muted-foreground">
                        Projeto: {action.sourceReview.project.name}
                      </span>
                    )}
                  </div>
                </div>

                {/* Linha 2 mobile / bloco direito desktop */}
                <div className="flex items-center gap-2 flex-wrap pl-8 sm:pl-0 sm:shrink-0">
                  <Badge variant="outline" className="text-xs">
                    {action.assignee.name}
                  </Badge>
                  {action.dueDate && (
                    <span
                      className={`text-xs ${
                        overdue
                          ? "text-red-500 font-medium"
                          : "text-muted-foreground"
                      }`}
                    >
                      {overdue && "⚠ "}
                      {fmtShortDate(action.dueDate)}
                    </span>
                  )}
                  <Badge
                    variant="secondary"
                    className={`text-xs cursor-pointer ${
                      action.status === "todo"
                        ? "bg-red-100 text-red-700"
                        : action.status === "doing"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-green-100 text-green-700"
                    }`}
                    onClick={() => cycleActionStatus(action)}
                  >
                    {cfg.label}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => deleteAction(action.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* General Notes */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Notas gerais</h2>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          rows={4}
          placeholder="Anotações gerais da reunião..."
        />
      </div>

      {/* New Action Dialog */}
      <ResponsiveDialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Nova ação</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Descrição</Label>
              <Input
                value={actionForm.description}
                onChange={(e) =>
                  setActionForm({ ...actionForm, description: e.target.value })
                }
                placeholder="O que precisa ser feito..."
              />
            </div>
            <div className="grid gap-2">
              <Label>Responsável</Label>
              <Select
                value={actionForm.assigneeId}
                onValueChange={(v) =>
                  v && setActionForm({ ...actionForm, assigneeId: v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Prazo (opcional)</Label>
              <Input
                type="date"
                value={actionForm.dueDate}
                onChange={(e) =>
                  setActionForm({ ...actionForm, dueDate: e.target.value })
                }
              />
            </div>
            {meeting.type === "pm_review" && (
              <div className="grid gap-2">
                <Label>Vinculado ao projeto (opcional)</Label>
                <Select
                  value={actionForm.sourceReviewId}
                  onValueChange={(v) =>
                    v && setActionForm({ ...actionForm, sourceReviewId: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Nenhum" />
                  </SelectTrigger>
                  <SelectContent>
                    {meeting.projectReviews.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.project.name} ({r.member.name})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setActionDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={createAction}
              disabled={!actionForm.description || !actionForm.assigneeId}
            >
              Criar
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

    </div>
  );
}

// ─── Review Card Component ──────────────────────────────

function ReviewCard({
  review,
  collapsed,
  onToggle,
  onUpdate,
}: {
  review: ProjectReview;
  collapsed: boolean;
  onToggle: () => void;
  onUpdate: (data: Partial<ProjectReview>) => void;
}) {
  const [nextSteps, setNextSteps] = useState(review.nextSteps || "");
  const [sprintHealth, setSprintHealth] = useState(review.sprintHealth);
  const [attentionPoints, setAttentionPoints] = useState(review.attentionPoints || "");
  const [additionalNotes, setAdditionalNotes] = useState(review.additionalNotes || "");

  const save = (overrides?: Partial<ProjectReview>) => {
    onUpdate({
      nextSteps,
      sprintHealth,
      attentionPoints,
      additionalNotes,
      ...overrides,
    });
  };

  const hCfg = healthConfig[sprintHealth];

  return (
    <div className="surface-inset p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onToggle} className="text-muted-foreground hover:text-foreground transition-colors">
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <Link
            href={`/projects/${review.projectId}`}
            className="font-medium hover:underline"
          >
            {review.project.name}
          </Link>
          <Badge variant="outline" className="text-xs">
            {review.project.status}
          </Badge>
        </div>
        <Select
          value={sprintHealth}
          onValueChange={(v) => {
            if (!v) return;
            setSprintHealth(v);
            save({ sprintHealth: v });
          }}
        >
          <SelectTrigger className="w-[160px] h-8">
            <SelectValue>
              <span className={hCfg.color}>
                {hCfg.label}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(healthConfig).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>
                <span className={cfg.color}>{cfg.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
              placeholder="Quais são os próximos passos do projeto..."
            />
          </div>

          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Pontos de atenção</Label>
            <Textarea
              value={attentionPoints}
              onChange={(e) => setAttentionPoints(e.target.value)}
              onBlur={() => save()}
              rows={2}
              placeholder="Riscos, bloqueios, preocupações..."
            />
          </div>

          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">OBS</Label>
            <Textarea
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              onBlur={() => save()}
              rows={2}
              placeholder="Observações adicionais..."
            />
          </div>
        </div>
      )}

    </div>
  );
}
