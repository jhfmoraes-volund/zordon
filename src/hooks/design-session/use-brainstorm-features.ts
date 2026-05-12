"use client";

import { useCallback, useEffect, useState } from "react";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow } from "@/lib/optimistic/toast";

export type BrainstormFeatureRow = {
  id: string;
  sessionId: string;
  title: string;
  howItSolves: string | null;
  targetPersona: string | null;
  keyScreens: string | null;
  userFlows: string | null;
  painPointRef: string | null;
  technicalNotes: string | null;
  archived: boolean;
  moduleHint: string | null;
  bucket: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

function base(sessionId: string) {
  return `/api/design-sessions/${sessionId}/brainstorm-features`;
}

export function useBrainstormFeatures(sessionId: string) {
  const collection = useOptimisticCollection<BrainstormFeatureRow>([]);
  const { setCommitted, mutate, items } = collection;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchOrThrow(base(sessionId));
        const json = (await res.json()) as { features: BrainstormFeatureRow[] };
        if (!cancelled) {
          setCommitted(json.features ?? []);
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

  const addFeature = useCallback(
    async (initial: Partial<BrainstormFeatureRow>) => {
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      const optimisticEntity: BrainstormFeatureRow = {
        id: tempId,
        sessionId,
        title: initial.title ?? "",
        howItSolves: initial.howItSolves ?? null,
        targetPersona: initial.targetPersona ?? null,
        keyScreens: initial.keyScreens ?? null,
        userFlows: initial.userFlows ?? null,
        painPointRef: initial.painPointRef ?? null,
        technicalNotes: initial.technicalNotes ?? null,
        archived: initial.archived ?? false,
        moduleHint: initial.moduleHint ?? null,
        bucket: null,
        orderIndex: items.length,
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
              title: optimisticEntity.title,
              howItSolves: optimisticEntity.howItSolves,
              targetPersona: optimisticEntity.targetPersona,
              keyScreens: optimisticEntity.keyScreens,
              userFlows: optimisticEntity.userFlows,
              painPointRef: optimisticEntity.painPointRef,
              technicalNotes: optimisticEntity.technicalNotes,
              archived: optimisticEntity.archived,
            }),
          });
          return ((await res.json()) as { feature: BrainstormFeatureRow }).feature;
        },
        {
          errorLabel: "Falha ao criar feature",
          retry: false,
          reconcile: (prev, result) => {
            const real = result as BrainstormFeatureRow;
            if (prev.some((f) => f.id === tempId)) {
              return prev.map((f) => (f.id === tempId ? real : f));
            }
            if (prev.some((f) => f.id === real.id)) return prev;
            return [...prev, real];
          },
        },
      );
    },
    [sessionId, items.length, mutate],
  );

  const updateFeature = useCallback(
    async (featureId: string, patch: Partial<BrainstormFeatureRow>) => {
      await mutate(
        { type: "patch", id: featureId, patch },
        async () => {
          const res = await fetchOrThrow(`${base(sessionId)}/${featureId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          return ((await res.json()) as { feature: BrainstormFeatureRow }).feature;
        },
        { errorLabel: "Falha ao salvar feature" },
      );
    },
    [sessionId, mutate],
  );

  const deleteFeature = useCallback(
    async (featureId: string) => {
      await mutate(
        { type: "delete", id: featureId },
        async () => {
          await fetchOrThrow(`${base(sessionId)}/${featureId}`, {
            method: "DELETE",
          });
          return true;
        },
        { errorLabel: "Falha ao remover feature", retry: false },
      );
    },
    [sessionId, mutate],
  );

  return {
    features: items,
    loaded,
    addFeature,
    updateFeature,
    deleteFeature,
  };
}
