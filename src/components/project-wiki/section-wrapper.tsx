"use client";

import { Button } from "@/components/ui/button";
import { Plus, Box } from "lucide-react";
import { SECTION_TITLES, sectionIcons } from "./constants";

export function SectionWrapper({
  title,
  sectionKey,
  children,
  onAdd,
}: {
  title: string;
  sectionKey: string;
  children: React.ReactNode;
  onAdd?: () => void;
}) {
  const Icon = sectionIcons[sectionKey] || Box;
  const displayTitle = SECTION_TITLES[sectionKey] || title;
  return (
    <div className="surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{displayTitle}</h3>
        </div>
        {onAdd && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onAdd}
          >
            <Plus className="mr-1 h-3 w-3" />
            Adicionar
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}
