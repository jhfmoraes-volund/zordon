"use client";

import { FileText, Mic, Unlink, FileSpreadsheet, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtDate as fmtShortDate } from "@/lib/date-utils";
import type { Database } from "@/lib/supabase/database.types";

export type ContextLinkItem = {
  id: string;
  title: string | null;
  source: string;
  capturedAt: string | null;
  weight?: "primary" | "supporting" | "background" | null;
  kind?: Database["public"]["Enums"]["context_source_kind"];
};

type Props = {
  items: ContextLinkItem[];
  onRemove?: (id: string, title: string) => void;
  showWeight?: boolean;
  emptyLabel?: string;
  busyId?: string | null;
};

function sourceIcon(source: string, kind?: Database["public"]["Enums"]["context_source_kind"]) {
  if (kind === "transcript" || source === "granola" || source === "roam") {
    return <Mic className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  if (kind === "spreadsheet_csv" || kind === "spreadsheet_gsheets") {
    return <FileSpreadsheet className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  if (kind === "github_repo" || kind === "github_pr" || kind === "github_issue") {
    return <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return <FileText className="size-3.5 shrink-0 text-muted-foreground" />;
}

const KIND_BADGE: Record<Database["public"]["Enums"]["context_source_kind"], string> = {
  transcript: "Transcrição",
  meeting: "Reunião",
  spreadsheet_csv: "CSV",
  spreadsheet_gsheets: "GSheets",
  github_repo: "GitHub Repo",
  github_pr: "PR",
  github_issue: "Issue",
  document: "Documento",
  notion: "Notion",
};

export default function ContextLinkList({
  items,
  onRemove,
  showWeight = false,
  emptyLabel = "Nenhum item linkado.",
  busyId = null,
}: Props) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {items.map((item) => {
        const isBusy = busyId === item.id;
        return (
          <li
            key={item.id}
            className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs"
          >
            {sourceIcon(item.source, item.kind)}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate font-medium">
                  {item.title ?? "Transcript sem título"}
                </p>
                {item.kind && (
                  <Badge variant="secondary" className="h-4 px-1.5 text-[9px] leading-none shrink-0">
                    {KIND_BADGE[item.kind]}
                  </Badge>
                )}
              </div>
              <p className="truncate text-[10px] text-muted-foreground">
                {item.source}
                {item.capturedAt && ` · ${fmtShortDate(item.capturedAt)}`}
                {showWeight && item.weight && ` · ${item.weight}`}
              </p>
            </div>
            {onRemove && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onRemove(item.id, item.title ?? "transcript")}
                disabled={isBusy}
              >
                <Unlink className="size-3" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
