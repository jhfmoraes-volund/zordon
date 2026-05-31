"use client";

import {
  useOptimisticCollection,
  combineReducers,
  type AnyMutation,
  type BaseMutation,
} from "@/hooks/use-optimistic-collection";
import type { OpportunityRow } from "@/lib/dal/opportunities";

// Custom mutations beyond base (create, patch, delete)
type CustomMutation =
  | { type: "softReject"; id: string }
  | { type: "promote"; id: string; projectId: string; designSessionId: string };

type OpportunityMutation = AnyMutation<OpportunityRow, CustomMutation>;

function opportunityReducer(
  state: OpportunityRow[],
  m: CustomMutation,
): OpportunityRow[] | undefined {
  switch (m.type) {
    case "softReject":
      return state.map((opp) =>
        opp.id === m.id ? { ...opp, status: "rejected" as const } : opp,
      );
    case "promote":
      return state.map((opp) =>
        opp.id === m.id
          ? {
              ...opp,
              status: "in_project" as const,
              promotedProjectId: m.projectId,
            }
          : opp,
      );
    default:
      return undefined;
  }
}

export function useOpportunities(clientId: string, initial: OpportunityRow[]) {
  const { items, mutate, isPending, setCommitted } = useOptimisticCollection<
    OpportunityRow,
    CustomMutation
  >(initial, combineReducers(opportunityReducer));

  // ─── Create ────────────────────────────────────────────────────────────────

  async function create(input: {
    title: string;
    description?: string | null;
    impact: number;
    effort: number;
    status?: OpportunityRow["status"];
    createdBy: string;
  }) {
    const tempId = `opp-tmp-${Date.now()}`;
    const tempOpp: OpportunityRow = {
      id: tempId,
      clientId,
      title: input.title,
      description: input.description ?? null,
      impact: input.impact,
      effort: input.effort,
      status: input.status ?? "discovery",
      priorityRank: null,
      sourceMeetingId: null,
      sourceDesignSessionId: null,
      sourceTranscriptRefId: null,
      promotedProjectId: null,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return mutate(
      { type: "create", entity: tempOpp } as BaseMutation<OpportunityRow>,
      async (signal) => {
        const res = await fetch(`/api/clients/${clientId}/opportunities`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao criar oportunidade");
        }
        return (await res.json()) as OpportunityRow;
      },
      {
        errorLabel: "Criar oportunidade",
        // Reconcile: filter temp + append real (not map) — per feedback_optimistic_reconcile_create
        reconcile: (prev, result) => [
          ...prev.filter((o) => o.id !== tempId),
          result,
        ],
      },
    );
  }

  // ─── Patch ─────────────────────────────────────────────────────────────────

  async function patch(
    id: string,
    partialUpdate: Partial<{
      title: string;
      description: string | null;
      impact: number;
      effort: number;
      status: OpportunityRow["status"];
      priorityRank: number | null;
    }>,
  ) {
    return mutate(
      { type: "patch", id, patch: partialUpdate },
      async (signal) => {
        const res = await fetch(`/api/opportunities/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(partialUpdate),
          signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao atualizar oportunidade");
        }
        return (await res.json()) as OpportunityRow;
      },
      { errorLabel: "Atualizar oportunidade" },
    );
  }

  // ─── Soft Reject ───────────────────────────────────────────────────────────

  async function softReject(id: string) {
    return mutate(
      { type: "softReject", id },
      async (signal) => {
        const res = await fetch(`/api/opportunities/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "rejected" }),
          signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao rejeitar oportunidade");
        }
        return (await res.json()) as OpportunityRow;
      },
      { errorLabel: "Rejeitar oportunidade" },
    );
  }

  // ─── Promote ───────────────────────────────────────────────────────────────

  async function promote(id: string, projectName?: string) {
    return mutate(
      {
        type: "promote",
        id,
        // Placeholder IDs — will be replaced by reconcile with server response
        projectId: "",
        designSessionId: "",
      },
      async (signal) => {
        const res = await fetch(`/api/opportunities/${id}/promote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectName }),
          signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Falha ao promover oportunidade");
        }
        return (await res.json()) as {
          projectId: string;
          designSessionId: string;
        };
      },
      {
        errorLabel: "Promover oportunidade",
        // After server returns real IDs, update the opportunity with correct projectId
        reconcile: (prev, result) =>
          prev.map((o) =>
            o.id === id
              ? {
                  ...o,
                  status: "in_project" as const,
                  promotedProjectId: result.projectId,
                }
              : o,
          ),
      },
    );
  }

  return {
    opportunities: items,
    isPending,
    setCommitted,
    create,
    patch,
    softReject,
    promote,
  };
}
