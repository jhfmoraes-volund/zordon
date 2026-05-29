"use client";

// MeetingTaskActionSheet v2 — single sheet that wraps either:
//   - the rich TaskSheetInner (for create/update proposals), or
//   - a small action-specific view (for move/delete/review),
// surrounded by a yellow proposal banner + Aprovar/Rejeitar footer.
//
// Invariant: while a proposal is *pending*, edits in the rich sheet land in a
// local payload buffer; they only persist when the user clicks Aprovar (which
// sends the buffered payload to the API). This preserves the audit model
// (proposal → decision → execution) while reusing the same editor surface as
// /projects/[id].

import { useCallback, useEffect, useState } from "react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
} from "@/components/ui/responsive-sheet";
import { TaskSheetInner, type TaskTag } from "@/components/story-hierarchy";
import type { ChipTone } from "@/lib/status-chips";
import {
  useTaskSheetContext,
  type TaskSheetContext,
} from "@/components/story-hierarchy/use-task-sheet-context";
import {
  adaptTask,
  buildTaskAdapterContext,
  type AdaptedStory,
  type AdaptedTask,
} from "@/components/story-hierarchy/adapters";
import type { AcceptanceCriterionRow } from "@/lib/dal/story-hierarchy";
import { createClient } from "@/lib/supabase/client";
import { flattenTagEmbed } from "@/lib/task-tags";
import { ProposalShell, type ProposalDecisionPayload } from "./proposal-shell";
import {
  DeleteProposalView,
  MoveProposalView,
  ReviewProposalView,
} from "./proposal-views";

// ─── Types ──────────────────────────────────────────────────────────────────

type ActionType = "create" | "update" | "delete" | "move" | "review";

type Task = {
  id: string;
  reference: string | null;
  title: string;
  description: string | null;
  status: string;
  type: string;
  scope: string;
  complexity: string;
  priority: number;
  notes: string | null;
  dueDate: string | null;
  projectId: string;
  sprintId: string | null;
  assignments: { member: { id: string; name: string } | null }[];
};

export type MeetingTaskAction = {
  id: string;
  projectId: string;
  type: ActionType;
  taskId: string | null;
  targetSprintId: string | null;
  payload: Record<string, unknown>;
  decision: "pending" | "approved" | "rejected";
  execution: "pending" | "applied" | "failed" | "skipped";
  source: "ai" | "manual";
  aiReasoning: string | null;
  aiConfidence: number | null;
  errorMessage: string | null;
  notes: string | null;
  reviewReasons: string[] | null;
  reviewNote: string | null;
  task?: Task | null;
};

export type MeetingTaskActionSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId?: string;
  /** Override completo da URL de decisão (ex: para planning). */
  decisionUrl?: string;
  action: MeetingTaskAction;
  projectId: string;
  onChange?: () => void;
};

// ─── Wrapper ────────────────────────────────────────────────────────────────

export function MeetingTaskActionSheet(props: MeetingTaskActionSheetProps) {
  return (
    <ResponsiveSheet open={props.open} onOpenChange={props.onOpenChange}>
      <ResponsiveSheetContent size="lg" showCloseButton={false}>
        {props.open && <Body {...props} key={props.action.id} />}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

// ─── Body ───────────────────────────────────────────────────────────────────

function Body({
  action,
  meetingId,
  decisionUrl,
  projectId,
  onChange,
  onOpenChange,
}: MeetingTaskActionSheetProps) {
  const { ctx, loading, setProjectTags } = useTaskSheetContext({
    mode: "byProject",
    projectId,
  });

  // Local buffers — only flushed on Aprovar.
  const [payload, setPayload] = useState<Record<string, unknown>>(() => ({
    ...action.payload,
  }));
  const [targetSprintId, setTargetSprintId] = useState<string | null>(
    action.targetSprintId,
  );
  const [reviewReasons, setReviewReasons] = useState<string[]>(
    action.reviewReasons ?? [],
  );
  const [reviewNote, setReviewNote] = useState<string>(action.reviewNote ?? "");

  // Load underlying task for non-create actions, into a local "boundTask".
  const [boundTask, setBoundTask] = useState<AdaptedTask | null>(null);
  const [bindingTask, setBindingTask] = useState(false);
  useEffect(() => {
    if (!ctx) return;
    if (action.type === "create") return;
    if (!action.taskId) return;
    let cancelled = false;
    (async () => {
      setBindingTask(true);
      const supabase = createClient();
      const [taskRes, acRes] = await Promise.all([
        supabase
          .from("Task")
          .select(
            "*, assignments:TaskAssignment(memberId, member:Member(id, name)), tags:TaskTagAssignment(TaskTag(id, projectId, name, tone))",
          )
          .eq("id", action.taskId!)
          .single(),
        supabase
          .from("AcceptanceCriterion")
          .select("*")
          .not("taskId", "is", null),
      ]);
      if (cancelled) return;
      if (!taskRes.data) {
        setBoundTask(null);
        setBindingTask(false);
        return;
      }
      const acRows = (acRes.data ?? []) as AcceptanceCriterionRow[];
      const adapterCtx = buildTaskAdapterContext(ctx.stories, acRows);
      const flatTask = {
        ...taskRes.data,
        tags: flattenTagEmbed(
          (taskRes.data as { tags?: Parameters<typeof flattenTagEmbed>[0] }).tags,
        ),
      };
      const adapted = adaptTask(
        flatTask as Parameters<typeof adaptTask>[0],
        adapterCtx,
      );
      setBoundTask(adapted);
      setBindingTask(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, action.type, action.taskId]);

  const buildDecisionPayload = useCallback((): ProposalDecisionPayload => {
    const wasEdited =
      JSON.stringify(payload) !== JSON.stringify(action.payload) ||
      targetSprintId !== action.targetSprintId ||
      JSON.stringify(reviewReasons) !==
        JSON.stringify(action.reviewReasons ?? []) ||
      reviewNote !== (action.reviewNote ?? "");

    return {
      payload,
      targetSprintId,
      reviewReasons,
      reviewNote,
      wasEdited,
    };
  }, [
    payload,
    action.payload,
    action.targetSprintId,
    action.reviewReasons,
    action.reviewNote,
    targetSprintId,
    reviewReasons,
    reviewNote,
  ]);

  const onCreatedTag = useCallback(
    (t: TaskTag) => {
      if (!ctx) return;
      setProjectTags([...ctx.projectTags, t]);
    },
    [ctx, setProjectTags],
  );

  return (
    <ProposalShell
      action={action}
      meetingId={meetingId}
      decisionUrl={decisionUrl}
      buildDecisionPayload={buildDecisionPayload}
      loading={loading}
      onClose={() => onOpenChange(false)}
      onChange={onChange}
    >
      {ctx && (
        <ActionBody
          action={action}
          ctx={ctx}
          payload={payload}
          setPayload={setPayload}
          targetSprintId={targetSprintId}
          onTargetSprintChange={setTargetSprintId}
          reviewReasons={reviewReasons}
          reviewNote={reviewNote}
          onReviewChange={({ reasons, note }) => {
            setReviewReasons(reasons);
            setReviewNote(note);
          }}
          boundTask={boundTask}
          bindingTask={bindingTask}
          onCreatedTag={onCreatedTag}
        />
      )}
    </ProposalShell>
  );
}

// ─── ActionBody — switches by action type ───────────────────────────────────

function ActionBody({
  action,
  ctx,
  payload,
  setPayload,
  targetSprintId,
  onTargetSprintChange,
  reviewReasons,
  reviewNote,
  onReviewChange,
  boundTask,
  bindingTask,
  onCreatedTag,
}: {
  action: MeetingTaskAction;
  ctx: TaskSheetContext;
  payload: Record<string, unknown>;
  setPayload: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  targetSprintId: string | null;
  onTargetSprintChange: (id: string | null) => void;
  reviewReasons: string[];
  reviewNote: string;
  onReviewChange: (next: { reasons: string[]; note: string }) => void;
  boundTask: AdaptedTask | null;
  bindingTask: boolean;
  onCreatedTag: (t: TaskTag) => void;
}) {
  if (action.type === "move") {
    const taskHeader = boundTask
      ? {
          reference: boundTask.reference,
          title: boundTask.title,
          currentSprintName: boundTask.sprintId
            ? ctx.sprints.find((s) => s.id === boundTask.sprintId)?.name ?? null
            : null,
        }
      : { reference: null, title: bindingTask ? "Carregando…" : "Task", currentSprintName: null };

    // Destination = any planning/active sprint that isn't the task's current
    // one. This includes the meeting's own active sprint, so PMs can pull a
    // task from another sprint into the current one.
    const movableSprints = ctx.sprints.filter(
      (s) =>
        (s.status === "planning" || s.status === "active") &&
        s.id !== boundTask?.sprintId,
    );
    return (
      <MoveProposalView
        task={taskHeader}
        sprints={movableSprints.map((s) => ({
          id: s.id,
          name: s.name,
          status: s.status ?? "active",
        }))}
        initialTargetSprintId={targetSprintId}
        onTargetChange={onTargetSprintChange}
      />
    );
  }

  if (action.type === "delete") {
    const taskHeader = boundTask
      ? {
          reference: boundTask.reference,
          title: boundTask.title,
          currentSprintName: boundTask.sprintId
            ? ctx.sprints.find((s) => s.id === boundTask.sprintId)?.name ?? null
            : null,
        }
      : { reference: null, title: bindingTask ? "Carregando…" : "Task" };
    return <DeleteProposalView task={taskHeader} />;
  }

  if (action.type === "review") {
    const taskHeader = boundTask
      ? { reference: boundTask.reference, title: boundTask.title }
      : { reference: null, title: bindingTask ? "Carregando…" : "Task" };
    return (
      <ReviewProposalView
        task={taskHeader}
        initial={{ reasons: reviewReasons, note: reviewNote }}
        onChange={onReviewChange}
      />
    );
  }

  // create / update use the rich TaskSheetInner
  if (action.type === "update" && bindingTask) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        Carregando task…
      </div>
    );
  }
  if (action.type === "update" && !boundTask) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        Task não encontrada (pode ter sido removida).
      </div>
    );
  }

  const draftTask: AdaptedTask =
    action.type === "create"
      ? buildVirtualCreateTask(payload, ctx)
      : applyPayloadToTask(boundTask!, payload, ctx);

  return (
    <RichTaskBody
      ctx={ctx}
      draftTask={draftTask}
      setPayload={setPayload}
      onCreatedTag={onCreatedTag}
    />
  );
}

// ─── RichTaskBody — wraps TaskSheetInner with buffer-only handlers ──────────

function RichTaskBody({
  ctx,
  draftTask,
  setPayload,
  onCreatedTag,
}: {
  ctx: TaskSheetContext;
  draftTask: AdaptedTask;
  setPayload: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  onCreatedTag: (t: TaskTag) => void;
}) {
  const setField = (k: string, v: unknown) =>
    setPayload((prev) => ({ ...prev, [k]: v }));

  // Buffer handlers — never call the API. They mutate the local payload only.
  // TaskSheetInner passes plain `Task` (no __id); we treat it the same here.
  const handleSave = (updated: import("@/components/story-hierarchy").Task) => {
    setPayload((prev) => {
      const next = { ...prev };
      if (updated.title !== draftTask.title) next.title = updated.title;
      if (updated.description !== draftTask.description)
        next.description = updated.description;
      if (updated.notes !== draftTask.notes) next.notes = updated.notes;
      if (updated.status !== draftTask.status) next.status = updated.status;
      if (updated.type !== draftTask.type) next.type = updated.type;
      if (updated.scope !== draftTask.scope) next.scope = updated.scope;
      if (updated.complexity !== draftTask.complexity)
        next.complexity = updated.complexity;
      if (updated.functionPoints !== draftTask.functionPoints)
        next.functionPoints = updated.functionPoints;
      if (updated.billable !== draftTask.billable)
        next.billable = updated.billable;
      if (updated.dueDate !== draftTask.dueDate) next.dueDate = updated.dueDate;
      if (updated.userStoryRef !== draftTask.userStoryRef) {
        const story = ctx.stories.find(
          (s: AdaptedStory) => s.reference === updated.userStoryRef,
        );
        next.userStoryId = story?.__id ?? null;
      }
      return next;
    });
  };

  const handleChangeSprint = async (_ref: string, sprintId: string | null) => {
    setField("sprintId", sprintId);
  };
  const handleChangeAssignees = async (_ref: string, memberIds: string[]) => {
    setField("assigneeIds", memberIds);
  };
  const handleChangeTags = async (_ref: string, tagIds: string[]) => {
    setField("tagIds", tagIds);
  };

  const handleAcCreate = async (_ref: string, text: string) => {
    setPayload((prev) => {
      const list = Array.isArray(prev.acceptanceCriteria)
        ? (prev.acceptanceCriteria as Array<{ id?: string; text: string }>)
        : draftTask.acceptanceCriteria.map((a) => ({ id: a.id, text: a.text }));
      return {
        ...prev,
        acceptanceCriteria: [...list, { id: `tmp-${Date.now()}`, text }],
      };
    });
  };
  const handleAcUpdateText = async (
    _ref: string,
    acId: string,
    text: string,
  ) => {
    setPayload((prev) => {
      const list = Array.isArray(prev.acceptanceCriteria)
        ? (prev.acceptanceCriteria as Array<{ id?: string; text: string }>)
        : draftTask.acceptanceCriteria.map((a) => ({ id: a.id, text: a.text }));
      return {
        ...prev,
        acceptanceCriteria: list.map((a) =>
          a.id === acId ? { ...a, text } : a,
        ),
      };
    });
  };
  const handleAcToggle = async () => {
    // checked-state isn't part of the proposal payload — ignored in draft mode.
  };
  const handleAcDelete = async (_ref: string, acId: string) => {
    setPayload((prev) => {
      const list = Array.isArray(prev.acceptanceCriteria)
        ? (prev.acceptanceCriteria as Array<{ id?: string; text: string }>)
        : draftTask.acceptanceCriteria.map((a) => ({ id: a.id, text: a.text }));
      return {
        ...prev,
        acceptanceCriteria: list.filter((a) => a.id !== acId),
      };
    });
  };

  const handleCreateTag = async (
    name: string,
    tone: ChipTone,
  ): Promise<TaskTag> => {
    const res = await fetch(`/api/projects/${ctx.projectId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, tone }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Falha ao criar tag");
    }
    const created = (await res.json()) as TaskTag;
    onCreatedTag(created);
    return created;
  };

  return (
    <TaskSheetInner
      task={draftTask}
      stories={ctx.stories}
      modules={ctx.modules}
      members={ctx.members}
      sprints={ctx.sprints}
      definitionOfDone={ctx.definitionOfDone}
      availableTags={ctx.projectTags}
      onClose={() => {
        /* close handled by ProposalShell footer */
      }}
      onSave={handleSave}
      onChangeSprint={handleChangeSprint}
      onChangeAssignees={handleChangeAssignees}
      onCreateTag={handleCreateTag}
      onChangeTags={handleChangeTags}
      onAcCreate={handleAcCreate}
      onAcUpdateText={handleAcUpdateText}
      onAcToggle={handleAcToggle}
      onAcDelete={handleAcDelete}
    />
  );
}

// ─── Helpers — payload ↔ AdaptedTask ────────────────────────────────────────

function buildVirtualCreateTask(
  payload: Record<string, unknown>,
  ctx: TaskSheetContext,
): AdaptedTask {
  const userStoryId = (payload.userStoryId as string | null | undefined) ?? null;
  const story = userStoryId
    ? ctx.stories.find((s: AdaptedStory) => s.__id === userStoryId)
    : null;

  const tagIds = Array.isArray(payload.tagIds) ? (payload.tagIds as string[]) : [];
  const tags = ctx.projectTags.filter((t) => tagIds.includes(t.id));

  const acs = Array.isArray(payload.acceptanceCriteria)
    ? (payload.acceptanceCriteria as Array<{ id?: string; text: string }>)
    : [];

  return {
    __id: "virtual-create",
    reference: "—",
    userStoryRef: story?.reference ?? null,
    sprintId: (payload.sprintId as string | null) ?? null,
    title: (payload.title as string) ?? "",
    description: (payload.description as string | null) ?? null,
    status: (payload.status as AdaptedTask["status"]) ?? "backlog",
    type: (payload.type as AdaptedTask["type"]) ?? "feature",
    scope: (payload.scope as AdaptedTask["scope"]) ?? "small",
    complexity: (payload.complexity as AdaptedTask["complexity"]) ?? "medium",
    tags,
    functionPoints: (payload.functionPoints as number | undefined) ?? 0,
    billable: (payload.billable as boolean | undefined) ?? true,
    dueDate: (payload.dueDate as string | null) ?? null,
    doneAt: null,
    notes: (payload.notes as string | null) ?? null,
    assigneeIds: Array.isArray(payload.assigneeIds)
      ? (payload.assigneeIds as string[])
      : [],
    acceptanceCriteria: acs.map((a, i) => ({
      id: a.id ?? `tmp-${i}`,
      text: a.text,
      checked: false,
    })),
    createdByAgent: true,
  };
}

function applyPayloadToTask(
  base: AdaptedTask,
  payload: Record<string, unknown>,
  ctx: TaskSheetContext,
): AdaptedTask {
  const next: AdaptedTask = { ...base };
  if ("title" in payload) next.title = payload.title as string;
  if ("description" in payload)
    next.description = payload.description as string | null;
  if ("notes" in payload) next.notes = payload.notes as string | null;
  if ("status" in payload) next.status = payload.status as AdaptedTask["status"];
  if ("type" in payload) next.type = payload.type as AdaptedTask["type"];
  if ("scope" in payload) next.scope = payload.scope as AdaptedTask["scope"];
  if ("complexity" in payload)
    next.complexity = payload.complexity as AdaptedTask["complexity"];
  if ("functionPoints" in payload)
    next.functionPoints = (payload.functionPoints as number) ?? 0;
  if ("billable" in payload) next.billable = (payload.billable as boolean) ?? true;
  if ("dueDate" in payload) next.dueDate = payload.dueDate as string | null;
  if ("sprintId" in payload) next.sprintId = payload.sprintId as string | null;
  if ("userStoryId" in payload) {
    const id = payload.userStoryId as string | null;
    const story = id ? ctx.stories.find((s) => s.__id === id) : null;
    next.userStoryRef = story?.reference ?? null;
  }
  if (Array.isArray(payload.assigneeIds)) {
    next.assigneeIds = payload.assigneeIds as string[];
  }
  if (Array.isArray(payload.tagIds)) {
    const ids = payload.tagIds as string[];
    next.tags = ctx.projectTags.filter((t) => ids.includes(t.id));
  }
  if (Array.isArray(payload.acceptanceCriteria)) {
    const list = payload.acceptanceCriteria as Array<{
      id?: string;
      text: string;
    }>;
    next.acceptanceCriteria = list.map((a, i) => ({
      id: a.id ?? `tmp-${i}`,
      text: a.text,
      checked: false,
    }));
  }
  return next;
}
