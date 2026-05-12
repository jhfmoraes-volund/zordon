"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sparkles,
  Plus,
  Loader2,
  ChevronDown,
  Pencil,
  ArrowRightLeft,
  ArrowDownToLine,
  HelpCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { flattenTagEmbed } from "@/lib/task-tags";
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
} from "@/components/story-hierarchy/adapters";
import type {
  ModuleRow,
  StoryWithRelations,
} from "@/lib/dal/story-hierarchy";
import type {
  Member,
  Module,
  TaskStatus,
  TaskTag,
} from "@/components/story-hierarchy";
import type { AdaptedStory } from "@/components/story-hierarchy/adapters";
import {
  TaskPickerSheet,
  type PickerAction,
  type PickerTask,
} from "./task-picker-sheet";

type Project = { id: string; name: string };
type SprintLite = { id: string; name: string; status: string };

export type TaskActionWidgetProps = {
  meetingId: string;
  project: Project;
};

export function TaskActionWidget({ meetingId, project }: TaskActionWidgetProps) {
  const [actions, setActions] = useState<MeetingTaskAction[]>([]);
  const [tasksById, setTasksById] = useState<Map<string, RawTaskForRow>>(new Map());
  const [activeSprint, setActiveSprint] = useState<SprintLite | null>(null);
  const [sprints, setSprints] = useState<SprintLite[]>([]);
  const [stories, setStories] = useState<AdaptedStory[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [tags, setTags] = useState<TaskTag[]>([]);

  const [loading, setLoading] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [applying, setApplying] = useState(false);
  const [creatingType, setCreatingType] = useState<MeetingTaskAction["type"] | null>(null);

  const [activeAction, setActiveAction] = useState<MeetingTaskAction | null>(null);
  const [pickerAction, setPickerAction] = useState<PickerAction | null>(null);

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
          "id, reference, title, description, status, type, scope, complexity, priority, sprintId, userStoryId, functionPoints, billable, dueDate, notes, assignments:TaskAssignment(memberId), tags:TaskTagAssignment(TaskTag(id, projectId, name, tone))",
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
        .select("id, projectId, name, tone")
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
    for (const t of tasksRes.data ?? []) {
      const flat = {
        ...t,
        tags: flattenTagEmbed(
          (t as { tags?: Parameters<typeof flattenTagEmbed>[0] }).tags,
        ),
      } as RawTaskForRow;
      taskMap.set(flat.id, flat);
    }
    setTasksById(taskMap);

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

  /**
   * Create a manual proposal of the given type and open the sheet for editing.
   * For non-create types, taskId comes from the picker; targetSprintId is the
   * meeting's active sprint by default for "move".
   */
  const createAction = useCallback(
    async (type: MeetingTaskAction["type"], taskId: string | null) => {
      setCreatingType(type);
      try {
        const body: Record<string, unknown> = {
          type,
          projectId: project.id,
          source: "manual",
          taskId,
        };
        if (type === "create") {
          body.payload = {
            status: "todo",
            scope: "small",
            complexity: "medium",
            type: "feature",
            priority: 0,
            sprintId: activeSprint?.id ?? null,
          };
        } else if (type === "move") {
          // Default destination = meeting's active sprint. PM can change.
          body.targetSprintId = activeSprint?.id ?? null;
          body.payload = {};
        } else {
          body.payload = {};
        }
        const res = await fetch(`/api/meetings/${meetingId}/task-actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "erro");
        await load();
        setActiveAction(data as MeetingTaskAction);
      } catch (e) {
        console.error("create action failed:", e);
        showErrorToast(e, { label: "Falha ao criar proposta" });
      } finally {
        setCreatingType(null);
      }
    },
    [meetingId, project.id, activeSprint?.id, load],
  );

  const handleNewTask = () => createAction("create", null);

  const handlePickerPick = (taskId: string) => {
    if (!pickerAction) return;
    const type = pickerAction;
    setPickerAction(null);
    createAction(type, taskId);
  };

  const pickerTasks: PickerTask[] = useMemo(
    () =>
      Array.from(tasksById.values()).map((t) => ({
        id: t.id,
        reference: t.reference,
        title: t.title,
        status: t.status as TaskStatus,
        sprintId: t.sprintId,
      })),
    [tasksById],
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
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm" disabled={creatingType !== null}>
                  {creatingType !== null ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="mr-1 h-3.5 w-3.5" />
                  )}
                  Nova ação
                  <ChevronDown className="ml-1 h-3.5 w-3.5" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={handleNewTask}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                Criar nova task
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPickerAction("update")}>
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Atualizar task existente
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPickerAction("move")}>
                <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                Mover task entre sprints
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPickerAction("delete")}>
                <ArrowDownToLine className="mr-2 h-3.5 w-3.5" />
                Tirar task da sprint
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPickerAction("review")}>
                <HelpCircle className="mr-2 h-3.5 w-3.5" />
                Marcar pra revisar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

      {pickerAction && (
        <TaskPickerSheet
          open={!!pickerAction}
          onOpenChange={(o) => !o && setPickerAction(null)}
          action={pickerAction}
          tasks={pickerTasks}
          sprints={sprints.map((s) => ({ id: s.id, name: s.name }))}
          activeSprintId={activeSprint?.id ?? null}
          onPick={handlePickerPick}
        />
      )}
    </div>
  );
}
