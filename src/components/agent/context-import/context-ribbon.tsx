"use client";

import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";

export interface ContextRibbonProps {
  counts: {
    transcripts: number;
    files?: number;
    notes?: number;
  };
  onOpenInsumos: () => void;
  actions?: Array<{
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    onClick: () => void;
  }>;
}

export default function ContextRibbon({
  counts,
  onOpenInsumos,
  actions,
}: ContextRibbonProps) {
  const parts: string[] = [];

  if (counts.transcripts > 0) {
    parts.push(
      `${counts.transcripts} transcript${counts.transcripts === 1 ? "" : "s"}`
    );
  }

  if (counts.files !== undefined && counts.files > 0) {
    parts.push(`${counts.files} arquivo${counts.files === 1 ? "" : "s"}`);
  }

  if (counts.notes !== undefined && counts.notes > 0) {
    parts.push(`${counts.notes} nota${counts.notes === 1 ? "" : "s"}`);
  }

  const summaryText =
    parts.length > 0 ? parts.join(" · ") : "Nenhum insumo linkado";

  return (
    <div className="flex h-9 items-center justify-between border-b px-3 text-sm">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="hidden text-muted-foreground sm:inline">
          {summaryText}
        </span>
        <span className="text-muted-foreground sm:hidden">
          {counts.transcripts > 0 && `${counts.transcripts}T`}
          {counts.files !== undefined && counts.files > 0 && ` ${counts.files}A`}
          {counts.notes !== undefined && counts.notes > 0 && ` ${counts.notes}N`}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {actions?.map((action, idx) => {
          const Icon = action.icon;
          return (
            <Button
              key={idx}
              variant="ghost"
              size="sm"
              onClick={action.onClick}
              className="h-7 px-2"
            >
              <Icon className="h-4 w-4" />
              <span className="ml-1.5 hidden sm:inline">{action.label}</span>
            </Button>
          );
        })}

        <Button variant="ghost" size="sm" onClick={onOpenInsumos} className="h-7">
          <FileText className="mr-1.5 h-4 w-4" />
          Insumos
        </Button>
      </div>
    </div>
  );
}
