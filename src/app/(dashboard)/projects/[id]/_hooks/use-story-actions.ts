"use client";

import type { Dispatch, SetStateAction } from "react";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import type { AdaptedStory } from "@/components/story-hierarchy/adapters";
import type { StoryWithRelations } from "@/lib/dal/story-hierarchy";
import type { ProjectMeta } from "../_types";

/**
 * 7 handlers de story + AC-de-story:
 *   - handleCreateStory: cria stub e abre o StorySheet (via setSelectedStoryRef).
 *   - handleStoryPatch: optimistic sobre rawStories + PATCH + reload.
 *   - handleStoryAc{Create,UpdateText,Toggle,Delete}: fetch + reload.
 *   - handleDeleteStory: confirmState compartilhado.
 *
 * selectedStoryRef vive no PAGE (lido pelos useMemos); aqui só recebemos o
 * setter + a leitura pro guard do delete. Veja
 * docs/platform/projects-page-refactor-runbook.md §4.2 e armadilha 3.
 */
export function useStoryActions(args: {
  id: string;
  project: ProjectMeta | null;
  personas: { id: string }[];
  rawStories: StoryWithRelations[];
  setRawStories: Dispatch<SetStateAction<StoryWithRelations[]>>;
  loadStoryHierarchy: () => Promise<void>;
  setConfirmState: (s: import("@/components/ui/confirm-dialog").ConfirmState | null) => void;
  selectedStoryRef: string | null;
  setSelectedStoryRef: (ref: string | null) => void;
}) {
  const {
    id,
    project,
    personas,
    rawStories,
    setRawStories,
    loadStoryHierarchy,
    setConfirmState,
    selectedStoryRef,
    setSelectedStoryRef,
  } = args;

  /**
   * Create a stub story and open the StorySheet on it in edit mode. Mirrors
   * the TaskSheet pattern: the user fills in title/want/persona/module on the
   * form they already know. If it was a misclick, they delete via the row's
   * kebab menu like any other story.
   *
   * `refinementStatus="draft"` is reserved for AI-proposed stories pending
   * human review (revealed only inside the originating Design Session), and is
   * set explicitly by that flow — never by this manual button. Manual stubs
   * nascem 'refined' (default no DAL) e aparecem na lista do projeto na hora.
   */
  async function handleCreateStory() {
    if (!project?.referenceKey) {
      showErrorToast(
        new Error("Project precisa de referenceKey. Configure em Settings."),
        { label: "Não é possível criar story" },
      );
      return;
    }
    try {
      const res = await fetchOrThrow(`/api/projects/${id}/stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Nova story",
          want: "A definir.",
          personaId: personas[0]?.id ?? null,
          moduleId: null,
        }),
      });
      const { story } = (await res.json()) as { story: { reference: string } };
      await loadStoryHierarchy();
      setSelectedStoryRef(story.reference);
    } catch (e) {
      showErrorToast(e, { label: "Falha ao criar story" });
    }
  }

  async function handleStoryPatch(
    storyRef: string,
    patch: Partial<AdaptedStory>,
  ) {
    const dbStory = rawStories.find((s) => s.reference === storyRef);
    if (!dbStory) return;
    // Optimistic — keys in AdaptedStory map 1:1 to rawStory columns. Apply
    // immediately so the sheet's adapted view reflects the edit without
    // waiting for the PATCH + refetch round-trip.
    setRawStories((prev) =>
      prev.map((s) =>
        s.reference === storyRef
          ? ({ ...s, ...patch } as typeof s)
          : s,
      ),
    );
    try {
      await fetchOrThrow(`/api/stories/${storyRef}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar story" });
      await loadStoryHierarchy();
    }
  }

  async function handleStoryAcCreate(
    storyRef: string,
    text: string,
    order: number,
  ) {
    try {
      await fetchOrThrow(`/api/stories/${storyRef}/acceptance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, order }),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Criar critério" });
    }
  }

  async function handleStoryAcUpdateText(
    storyRef: string,
    acId: string,
    text: string,
  ) {
    try {
      await fetchOrThrow(`/api/stories/${storyRef}/acceptance/${acId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Salvar critério" });
    }
  }

  async function handleStoryAcToggle(
    storyRef: string,
    acId: string,
    checked: boolean,
  ) {
    try {
      await fetchOrThrow(`/api/stories/${storyRef}/acceptance/${acId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checked }),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Marcar critério" });
    }
  }

  async function handleStoryAcDelete(storyRef: string, acId: string) {
    try {
      await fetchOrThrow(`/api/stories/${storyRef}/acceptance/${acId}`, {
        method: "DELETE",
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Remover critério" });
    }
  }

  async function handleDeleteStory(storyRef: string) {
    setConfirmState({
      title: `Deletar story ${storyRef}?`,
      description: "Tasks relacionadas serão desvinculadas.",
      confirmLabel: "Deletar",
      destructive: true,
      onConfirm: async () => {
        if (selectedStoryRef === storyRef) setSelectedStoryRef(null);
        try {
          await fetchOrThrow(`/api/stories/${storyRef}`, { method: "DELETE" });
          await loadStoryHierarchy();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao deletar story" });
        }
      },
    });
  }

  return {
    handleCreateStory,
    handleStoryPatch,
    handleStoryAcCreate,
    handleStoryAcUpdateText,
    handleStoryAcToggle,
    handleStoryAcDelete,
    handleDeleteStory,
  };
}
