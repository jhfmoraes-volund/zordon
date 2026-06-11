"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Box, Check, ChevronDown, Pencil } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
} from "@/components/ui/responsive-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SECTION_ORDER, SECTION_TITLES, sectionIcons } from "./constants";
import { sectionComponentMap } from "./section-map";
import type { WikiSection } from "./types";

type Props = {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProjectWikiSheet({
  projectId,
  projectName,
  open,
  onOpenChange,
}: Props) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Wiki — {projectName}</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>
        <ResponsiveSheetBody>
          {/* Remount a cada abertura: estado fresco + refetch sem cache stale */}
          {open && <WikiSheetContent projectId={projectId} />}
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function WikiSheetContent({ projectId }: { projectId: string }) {
  const [sections, setSections] = useState<WikiSection[] | null>(null);
  const [openKeys, setOpenKeys] = useState<Set<string>>(
    () => new Set(["description"])
  );
  const [editKeys, setEditKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/wiki`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSections(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("Erro ao carregar wiki");
          setSections([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const updateSection = useCallback(
    async (sectionKey: string, data: unknown) => {
      const res = await fetch(
        `/api/projects/${projectId}/wiki/${sectionKey}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data }),
        }
      );
      if (!res.ok) throw new Error("Failed to save");
    },
    [projectId]
  );

  const toggleOpen = (key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleEdit = (key: string) => {
    setEditKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // Editar uma seção fechada não faz sentido — garante aberta.
    setOpenKeys((prev) => new Set(prev).add(key));
  };

  if (!sections) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const sorted = [...sections].sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a.sectionKey);
    const bi = SECTION_ORDER.indexOf(b.sectionKey);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div className="space-y-2">
      {sorted.map((section) => {
        const Component = sectionComponentMap[section.sectionKey];
        if (!Component) return null;
        const key = section.sectionKey;
        const Icon = sectionIcons[key] || Box;
        const isOpen = openKeys.has(key);
        const isEditing = editKeys.has(key);
        return (
          <div key={section.id} className="surface overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3">
              <button
                type="button"
                className="flex flex-1 items-center gap-2 text-left"
                onClick={() => toggleOpen(key)}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">
                  {SECTION_TITLES[key] || section.title}
                </h3>
              </button>
              <button
                type="button"
                title={isEditing ? "Concluir edição" : "Editar seção"}
                className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                onClick={() => toggleEdit(key)}
              >
                {isEditing ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Pencil className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                onClick={() => toggleOpen(key)}
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    isOpen && "rotate-180"
                  )}
                />
              </button>
            </div>
            {isOpen && (
              <div className="border-t px-4 py-3">
                <Component
                  section={section}
                  onUpdate={(data: unknown) => updateSection(key, data)}
                  mode={isEditing ? "edit" : "read"}
                  hideHeader
                />
              </div>
            )}
          </div>
        );
      })}
      {sorted.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Wiki sem seções pra este projeto.
        </p>
      )}
    </div>
  );
}
