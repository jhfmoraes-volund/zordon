"use client";

import { useCallback, useEffect, useState } from "react";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow } from "@/lib/optimistic/toast";

export type JourneyStep = {
  id: string;
  description: string;
  painOrGain: string;
};

export type PersonaRow = {
  id: string;
  sessionId: string;
  name: string;
  role: string;
  context: string;
  asIsSteps: JourneyStep[];
  toBeSteps: JourneyStep[];
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

function base(sessionId: string) {
  return `/api/design-sessions/${sessionId}/personas`;
}

export function usePersonas(sessionId: string) {
  const collection = useOptimisticCollection<PersonaRow>([]);
  const { setCommitted, mutate, items } = collection;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchOrThrow(base(sessionId));
        const json = (await res.json()) as { personas: PersonaRow[] };
        if (!cancelled) {
          setCommitted(json.personas ?? []);
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

  const addPersona = useCallback(
    async (initial: Partial<PersonaRow>) => {
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      const optimisticEntity: PersonaRow = {
        id: tempId,
        sessionId,
        name: initial.name ?? "",
        role: initial.role ?? "",
        context: initial.context ?? "",
        asIsSteps: initial.asIsSteps ?? [],
        toBeSteps: initial.toBeSteps ?? [],
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
              name: optimisticEntity.name,
              role: optimisticEntity.role,
              context: optimisticEntity.context,
              asIsSteps: optimisticEntity.asIsSteps,
              toBeSteps: optimisticEntity.toBeSteps,
            }),
          });
          return ((await res.json()) as { persona: PersonaRow }).persona;
        },
        {
          errorLabel: "Falha ao criar persona",
          retry: false,
          reconcile: (prev, result) => {
            const real = result as PersonaRow;
            if (prev.some((p) => p.id === tempId)) {
              return prev.map((p) => (p.id === tempId ? real : p));
            }
            if (prev.some((p) => p.id === real.id)) return prev;
            return [...prev, real];
          },
        },
      );
    },
    [sessionId, items.length, mutate],
  );

  const updatePersona = useCallback(
    async (personaId: string, patch: Partial<PersonaRow>) => {
      await mutate(
        { type: "patch", id: personaId, patch },
        async () => {
          const res = await fetchOrThrow(`${base(sessionId)}/${personaId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          return ((await res.json()) as { persona: PersonaRow }).persona;
        },
        { errorLabel: "Falha ao salvar persona" },
      );
    },
    [sessionId, mutate],
  );

  const deletePersona = useCallback(
    async (personaId: string) => {
      await mutate(
        { type: "delete", id: personaId },
        async () => {
          await fetchOrThrow(`${base(sessionId)}/${personaId}`, {
            method: "DELETE",
          });
          return true;
        },
        { errorLabel: "Falha ao remover persona", retry: false },
      );
    },
    [sessionId, mutate],
  );

  return {
    personas: items,
    loaded,
    addPersona,
    updatePersona,
    deletePersona,
  };
}
