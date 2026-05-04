"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
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
import { Sparkles, Plus, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { MeetingTaskActionSheet, type MeetingTaskAction } from "./meeting-task-action-sheet";
import { toast } from "sonner";
import { showErrorToast } from "@/lib/optimistic/toast";
import {
  MeetingTaskList,
  actionToRow,
  buildStoryRefMap,
  type ActionRow,
  type RawTaskForRow,
} from "./meeting-task-list";
import {
  adaptMember,
  adaptModule,
  adaptStory,
  type AdaptedStory,
} from "@/components/story-hierarchy/adapters";
import type {
  AcceptanceCriterionRow,
  ModuleRow,
  StoryWithRelations,
} from "@/lib/dal/story-hierarchy";
import type { Member, Module, TaskTag } from "@/components/story-hierarchy";

type Project = { id: string; name: string };
type SprintLite = { id: string; name: string; status: string };
type ActionType = "create" | "update" | "delete" | "move" | "review";

type LiteTask = { id: string; reference: string | null; title: string; status: string };

export type TaskActionWidgetProps = {
  meetingId: string;
  project: Project;
};

export function TaskActionWidget({ meetingId, project }: TaskActionWidgetProps) {
  const [actions, setActions] = useState<MeetingTaskAction[]>([]);
  const [tasksById, setTasksById] = useState<Map<string, RawTaskForRow>>(new Map());
  const [pickerTasks, setPickerTasks] = useState<LiteTask[]>([]);
  const [activeSprint, setActiveSprint] = useState<SprintLite | null>(null);
  const [sprints, setSprints] = useState<SprintLite[]>([]);
  const [stories, setStories] = useState<AdaptedStory[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [tags, setTags] = useState<TaskTag[]>([]);

  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [applying, setApplying] = useState(false);

  const [activeAction, setActiveAction] = useState<MeetingTaskAction | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    const [
      aRes,
      sprintsRes,
      tasksRes,
      storiesRes,
      modulesRes,
      tagsRes,
      pmRes,
    ] = await Promise.all([
      fetch(`/api/meetings/${meetingId}/task-actions`).then((r) => r.json()),
      supabase
        .from("Sprint")
        .select("id, name, status")
        .eq("projectId", project.id)
        .order("startDate"),
      supabase
        .from("Task")
        .select(
          "id, reference, title, description, status, type, scope, complexity, priority, sprintId, userStoryId, functionPoints, billable, dueDate, notes, assignments:TaskAssignment(memberId), tags:TaskTagAssignment(TaskTag(id, name, tone))",
        )
        .eq("projectId", project.id),
      supabase
        .from("UserStory")
        .select(
          "*, acceptanceCriteria:AcceptanceCriterion!AcceptanceCriterion_userStoryId_fkey(*), module:Module(id, name, description), persona:ProjectPersona(id, name, description)",
        )
        .eq("projectId", project.id),
      supabase
        .from("Module")
        .select("*")
        .eq("projectId", project.id)
        .order("name"),
      supabase
        .from("TaskTag")
        .select("id, name, tone")
        .eq("projectId", project.id)
        .order("name"),
      supabase
        .from("ProjectMember")
        .select("member:Member!ProjectMember_memberId_fkey(id, name, role)")
        .eq("projectId", project.id),
    ]);

    const projectActions = (aRes ?? []).filter(
      (a: MeetingTaskAction & { projectId: string }) => a.projectId === project.id,
    );
    setActions(projectActions);

    const allSprints = (sprintsRes.data ?? []) as SprintLite[];
    setSprints(allSprints);
    setActiveSprint(allSprints.find((s) => s.status === "active") ?? null);

    const taskMap = new Map<string, RawTaskForRow>();
    for (const t of (tasksRes.data ?? []) as RawTaskForRow[]) taskMap.set(t.id, t);
    setTasksById(taskMap);

    // Picker fallback list — for the legacy NewActionDialog. Prioritize sprint
    // tasks, fall back to backlog when no active sprint.
    const active = allSprints.find((s) => s.status === "active");
    const pickerSource = active
      ? Array.from(taskMap.values()).filter((t) => t.sprintId === active.id)
      : Array.from(taskMap.values())
          .filter((t) => t.status === "backlog")
          .slice(0, 20);
    setPickerTasks(
      pickerSource.map((t) => ({
        id: t.id,
        reference: t.reference,
        title: t.title,
        status: t.status as string,
      })),
    );

    const adaptedStories = (
      (storiesRes.data ?? []) as unknown as StoryWithRelations[]
    ).map(adaptStory);
    setStories(adaptedStories);
    setModules((modulesRes.data ?? []).map((r) => adaptModule(r as ModuleRow)));
    setTags((tagsRes.data ?? []) as TaskTag[]);

    const memberRows = (pmRes.data ?? [])
      .map((pm) => {
        const m = pm.member as
          | { id: string; name: string; role: string | null }
          | { id: string; name: string; role: string | null }[]
          | null;
        return Array.isArray(m) ? m[0] ?? null : m;
      })
      .filter((m): m is { id: string; name: string; role: string | null } => !!m);
    setMembers(memberRows.map((m) => adaptMember(m)));

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
        },
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
        { method: "POST" },
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

  const decideOne = useCallback(
    async (id: string, decision: "approved" | "rejected") => {
      try {
        const res = await fetch(
          `/api/meetings/${meetingId}/task-actions/${id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision }),
          },
        );
        if (!res.ok) throw new Error(await res.text());
        await load();
      } catch (e) {
        console.error("decide failed:", e);
        showErrorToast(e, { label: "Falha ao decidir" });
      }
    },
    [meetingId, load],
  );

  const bulkDecide = useCallback(
    async (ids: string[], decision: "approved" | "rejected") => {
      // Sequential — keeps simple ordering and avoids race on the same row
      for (const id of ids) {
        try {
          const res = await fetch(
            `/api/meetings/${meetingId}/task-actions/${id}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ decision }),
            },
          );
          if (!res.ok) throw new Error(await res.text());
        } catch (e) {
          console.error("bulk decide failed for", id, e);
          showErrorToast(e, { label: "Falha em proposta" });
        }
      }
      await load();
    },
    [meetingId, load],
  );

  const rows: ActionRow[] = useMemo(() => {
    const storyRefById = buildStoryRefMap(
      stories.map((s) => ({ ...s, __id: s.__id })),
    );
    return actions.map((a) =>
      actionToRow(
        a,
        a.taskId ? tasksById.get(a.taskId) ?? null : null,
        storyRefById,
        tags,
      ),
    );
  }, [actions, tasksById, stories, tags]);

  const approvedToApply = actions.filter(
    (a) => a.decision === "approved" && a.execution === "pending",
  ).length;

  return (
    <div className="surface p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold">{project.name}</h3>
          <p className="text-xs text-muted-foreground">
            {activeSprint
              ? `Sprint ${activeSprint.name} (${activeSprint.status}) · ${rows.length} ${rows.length === 1 ? "proposta" : "propostas"}`
              : "Sem sprint ativa"}
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
      ) : (
        <MeetingTaskList
          rows={rows}
          stories={stories}
          modules={modules}
          members={members}
          sprints={sprints}
          availableTags={tags}
          onOpenAction={setActiveAction}
          onApprove={(id) => decideOne(id, "approved")}
          onReject={(id) => decideOne(id, "rejected")}
          onBulkApprove={(ids) => bulkDecide(ids, "approved")}
          onBulkReject={(ids) => bulkDecide(ids, "rejected")}
        />
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
          tasks={pickerTasks}
          onCreated={(action) => {
            setNewDialogOpen(false);
            load();
            if (action) setActiveAction(action);
          }}
        />
      )}
    </div>
  );
}

// ─── New action dialog (manual) ──────────────────────────
// Kept for now; Fase 6 will replace with direct "Nova task" + in-sheet
// secondary actions.

function NewActionDialog({
  open, onOpenChange, meetingId, projectId, tasks, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  meetingId: string;
  projectId: string;
  tasks: LiteTask[];
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
