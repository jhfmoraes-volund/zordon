"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow } from "@/lib/optimistic/toast";

export type PriorityBucket = "mvp" | "next" | "out";

export type PriorityItemRow = {
  id: string;
  sessionId: string;
  title: string;
  howItSolves: string;
  targetPersona: string;
  bucket: PriorityBucket;
  keyScreens: string | null;
  userFlows: string | null;
  painPointRef: string | null;
  technicalNotes: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

function base(sessionId: string) {
  return `/api/design-sessions/${sessionId}/priority-items`;
}

export function usePriorityItems(sessionId: string) {
  const collection = useOptimisticCollection<PriorityItemRow>([]);
  const { setCommitted, mutate, items } = collection;
  const [loaded, setLoaded] = useState(false);
  const seededRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchOrThrow(base(sessionId));
        const json = (await res.json()) as { items: PriorityItemRow[] };
        if (cancelled) return;
        const list = json.items ?? [];

        // First-time seed: if no items exist yet, populate from BrainstormFeature.
        if (list.length === 0 && !seededRef.current) {
          seededRef.current = true;
          try {
            const seedRes = await fetchOrThrow(`${base(sessionId)}/seed-from-brainstorm`, {
              method: "POST",
            });
            const seedJson = (await seedRes.json()) as { items?: PriorityItemRow[] };
            if (!cancelled) setCommitted(seedJson.items ?? []);
          } catch {
            if (!cancelled) setCommitted([]);
          }
        } else {
          setCommitted(list);
        }
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, setCommitted]);

  const updateItem = useCallback(
    async (itemId: string, patch: Partial<PriorityItemRow>) => {
      await mutate(
        { type: "patch", id: itemId, patch },
        async () => {
          const res = await fetchOrThrow(`${base(sessionId)}/${itemId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          return ((await res.json()) as { item: PriorityItemRow }).item;
        },
        { errorLabel: "Falha ao salvar item" },
      );
    },
    [sessionId, mutate],
  );

  const deleteItem = useCallback(
    async (itemId: string) => {
      await mutate(
        { type: "delete", id: itemId },
        async () => {
          await fetchOrThrow(`${base(sessionId)}/${itemId}`, { method: "DELETE" });
          return true;
        },
        { errorLabel: "Falha ao remover item", retry: false },
      );
    },
    [sessionId, mutate],
  );

  return {
    items,
    loaded,
    updateItem,
    deleteItem,
  };
}
