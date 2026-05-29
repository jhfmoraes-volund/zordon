/**
 * Tipo `PlanningAction` — shape devolvido por `GET /api/planning/[id]/actions`.
 *
 * O componente `ProposalRow` que vivia aqui foi removido: agora as propostas
 * aparecem como ghosts/pins dentro da `PlanningTree` (Module → Story → Task),
 * e o click abre `MeetingTaskActionSheet` diretamente. Mantemos só o tipo
 * porque ele é o contrato consumido por `PlanningTree`.
 */

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
