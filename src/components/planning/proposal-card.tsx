/**
 * Tipo `PlanningAction` — shape devolvido por `GET /api/planning/[id]/actions`.
 *
 * O componente `ProposalRow` que vivia aqui foi removido: agora as propostas
 * aparecem como ghosts/pins dentro da `PlanningTree` (Module → Story → Task),
 * e o click abre `MeetingTaskActionSheet` diretamente. Mantemos só o tipo
 * porque ele é o contrato consumido por `PlanningTree`.
 */

type ActionType = "create" | "update" | "delete" | "move" | "review";
type EntityType = "task" | "story" | "module";

export type PlanningAction = {
  id: string;
  /** Discriminador polimórfico. Ausente em rows antigas = "task". */
  entityType?: EntityType;
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
  storyId: string | null;
  moduleId: string | null;
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
  story?: {
    id: string;
    reference: string | null;
    title: string;
    refinementStatus: string;
  } | null;
  module?: {
    id: string;
    name: string;
  } | null;
};

/**
 * Resumo humano de uma proposta de story/módulo, pro card do canvas. Espelha o
 * que o executor vai aplicar (entityType + type + payload).
 */
export function describeEntityProposal(a: PlanningAction): string {
  const p = a.payload ?? {};
  if (a.entityType === "module") {
    const name = (p.proposedName as string) ?? (p.proposedModuleName as string) ?? "?";
    return `Aprovar módulo "${name}" — materializa e consolida as stories`;
  }
  // story
  const ref = a.story?.reference ?? "nova story";
  if (a.type === "create") {
    return `Nova story: "${(p.title as string) ?? "?"}"`;
  }
  const parts: string[] = [];
  if (p.refinementStatus === "committed") parts.push("commitar (travar)");
  if (p.refinementStatus === "draft") parts.push("reabrir (draft)");
  if (p.moduleId) parts.push("carimbar módulo");
  if (typeof p.proposedModuleName === "string" && p.proposedModuleName)
    parts.push(`propor módulo "${p.proposedModuleName}"`);
  if (Array.isArray(p.acceptanceCriteria))
    parts.push(`reescrever AC (${(p.acceptanceCriteria as unknown[]).length})`);
  if ("title" in p || "want" in p || "soThat" in p) parts.push("editar narrativa");
  return `${ref}: ${parts.length ? parts.join(", ") : "atualizar"}`;
}
