"use client";

import {
  useOptimisticCollection,
  type BaseMutation,
} from "@/hooks/use-optimistic-collection";
import { fetchOrThrow } from "@/lib/optimistic/toast";
import type {
  OpenSourceCardRow,
  OpenSourceCardInput,
  UpdateOpenSourceCardInput,
} from "@/lib/dal/open-source";

function tempCard(input: OpenSourceCardInput, id: string): OpenSourceCardRow {
  const now = new Date().toISOString();
  return {
    id,
    archiveNumber: 0,
    category: input.category ?? "ENDOMARKETING",
    name: input.name,
    title: input.title ?? null,
    photoStoragePath: input.photoStoragePath ?? null,
    photoUpdatedAt: input.photoUpdatedAt ?? null,
    tags: input.tags ?? [],
    quote: input.quote ?? null,
    quoteAttribution: input.quoteAttribution ?? null,
    humanFacts: input.humanFacts ?? [],
    builderFacts: input.builderFacts ?? [],
    callMeFor: input.callMeFor ?? [],
    chat: input.chat ?? [],
    truthsAndLie: input.truthsAndLie ?? [],
    soundtrack: input.soundtrack ?? [],
    displayOrder: input.displayOrder ?? null,
    isPublished: input.isPublished ?? true,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function useOpenSource(initial: OpenSourceCardRow[]) {
  const { items, mutate, isPending, setCommitted } =
    useOptimisticCollection<OpenSourceCardRow>(initial);

  async function create(input: OpenSourceCardInput) {
    const tempId = `os-tmp-${Date.now()}`;
    return mutate(
      { type: "create", entity: tempCard(input, tempId) } as BaseMutation<OpenSourceCardRow>,
      async (signal) => {
        const res = await fetchOrThrow("/api/open-source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal,
        });
        return ((await res.json()) as { card: OpenSourceCardRow }).card;
      },
      {
        errorLabel: "Criar card",
        reconcile: (prev, result) => [
          ...prev.filter((c) => c.id !== tempId),
          result,
        ],
      },
    );
  }

  async function patch(id: string, input: UpdateOpenSourceCardInput) {
    return mutate(
      { type: "patch", id, patch: input as Partial<OpenSourceCardRow> },
      async (signal) => {
        const res = await fetchOrThrow(`/api/open-source/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal,
        });
        return ((await res.json()) as { card: OpenSourceCardRow }).card;
      },
      {
        errorLabel: "Atualizar card",
        reconcile: (prev, result) =>
          prev.map((c) => (c.id === id ? result : c)),
      },
    );
  }

  async function remove(id: string) {
    return mutate(
      { type: "delete", id },
      async (signal) => {
        await fetchOrThrow(`/api/open-source/${id}`, {
          method: "DELETE",
          signal,
        });
        return { ok: true };
      },
      {
        errorLabel: "Excluir card",
        reconcile: (prev) => prev.filter((c) => c.id !== id),
      },
    );
  }

  return { cards: items, isPending, setCommitted, create, patch, remove };
}
