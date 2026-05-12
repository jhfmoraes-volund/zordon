"use client";

import { useCallback, useEffect, useState } from "react";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow } from "@/lib/optimistic/toast";
import type { StepKey, StickyNote } from "@/lib/design-session/types";

type DraftNote = StickyNote & { _local?: boolean };

function base(sessionId: string, stepKey: StepKey) {
  return `/api/design-sessions/${sessionId}/steps/${stepKey}/notes`;
}

export function useStepNotes(sessionId: string, stepKey: StepKey) {
  const collection = useOptimisticCollection<DraftNote>([]);
  const { setCommitted, mutate } = collection;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchOrThrow(base(sessionId, stepKey));
        const json = (await res.json()) as { notes: StickyNote[] };
        if (!cancelled) {
          setCommitted(json.notes ?? []);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, stepKey, setCommitted]);

  const addNote = useCallback(async () => {
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const optimisticEntity: DraftNote = {
      id: tempId,
      sessionId,
      stepKey,
      text: "",
      orderIndex: collection.items.length,
      createdAt: now,
      updatedAt: now,
      _local: true,
    };
    await mutate(
      { type: "create", entity: optimisticEntity },
      async () => {
        const res = await fetchOrThrow(base(sessionId, stepKey), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "" }),
        });
        return ((await res.json()) as { note: StickyNote }).note;
      },
      {
        errorLabel: "Falha ao criar anotação",
        retry: false,
        reconcile: (prev, result) =>
          prev.map((n) => (n.id === tempId ? (result as StickyNote) : n)),
      },
    );
  }, [sessionId, stepKey, mutate, collection.items.length]);

  const updateNote = useCallback(
    async (noteId: string, text: string) => {
      await mutate(
        { type: "patch", id: noteId, patch: { text } },
        async () => {
          const res = await fetchOrThrow(`${base(sessionId, stepKey)}/${noteId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          return ((await res.json()) as { note: StickyNote }).note;
        },
        { errorLabel: "Falha ao salvar anotação" },
      );
    },
    [sessionId, stepKey, mutate],
  );

  const deleteNote = useCallback(
    async (noteId: string) => {
      await mutate(
        { type: "delete", id: noteId },
        async () => {
          await fetchOrThrow(`${base(sessionId, stepKey)}/${noteId}`, {
            method: "DELETE",
          });
          return true;
        },
        { errorLabel: "Falha ao apagar anotação", retry: false },
      );
    },
    [sessionId, stepKey, mutate],
  );

  return {
    notes: collection.items,
    loaded,
    addNote,
    updateNote,
    deleteNote,
  };
}
