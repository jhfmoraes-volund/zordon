"use client";

import { useCallback, useEffect, useState } from "react";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow } from "@/lib/optimistic/toast";

export type HypothesisRow = {
  id: string;
  sessionId: string;
  hypothesis: string;
  indicator: string;
  target: string;
  expectedResult: string;
  evidence: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

function base(sessionId: string) {
  return `/api/design-sessions/${sessionId}/hypotheses`;
}

export function useHypotheses(sessionId: string) {
  const collection = useOptimisticCollection<HypothesisRow>([]);
  const { setCommitted, mutate } = collection;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchOrThrow(base(sessionId));
        const json = (await res.json()) as { hypotheses: HypothesisRow[] };
        if (!cancelled) {
          setCommitted(json.hypotheses ?? []);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, setCommitted]);

  const addHypothesis = useCallback(
    async (initial?: Partial<HypothesisRow>) => {
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      const optimisticEntity: HypothesisRow = {
        id: tempId,
        sessionId,
        hypothesis: initial?.hypothesis ?? "",
        indicator: initial?.indicator ?? "",
        target: initial?.target ?? "",
        expectedResult: initial?.expectedResult ?? "",
        evidence: initial?.evidence ?? null,
        orderIndex: collection.items.length,
        createdAt: now,
        updatedAt: now,
      };
      await mutate(
        { type: "create", entity: optimisticEntity },
        async () => {
          const res = await fetchOrThrow(base(sessionId), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              hypothesis: optimisticEntity.hypothesis,
              indicator: optimisticEntity.indicator,
              target: optimisticEntity.target,
              expectedResult: optimisticEntity.expectedResult,
              evidence: optimisticEntity.evidence,
            }),
          });
          return ((await res.json()) as { hypothesis: HypothesisRow }).hypothesis;
        },
        {
          errorLabel: "Falha ao criar hipótese",
          retry: false,
          reconcile: (prev, result) =>
            prev.map((h) => (h.id === tempId ? (result as HypothesisRow) : h)),
        },
      );
    },
    [sessionId, mutate, collection.items.length],
  );

  const updateHypothesis = useCallback(
    async (hypId: string, patch: Partial<HypothesisRow>) => {
      await mutate(
        { type: "patch", id: hypId, patch },
        async () => {
          const res = await fetchOrThrow(`${base(sessionId)}/${hypId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          return ((await res.json()) as { hypothesis: HypothesisRow }).hypothesis;
        },
        { errorLabel: "Falha ao salvar hipótese" },
      );
    },
    [sessionId, mutate],
  );

  const deleteHypothesis = useCallback(
    async (hypId: string) => {
      await mutate(
        { type: "delete", id: hypId },
        async () => {
          await fetchOrThrow(`${base(sessionId)}/${hypId}`, { method: "DELETE" });
          return true;
        },
        { errorLabel: "Falha ao remover hipótese", retry: false },
      );
    },
    [sessionId, mutate],
  );

  return {
    hypotheses: collection.items,
    loaded,
    addHypothesis,
    updateHypothesis,
    deleteHypothesis,
  };
}
