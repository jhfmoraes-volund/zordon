"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TodoSummary } from "@/app/api/me/todos/summary/route";

// Live state card pinned at the top of the notification bell. Reflects the
// member's open to-dos right now — it is NOT a notification (doesn't count
// toward the unread badge, no historical rows). Hidden entirely when there's
// nothing open. The daily Telegram reminder is the nudge; this is the glance.
export function TodoSummaryCard({ open: sheetOpen }: { open: boolean }) {
  const [summary, setSummary] = useState<TodoSummary | null>(null);

  useEffect(() => {
    if (!sheetOpen) return;
    let cancelled = false;
    fetch("/api/me/todos/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TodoSummary | null) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        /* best-effort; card just stays hidden on failure */
      });
    return () => {
      cancelled = true;
    };
  }, [sheetOpen]);

  if (!summary || summary.open === 0) return null;

  const { open, overdue, dueToday } = summary;
  const urgent = overdue > 0;

  // Breakdown line: only surface buckets that have items.
  const parts: string[] = [];
  if (overdue > 0) parts.push(`${overdue} atrasada${overdue === 1 ? "" : "s"}`);
  if (dueToday > 0) parts.push(`${dueToday} vence${dueToday === 1 ? "" : "m"} hoje`);

  return (
    <Link
      href="/profile"
      className={cn(
        "block border-b border-border px-4 py-3 transition-colors hover:bg-accent/50",
        urgent ? "bg-amber-500/5" : "bg-muted/30",
      )}
    >
      <div className="flex items-center gap-3">
        {urgent ? (
          <AlertTriangle className="size-4 shrink-0 text-amber-500" />
        ) : (
          <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Seus to-dos
          </div>
          <p className="text-sm leading-snug">
            <span className="font-medium">
              {open} aberto{open === 1 ? "" : "s"}
            </span>
            {parts.length > 0 && (
              <span className={cn(urgent ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground")}>
                {" · "}
                {parts.join(" · ")}
              </span>
            )}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </div>
    </Link>
  );
}
