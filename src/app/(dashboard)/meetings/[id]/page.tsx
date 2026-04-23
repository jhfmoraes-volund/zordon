"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Plus, Trash2, CheckCircle2, Circle, Clock,
  ChevronDown, ChevronRight, ChevronsUpDown,
} from "lucide-react";
import { ZordonChat } from "@/components/zordon-chat";

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

type Meeting = {
  id: string;
  date: string;
  status: string;
  notes: string | null;
  projectReviews: ProjectReview[];
  actionItems: ActionItem[];
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
  const router = useRouter();
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

  // Group reviews by PM
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
    return new Date(d) < new Date() ;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link href="/meetings">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">
                Weekly PM — {fmtDate(meeting.date)}
              </h1>
              <Badge className={statusColors[meeting.status]}>
                {statusLabels[meeting.status]}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {meeting.status === "scheduled" && (
            <Button size="sm" onClick={() => updateStatus("in_progress")}>
              Iniciar Reunião
            </Button>
          )}
          {meeting.status === "in_progress" && (
            <Button size="sm" onClick={() => updateStatus("done")}>
              Concluir Reunião
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

      {/* Project Reviews */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Revisão por Projeto</h2>
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
                className="flex items-center gap-2 w-full text-left group"
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
            Nenhum projeto vinculado. Certifique-se de que os PMs têm projetos ativos atribuídos.
          </div>
        )}
      </div>

      {/* Action Items */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Ações</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setActionDialogOpen(true)}
          >
            <Plus className="mr-1 h-4 w-4" />
            Nova Ação
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
                className="flex items-center gap-3 px-4 py-3"
              >
                <button
                  onClick={() => cycleActionStatus(action)}
                  className={`shrink-0 ${cfg.color} hover:opacity-70 transition-opacity`}
                  title={`Clique para mudar: ${cfg.label}`}
                >
                  <Icon className="h-5 w-5" />
                </button>

                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${action.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                    {action.description}
                  </p>
                  {action.sourceReview?.project && (
                    <span className="text-xs text-muted-foreground">
                      Projeto: {action.sourceReview.project.name}
                    </span>
                  )}
                </div>

                <Badge variant="outline" className="text-xs shrink-0">
                  {action.assignee.name}
                </Badge>

                {action.dueDate && (
                  <span
                    className={`text-xs shrink-0 ${overdue ? "text-red-500 font-medium" : "text-muted-foreground"}`}
                  >
                    {overdue && "⚠ "}
                    {fmtShortDate(action.dueDate)}
                  </span>
                )}

                <Badge
                  variant="secondary"
                  className={`text-xs shrink-0 cursor-pointer ${
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
                  className="h-7 w-7 shrink-0"
                  onClick={() => deleteAction(action.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* General Notes */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Notas Gerais</h2>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          rows={4}
          placeholder="Anotações gerais da reunião..."
        />
      </div>

      {/* New Action Dialog */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Ação</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
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
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setActionDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={createAction}
              disabled={!actionForm.description || !actionForm.assigneeId}
            >
              Criar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {meeting && (
        <ZordonChat
          contextLabel={`Reunião ${meeting.date}`}
          contextParams={{ meetingId: id }}
        />
      )}
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
            <Label className="text-xs text-muted-foreground">Próximos Passos</Label>
            <Textarea
              value={nextSteps}
              onChange={(e) => setNextSteps(e.target.value)}
              onBlur={() => save()}
              rows={2}
              placeholder="Quais são os próximos passos do projeto..."
            />
          </div>

          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Pontos de Atenção</Label>
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
