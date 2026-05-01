"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Sparkles, Plus, ChevronDown, ChevronRight, Loader2, AlertCircle,
  CheckCircle2, XCircle, Clock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { MeetingTaskActionSheet, type MeetingTaskAction } from "./meeting-task-action-sheet";
import { toast } from "sonner";
import { showErrorToast } from "@/lib/optimistic/toast";

type Project = { id: string; name: string };
type Sprint = { id: string; name: string; status: string };
type Task = { id: string; reference: string | null; title: string; status: string };

type ActionType = "create" | "update" | "delete" | "move" | "review";

const ACTION_LABELS: Record<ActionType, string> = {
  create: "Criar",
  update: "Atualizar",
  delete: "Remover da sprint",
  move: "Mover sprint",
  review: "Revisar",
};

const ACTION_COLORS: Record<ActionType, string> = {
  create: "bg-green-100 text-green-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-red-100 text-red-700",
  move: "bg-purple-100 text-purple-700",
  review: "bg-amber-100 text-amber-700",
};

export type TaskActionWidgetProps = {
  meetingId: string;
  project: Project;
};

export function TaskActionWidget({ meetingId, project }: TaskActionWidgetProps) {
  const [actions, setActions] = useState<MeetingTaskAction[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [applying, setApplying] = useState(false);

  const [openSections, setOpenSections] = useState({
    pending: true,
    approved: true,
    rejected: false,
  });

  const [activeAction, setActiveAction] = useState<MeetingTaskAction | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [aRes, sRes] = await Promise.all([
      fetch(`/api/meetings/${meetingId}/task-actions`).then((r) => r.json()),
      supabase
        .from("Sprint")
        .select("id, name, status")
        .eq("projectId", project.id)
        .eq("status", "active")
        .maybeSingle(),
    ]);

    const projectActions = (aRes ?? []).filter(
      (a: MeetingTaskAction & { projectId: string }) => a.projectId === project.id
    );
    setActions(projectActions);

    const activeSprint = sRes.data ?? null;
    setSprint(activeSprint as Sprint | null);

    if (activeSprint) {
      const { data: tk } = await supabase
        .from("Task")
        .select("id, reference, title, status")
        .eq("projectId", project.id)
        .eq("sprintId", activeSprint.id)
        .order("priority", { ascending: false });
      setTasks((tk ?? []) as Task[]);
    } else {
      const { data: backlog } = await supabase
        .from("Task")
        .select("id, reference, title, status")
        .eq("projectId", project.id)
        .eq("status", "backlog")
        .order("priority", { ascending: false })
        .limit(20);
      setTasks((backlog ?? []) as Task[]);
    }
    setLoading(false);
  }, [meetingId, project.id]);

  useEffect(() => {
    load();
  }, [load]);

  const suggest = async () => {
    setSuggesting(true);
    try {
      const res = await fetch(
        `/api/meetings/${meetingId}/task-actions/suggest`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "erro");
      await load();
      if (data.inserted === 0) {
        showErrorToast(
          new Error("IA não retornou sugestões com confiança suficiente."),
          { label: "Sugestões" },
        );
      }
    } catch (e) {
      console.error("suggest failed:", e);
      showErrorToast(e, { label: "Falha ao gerar sugestões" });
    } finally {
      setSuggesting(false);
    }
  };

  const apply = async () => {
    if (!confirm("Aplicar todas as ações aprovadas? Isso vai modificar tasks no projeto.")) return;
    setApplying(true);
    try {
      const res = await fetch(
        `/api/meetings/${meetingId}/task-actions/apply`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "erro");
      const msg = `Aplicado: ${data.applied} | Falhas: ${data.failed} | Pulado: ${data.skipped}`;
      toast.success(msg);
      await load();
    } catch (e) {
      console.error("apply failed:", e);
      showErrorToast(e, { label: "Falha ao aplicar" });
    } finally {
      setApplying(false);
    }
  };

  const pending = actions.filter((a) => a.decision === "pending");
  const approved = actions.filter((a) => a.decision === "approved");
  const rejected = actions.filter((a) => a.decision === "rejected");
  const approvedToApply = approved.filter((a) => a.execution === "pending").length;

  return (
    <div className="surface p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold">{project.name}</h3>
          <p className="text-xs text-muted-foreground">
            {sprint
              ? `Sprint ${sprint.name} (${sprint.status}) · ${tasks.length} tasks`
              : "Sem sprint ativa — mostrando backlog"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={suggest} disabled={suggesting}>
            {suggesting ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-3.5 w-3.5" />
            )}
            Sugerir com IA
          </Button>
          <Button variant="outline" size="sm" onClick={() => setNewDialogOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Nova ação
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Carregando...</div>
      ) : actions.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          Nenhuma ação proposta ainda. Use <strong>Sugerir com IA</strong> ou crie manualmente.
        </div>
      ) : (
        <div className="space-y-3">
          <Section
            title="Pendentes"
            icon={<Clock className="h-3.5 w-3.5 text-amber-600" />}
            count={pending.length}
            open={openSections.pending}
            onToggle={() => setOpenSections((s) => ({ ...s, pending: !s.pending }))}
          >
            {pending.map((a) => (
              <ActionRow
                key={a.id}
                action={a}
                onOpen={() => setActiveAction(a)}
                onChange={load}
                meetingId={meetingId}
              />
            ))}
          </Section>

          <Section
            title="Aprovadas"
            icon={<CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
            count={approved.length}
            open={openSections.approved}
            onToggle={() => setOpenSections((s) => ({ ...s, approved: !s.approved }))}
          >
            {approved.map((a) => (
              <ActionRow
                key={a.id}
                action={a}
                onOpen={() => setActiveAction(a)}
                onChange={load}
                meetingId={meetingId}
              />
            ))}
          </Section>

          <Section
            title="Rejeitadas"
            icon={<XCircle className="h-3.5 w-3.5 text-muted-foreground" />}
            count={rejected.length}
            open={openSections.rejected}
            onToggle={() => setOpenSections((s) => ({ ...s, rejected: !s.rejected }))}
          >
            {rejected.map((a) => (
              <ActionRow
                key={a.id}
                action={a}
                onOpen={() => setActiveAction(a)}
                onChange={load}
                meetingId={meetingId}
              />
            ))}
          </Section>
        </div>
      )}

      {approvedToApply > 0 && (
        <div className="border-t pt-3 flex items-center gap-2 justify-between">
          <span className="text-xs text-muted-foreground">
            {approvedToApply} aprovada{approvedToApply > 1 ? "s" : ""} aguardando aplicação
          </span>
          <Button onClick={apply} disabled={applying}>
            {applying && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Aplicar plano ({approvedToApply})
          </Button>
        </div>
      )}

      {activeAction && (
        <MeetingTaskActionSheet
          open={!!activeAction}
          onOpenChange={(o) => !o && setActiveAction(null)}
          meetingId={meetingId}
          action={activeAction}
          projectId={project.id}
          onChange={load}
        />
      )}

      {newDialogOpen && (
        <NewActionDialog
          open={newDialogOpen}
          onOpenChange={setNewDialogOpen}
          meetingId={meetingId}
          projectId={project.id}
          tasks={tasks}
          onCreated={(action) => {
            setNewDialogOpen(false);
            load();
            // Abre direto pra edição se for create/update/move/review
            if (action) setActiveAction(action);
          }}
        />
      )}
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────

function Section({
  title, icon, count, open, onToggle, children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full text-left text-sm font-medium"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        {icon}
        <span>{title}</span>
        <span className="text-xs text-muted-foreground">({count})</span>
      </button>
      {open && count > 0 && <div className="pl-1 space-y-1.5">{children}</div>}
    </div>
  );
}

// ─── ActionRow ───────────────────────────────────────────

function ActionRow({
  action, onOpen, onChange, meetingId,
}: {
  action: MeetingTaskAction & { task?: Task | null };
  onOpen: () => void;
  onChange: () => void;
  meetingId: string;
}) {
  const [busy, setBusy] = useState(false);

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/meetings/${meetingId}/task-actions/${action.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      onChange();
    } catch (e) {
      console.error("decide failed:", e);
      showErrorToast(e, { label: "Falha ao decidir" });
    } finally {
      setBusy(false);
    }
  };

  const desc =
    action.type === "create"
      ? (action.payload?.title as string) || "Nova task"
      : action.task
        ? `${action.task.reference ?? action.task.id.slice(0, 6)} · ${action.task.title}`
        : "Task";

  const showActionButtons = action.decision === "pending";

  const execStatus = action.execution;
  const execBadge =
    execStatus === "applied" ? "✓ aplicada"
    : execStatus === "failed" ? "✗ falha"
    : execStatus === "skipped" ? "skip"
    : null;

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/40 group">
      <Badge variant="secondary" className={`${ACTION_COLORS[action.type]} text-[10px] uppercase shrink-0`}>
        {ACTION_LABELS[action.type]}
      </Badge>
      {action.source === "ai" && (
        <Sparkles className="h-3 w-3 text-amber-500 shrink-0" />
      )}
      <span className="text-sm truncate flex-1">{desc}</span>
      {execBadge && (
        <span
          className={`text-[10px] shrink-0 ${
            execStatus === "applied"
              ? "text-green-600"
              : execStatus === "failed"
                ? "text-red-600"
                : "text-muted-foreground"
          }`}
        >
          {execBadge}
        </span>
      )}
      {action.errorMessage && (
        <AlertCircle className="h-3.5 w-3.5 text-red-500" />
      )}
      <div className="flex gap-1 shrink-0">
        {showActionButtons && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => decide("approved")}
              disabled={busy}
              className="h-7 px-2 text-xs text-green-700"
            >
              Aprovar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => decide("rejected")}
              disabled={busy}
              className="h-7 px-2 text-xs text-red-700"
            >
              Rejeitar
            </Button>
          </>
        )}
        <Button variant="outline" size="sm" onClick={onOpen} className="h-7 px-2 text-xs">
          Abrir
        </Button>
      </div>
    </div>
  );
}

// ─── New action dialog (manual) ──────────────────────────

function NewActionDialog({
  open, onOpenChange, meetingId, projectId, tasks, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  meetingId: string;
  projectId: string;
  tasks: Task[];
  onCreated: (action: MeetingTaskAction | null) => void;
}) {
  const [type, setType] = useState<ActionType>("create");
  const [taskId, setTaskId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (type !== "create" && !taskId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/task-actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          projectId,
          taskId: type !== "create" ? taskId : null,
          source: "manual",
          payload: type === "create" ? { status: "todo", scope: "small", complexity: "medium", type: "feature", priority: 0 } : {},
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "erro");
      onCreated(data);
    } catch (e) {
      console.error("create action failed:", e);
      showErrorToast(e, { label: "Falha ao criar ação" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Nova ação</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">Tipo</label>
            <Select value={type} onValueChange={(v) => v && setType(v as ActionType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="create">Criar nova task</SelectItem>
                <SelectItem value="update">Atualizar task</SelectItem>
                <SelectItem value="delete">Remover task da sprint</SelectItem>
                <SelectItem value="move">Mover task pra outra sprint</SelectItem>
                <SelectItem value="review">Marcar pra revisar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type !== "create" && (
            <div className="grid gap-2">
              <label className="text-sm font-medium">Task</label>
              <Select value={taskId} onValueChange={(v) => v && setTaskId(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {tasks.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.reference ?? t.id.slice(0, 6)} · {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={create}
            disabled={busy || (type !== "create" && !taskId)}
          >
            Continuar
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
