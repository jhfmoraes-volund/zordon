"use client";

import {
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SprintDetail,
  SprintNavigator,
  type NavValue,
  type Sprint as SprintView,
} from "@/components/sprint";
import type { SprintContextSheetMode } from "@/components/sprint/sprint-context-sheet";
import {
  TasksList,
  type ProjectLite,
  type TaskTag,
} from "@/components/story-hierarchy";
import type {
  AdaptedStory,
  AdaptedTask,
  AdaptedMember,
} from "@/components/story-hierarchy/adapters";
import { adaptModule } from "@/components/story-hierarchy/adapters";

type AdaptedModule = ReturnType<typeof adaptModule>;

type BulkUpdateInput = Parameters<
  NonNullable<
    React.ComponentProps<typeof TasksList>["onBulkUpdate"]
  >
>[1];

export type SprintsTabProps = {
  /** Data */
  sprints: SprintView[];
  tasks: AdaptedTask[];
  backlogTasks: AdaptedTask[];
  stories: AdaptedStory[];
  modules: AdaptedModule[];
  members: AdaptedMember[];
  projectTags: TaskTag[];
  backlogCount: number;
  allCount: number;
  activeSprintId: string | null;
  focused: SprintView | null;
  isSyntheticView: boolean;
  sprintView: NavValue | null;
  canManageSprint: boolean;

  /** Navigation */
  setSprintView: (v: NavValue | null) => void;
  setSelectedTaskRef: (ref: string | null) => void;

  /** Dialog openers (state setters) */
  setSprintContextSheet: (
    v: { sprintId: string; mode: SprintContextSheetMode } | null,
  ) => void;
  setSprintDialogOpen: (open: boolean) => void;
  setSuggestSheetOpen: (open: boolean) => void;
  setSprintEditingId: (id: string | null) => void;

  /** Sprint actions */
  requestActivateSprint: (targetId: string) => void;
  requestCompleteSprint: (targetId: string) => void;
  requestReopenSprint: (targetId: string) => void;
  handleDeleteSprint: (targetId: string) => void;

  /** Task creation/editing — shared with StoriesTab */
  handleCreateTask: (opts?: {
    userStoryId?: string | null;
    sprintId?: string | null;
  }) => void | Promise<void>;
  handleInlineStatusChange: (
    taskRef: string,
    status: AdaptedTask["status"],
  ) => void | Promise<void>;
  handleInlineAssigneeChange: (
    taskRef: string,
    memberId: string | null,
  ) => void | Promise<void>;
  handleInlineSprintChange: (
    taskRef: string,
    sprintId: string | null,
  ) => void | Promise<void>;
  openDuplicateDialog: (taskRef: string) => void;
  openCloneDialog: (taskRef: string) => Promise<void> | void;
  handleCopyTaskRef: (taskRef: string) => Promise<void> | void;
  handleDeleteTask: (taskRef: string) => Promise<void> | void;
  handleBulkUpdate: (taskRefs: string[], input: BulkUpdateInput) => Promise<void> | void;
  handleBulkDelete: (taskRefs: string[]) => Promise<void> | void;
  handleBulkDuplicate: (taskRefs: string[]) => Promise<void> | void;
  handleBulkAddTag: (taskRefs: string[], tagId: string) => Promise<void> | void;
  handleBulkRemoveTag: (taskRefs: string[], tagId: string) => Promise<void> | void;

  /** Suggested cast — placeholder for openCloneDialog needing target projects */
  targetProjects?: ProjectLite[];
};

export function SprintsTab({
  sprints,
  tasks,
  backlogTasks,
  stories,
  modules,
  members,
  projectTags,
  backlogCount,
  allCount,
  activeSprintId,
  focused,
  isSyntheticView,
  sprintView,
  canManageSprint,
  setSprintView,
  setSelectedTaskRef,
  setSprintContextSheet,
  setSprintDialogOpen,
  setSuggestSheetOpen,
  setSprintEditingId,
  requestActivateSprint,
  requestCompleteSprint,
  requestReopenSprint,
  handleDeleteSprint,
  handleCreateTask,
  handleInlineStatusChange,
  handleInlineAssigneeChange,
  handleInlineSprintChange,
  openDuplicateDialog,
  openCloneDialog,
  handleCopyTaskRef,
  handleDeleteTask,
  handleBulkUpdate,
  handleBulkDelete,
  handleBulkDuplicate,
  handleBulkAddTag,
  handleBulkRemoveTag,
}: SprintsTabProps) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <h3 className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sprints
        </h3>

        {focused && !isSyntheticView ? (
          <button
            type="button"
            onClick={() =>
              setSprintContextSheet({
                sprintId: focused.id,
                mode: focused.status === "completed" ? "view" : "edit-goal",
              })
            }
            title={focused.goal ?? "Definir objetivo do sprint"}
            className={`hidden lg:flex flex-1 min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted/40 ${
              focused.goal
                ? "text-foreground"
                : "text-muted-foreground italic"
            }`}
          >
            <Target className="size-3.5 shrink-0 text-primary" />
            <span className="truncate">
              {focused.goal ?? "Definir objetivo do sprint…"}
            </span>
          </button>
        ) : (
          <div className="hidden lg:block flex-1" />
        )}

        <div className="flex min-w-0 items-center gap-2 overflow-x-auto scrollbar-none -mx-3 px-3 md:mx-0 md:px-0">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="sm" className="shrink-0" />}
            >
              <Plus className="size-3.5" />
              Nova
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem
                className="whitespace-nowrap"
                onClick={() =>
                  handleCreateTask(
                    focused && !isSyntheticView
                      ? { sprintId: focused.id }
                      : undefined,
                  )
                }
              >
                <Plus className="size-3.5" />
                Task
              </DropdownMenuItem>
              <DropdownMenuItem
                className="whitespace-nowrap"
                onClick={() => setSprintDialogOpen(true)}
              >
                <Zap className="size-3.5" />
                Sprint
              </DropdownMenuItem>
              <DropdownMenuItem
                className="whitespace-nowrap"
                onClick={() => setSuggestSheetOpen(true)}
              >
                <Sparkles className="size-3.5" />
                Sugestão de sprint
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {focused && !isSyntheticView ? (
            <>
              <span
                aria-hidden
                className="mx-1 h-5 w-px shrink-0 bg-border/70"
              />

              {focused.status === "upcoming" ? (
                <Button
                  size="sm"
                  className="shrink-0"
                  onClick={() => requestActivateSprint(focused.id)}
                >
                  <Play className="size-3.5" />
                  Ativar sprint
                </Button>
              ) : focused.status === "active" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => requestCompleteSprint(focused.id)}
                >
                  <CheckCircle2 className="size-3.5" />
                  Concluir
                </Button>
              ) : null}

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label="Mais ações da sprint"
                      className="shrink-0 px-2"
                    />
                  }
                >
                  <MoreHorizontal className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuItem
                    className="whitespace-nowrap"
                    onClick={() =>
                      setSprintContextSheet({
                        sprintId: focused.id,
                        mode:
                          focused.status === "completed"
                            ? "view"
                            : "edit-goal",
                      })
                    }
                  >
                    <Target className="size-3.5" />
                    {focused.status === "completed"
                      ? "Ver retrospectiva"
                      : focused.goal
                        ? "Editar objetivo"
                        : "Definir objetivo"}
                  </DropdownMenuItem>
                  {focused.status === "completed" ? (
                    <DropdownMenuItem
                      className="whitespace-nowrap"
                      onClick={() => requestReopenSprint(focused.id)}
                    >
                      <RotateCcw className="size-3.5" />
                      Reabrir sprint
                    </DropdownMenuItem>
                  ) : null}
                  {focused.status === "active" ? (
                    <DropdownMenuItem
                      className="whitespace-nowrap"
                      onClick={() => requestCompleteSprint(focused.id)}
                    >
                      <CheckCircle2 className="size-3.5" />
                      Concluir sprint
                    </DropdownMenuItem>
                  ) : null}
                  {focused.status === "upcoming" ? (
                    <DropdownMenuItem
                      className="whitespace-nowrap"
                      onClick={() => requestActivateSprint(focused.id)}
                    >
                      <Play className="size-3.5" />
                      Ativar sprint
                    </DropdownMenuItem>
                  ) : null}
                  {canManageSprint ? (
                    <DropdownMenuItem
                      className="whitespace-nowrap"
                      onClick={() => setSprintEditingId(focused.id)}
                    >
                      <Pencil className="size-3.5" />
                      Editar sprint
                    </DropdownMenuItem>
                  ) : null}
                  {canManageSprint ? (
                    <DropdownMenuItem
                      variant="destructive"
                      className="whitespace-nowrap"
                      onClick={() => handleDeleteSprint(focused.id)}
                    >
                      <Trash2 className="size-3.5" />
                      Excluir sprint
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
        </div>
      </div>

      {sprints.length === 0 && !isSyntheticView ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhum sprint cadastrado</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Crie o primeiro sprint pra começar a planejar — ou navegue pro
            Backlog/Todas pra ver tasks soltas.
          </CardContent>
        </Card>
      ) : (
        <>
          <SprintNavigator
            sprints={sprints}
            currentId={
              isSyntheticView ? sprintView! : (focused?.id ?? "all")
            }
            activeId={activeSprintId}
            tasks={tasks}
            onChange={(v) => setSprintView(v)}
            onJumpToActive={() =>
              activeSprintId && setSprintView(activeSprintId)
            }
            showSyntheticViews
            backlogCount={backlogCount}
            allCount={allCount}
          />

          {isSyntheticView ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {sprintView === "backlog" ? "Backlog" : "Todas as tasks"}
              </h3>
              <TasksList
                tasks={sprintView === "backlog" ? backlogTasks : tasks}
                stories={stories}
                modules={modules}
                members={members}
                sprints={sprints}
                availableTags={projectTags}
                onOpenTask={(ref) => setSelectedTaskRef(ref)}
                onChangeStatus={handleInlineStatusChange}
                onChangeAssignee={handleInlineAssigneeChange}
                onChangeSprint={handleInlineSprintChange}
                onDuplicate={openDuplicateDialog}
                onClone={openCloneDialog}
                onCopyRef={handleCopyTaskRef}
                onDelete={handleDeleteTask}
                onBulkUpdate={handleBulkUpdate}
                onBulkDelete={handleBulkDelete}
                onBulkDuplicate={handleBulkDuplicate}
                onBulkAddTag={handleBulkAddTag}
                onBulkRemoveTag={handleBulkRemoveTag}
              />
            </section>
          ) : focused ? (
            <SprintDetail
              sprint={focused}
              tasks={tasks}
              stories={stories}
              modules={modules}
              members={members}
              onOpenTask={(ref) => setSelectedTaskRef(ref)}
              allSprints={sprints}
              onChangeTaskStatus={handleInlineStatusChange}
              onChangeTaskAssignee={handleInlineAssigneeChange}
              onChangeTaskSprint={handleInlineSprintChange}
              onDuplicateTask={openDuplicateDialog}
              onCloneTask={openCloneDialog}
              onCopyTaskRef={handleCopyTaskRef}
              onDeleteTask={handleDeleteTask}
              onBulkUpdate={handleBulkUpdate}
              onBulkDelete={handleBulkDelete}
              onBulkDuplicate={handleBulkDuplicate}
              onBulkAddTag={handleBulkAddTag}
              onBulkRemoveTag={handleBulkRemoveTag}
              availableTags={projectTags}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
