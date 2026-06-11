"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { TiptapEditor } from "@/components/tiptap-editor";
import { SectionWrapper } from "./section-wrapper";
import type { SectionProps } from "./types";

export function DescriptionSection({
  section,
  onUpdate,
  mode = "edit",
  hideHeader,
}: SectionProps) {
  const data = section.data as { html?: string } | null;
  const initialHtml = data?.html || "";

  const handleUpdate = useCallback(
    async (html: string) => {
      try {
        await onUpdate({ html });
        toast.success("Salvo", { id: "wiki-save" });
      } catch {
        toast.error("Erro ao salvar", { id: "wiki-save" });
      }
    },
    [onUpdate]
  );

  return (
    <SectionWrapper
      title={section.title}
      sectionKey="description"
      hideHeader={hideHeader}
    >
      {mode === "read" ? (
        initialHtml ? (
          <div
            className="prose prose-invert prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: initialHtml }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Sem descrição.</p>
        )
      ) : (
        <TiptapEditor
          content={initialHtml}
          onUpdate={handleUpdate}
          placeholder="Descreva o projeto — visão geral, contexto, motivação..."
        />
      )}
    </SectionWrapper>
  );
}
