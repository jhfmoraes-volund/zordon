"use client";

import { FileText, Mic, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtDate as fmtShortDate } from "@/lib/date-utils";

export type ContextLinkItem = {
  id: string;
  title: string | null;
  source: string;
  capturedAt: string | null;
  weight?: "primary" | "supporting" | "background" | null;
};

type Props = {
  items: ContextLinkItem[];
  onRemove?: (id: string, title: string) => void;
  showWeight?: boolean;
  emptyLabel?: string;
  busyId?: string | null;
};

function sourceIcon(source: string) {
  return source === "granola" || source === "roam" ? (
    <Mic className="size-3.5 shrink-0 text-muted-foreground" />
  ) : (
    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
  );
}

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
            {sourceIcon(item.source)}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {item.title ?? "Transcript sem título"}
              </p>
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
