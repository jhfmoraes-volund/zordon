"use client";

import { useState } from "react";
import { StatusChip } from "@/components/ui/status-chip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  MeetingTaskActionSheet,
  type MeetingTaskAction,
} from "@/components/meetings/meeting-task-action-sheet";
import type { ChipTone } from "@/lib/status-chips";

type ActionType = "create" | "update" | "delete" | "move" | "review";

export type PlanningAction = {
  id: string;
  type: ActionType;
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
  projectId: string;
  taskId: string | null;
  targetSprintId: string | null;
  task?: {
    id: string;
    reference: string | null;
    title: string;
    status: string;
    scope: string;
    type: string;
    priority: number;
    sprintId: string | null;
    projectId: string;
  } | null;
};

interface ProposalCardProps {
  action: PlanningAction;
  planningId: string;
  onDecide: () => void;
}

const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  create: "Criar",
  update: "Atualizar",
  delete: "Excluir",
  move: "Mover",
  review: "Revisar",
};

const ACTION_TYPE_TONE: Record<ActionType, ChipTone> = {
  create: "green",
  update: "blue",
  delete: "red",
  move: "amber",
  review: "cyan",
};

export function ProposalCard({ action, planningId, onDecide }: ProposalCardProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const decided = action.decision !== "pending";
  const taskTitle =
    action.task?.title ??
    (action.payload?.title as string | undefined) ??
    (action.payload?.description as string | undefined) ??
    "—";

  return (
    <>
      <button
        type="button"
        onClick={() => !decided && setSheetOpen(true)}
        className={cn(
          "w-full rounded-lg border p-3 text-left space-y-1.5 transition-colors",
          decided
            ? "cursor-default opacity-60"
            : "hover:border-primary/40 hover:bg-muted/40 cursor-pointer",
        )}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <StatusChip
            tone={ACTION_TYPE_TONE[action.type]}
            label={ACTION_TYPE_LABEL[action.type]}
          />
          {decided && (
            <StatusChip
              tone={action.decision === "approved" ? "green" : "red"}
              label={action.decision === "approved" ? "Aprovado" : "Rejeitado"}
            />
          )}
          {action.aiConfidence != null && !decided && (
            <Badge variant="secondary" className="text-xs ml-auto">
              {(action.aiConfidence * 100).toFixed(0)}% conf
            </Badge>
          )}
        </div>

        <p className="text-sm font-medium leading-snug truncate">{taskTitle}</p>

        {action.aiReasoning && (
          <p className="text-xs text-muted-foreground line-clamp-2">{action.aiReasoning}</p>
        )}
      </button>

      <MeetingTaskActionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        action={action as MeetingTaskAction}
        projectId={action.projectId}
        decisionUrl={`/api/planning/${planningId}/actions/${action.id}`}
        onChange={() => {
          setSheetOpen(false);
          onDecide();
        }}
      />
    </>
  );
}
