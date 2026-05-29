"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { HierarchyModuleNode } from "./types";

type Props = {
  mod: HierarchyModuleNode;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
};

export function ModuleRow({ mod, expanded, onToggle, children }: Props) {
  const isOrphan = mod.key === "_orphan_";
  const isProposed = mod.key.startsWith("proposed:");

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium truncate">{mod.name}</span>
          {isOrphan && (
            <Badge variant="outline" className="text-[10px] py-0 h-5">
              sem módulo
            </Badge>
          )}
          {isProposed && (
            <Badge
              variant="outline"
              className="text-[10px] py-0 h-5 text-amber-700 dark:text-amber-400 border-amber-500/40"
            >
              proposto
            </Badge>
          )}
          <span className="text-xs text-muted-foreground shrink-0 ml-auto">
            {mod.stories.length}{" "}
            {mod.stories.length === 1 ? "story" : "stories"}
          </span>
        </button>
      </div>

      {expanded && mod.stories.length > 0 && (
        <ul className="border-t divide-y">{children}</ul>
      )}
    </div>
  );
}
