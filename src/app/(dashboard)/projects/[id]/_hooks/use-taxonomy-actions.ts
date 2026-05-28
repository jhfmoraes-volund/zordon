"use client";

import { useState } from "react";
import { type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import type { AdaptedStory } from "@/components/story-hierarchy/adapters";

/**
 * Estado de UI (dialogs inline de módulo/persona) + handlers de taxonomia:
 * promote-proposed-module, validate-ac, e CRUD de Module/Persona.
 *
 * Todos os handlers são fetch + reload (sem optimistic). Os deletes setam o
 * `confirmState` compartilhado do page — por isso `setConfirmState` chega como
 * dependência. Veja docs/platform/projects-page-refactor-runbook.md §4.4.
 */
export function useTaxonomyActions(args: {
  id: string;
  loadStoryHierarchy: () => Promise<void>;
  setConfirmState: (s: ConfirmState | null) => void;
}) {
  const { id, loadStoryHierarchy, setConfirmState } = args;

  const [moduleDialog, setModuleDialog] = useState<{
    open: boolean;
    suggested?: string;
  }>({ open: false });
  const [personaDialog, setPersonaDialog] = useState<{ open: boolean }>({
    open: false,
  });

  async function handleApproveProposedModule(story: AdaptedStory) {
    if (!story.proposedModuleName) return;
    try {
      await fetchOrThrow(
        `/api/stories/${story.reference}/promote-proposed-module`,
        { method: "POST" },
      );
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao promover módulo" });
    }
  }

  async function handleValidateAc(story: AdaptedStory) {
    try {
      await fetchOrThrow(`/api/stories/${story.reference}/validate-ac`, {
        method: "POST",
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao validar AC" });
    }
  }

  async function handleCreateModule(data: {
    name: string;
    description?: string;
  }) {
    try {
      await fetchOrThrow(`/api/projects/${id}/modules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao criar módulo" });
    }
  }

  async function handleUpdateModule(
    modId: string,
    data: { name?: string; description?: string },
  ) {
    try {
      await fetchOrThrow(`/api/projects/${id}/modules/${modId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao editar módulo" });
    }
  }

  async function handleDeleteModule(modId: string) {
    setConfirmState({
      title: "Deletar módulo?",
      confirmLabel: "Deletar",
      destructive: true,
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/projects/${id}/modules/${modId}`, {
            method: "DELETE",
          });
          await loadStoryHierarchy();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao deletar módulo" });
        }
      },
    });
  }

  async function handleCreatePersona(data: {
    name: string;
    description?: string;
  }) {
    try {
      await fetchOrThrow(`/api/projects/${id}/personas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao criar persona" });
    }
  }

  async function handleUpdatePersona(
    perId: string,
    data: { name?: string; description?: string },
  ) {
    try {
      await fetchOrThrow(`/api/projects/${id}/personas/${perId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await loadStoryHierarchy();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao editar persona" });
    }
  }

  async function handleDeletePersona(perId: string) {
    setConfirmState({
      title: "Deletar persona?",
      confirmLabel: "Deletar",
      destructive: true,
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/projects/${id}/personas/${perId}`, {
            method: "DELETE",
          });
          await loadStoryHierarchy();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao deletar persona" });
        }
      },
    });
  }

  return {
    moduleDialog,
    setModuleDialog,
    personaDialog,
    setPersonaDialog,
    handleApproveProposedModule,
    handleValidateAc,
    handleCreateModule,
    handleUpdateModule,
    handleDeleteModule,
    handleCreatePersona,
    handleUpdatePersona,
    handleDeletePersona,
  };
}
