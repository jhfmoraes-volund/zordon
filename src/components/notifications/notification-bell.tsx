"use client";

import { useMemo, useState } from "react";
import { Bell } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NotificationItem } from "./notification-item";
import type { NotificationItem as NotifData } from "@/hooks/use-notifications";

type DayBucket = "today" | "yesterday" | "this_week" | "older";

const BUCKET_LABEL: Record<DayBucket, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  this_week: "Esta semana",
  older: "Mais antigas",
};

function bucketize(items: NotifData[]): Record<DayBucket, NotifData[]> {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000;

  const buckets: Record<DayBucket, NotifData[]> = {
    today: [],
    yesterday: [],
    this_week: [],
    older: [],
  };
  for (const n of items) {
    const t = new Date(n.createdAt).getTime();
    if (t >= startOfToday) buckets.today.push(n);
    else if (t >= startOfYesterday) buckets.yesterday.push(n);
    else if (t >= startOfWeek) buckets.this_week.push(n);
    else buckets.older.push(n);
  }
  return buckets;
}

export function NotificationBell() {
  const { member } = useAuth();
  const memberId = member?.id ?? null;
  const { items, unreadCount, loading, markRead, markAllRead } =
    useNotifications(memberId);
  const [open, setOpen] = useState(false);

  const buckets = useMemo(() => bucketize(items), [items]);
  const orderedBuckets: DayBucket[] = [
    "today",
    "yesterday",
    "this_week",
    "older",
  ];
  const hasAny = items.length > 0;

  if (!memberId) return null;

  return (
    <ResponsiveSheet open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Notificações"
              className={cn(
                "relative inline-flex size-9 shrink-0 items-center justify-center rounded-md",
                "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              )}
            >
              <Bell className="size-4" />
              {unreadCount > 0 && (
                <span
                  aria-label={`${unreadCount} não lidas`}
                  className={cn(
                    "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center",
                    "rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white",
                    "ring-2 ring-background",
                  )}
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
          }
        />
        <TooltipContent side="bottom">
          {unreadCount > 0
            ? `${unreadCount} não lida${unreadCount === 1 ? "" : "s"}`
            : "Notificações"}
        </TooltipContent>
      </Tooltip>

      <ResponsiveSheetContent size="sm" className="bg-background">
        <ResponsiveSheetHeader className="flex-row items-center justify-between gap-2">
          <ResponsiveSheetTitle>Notificações</ResponsiveSheetTitle>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllRead()}
              className="text-xs"
            >
              Marcar todas como lidas
            </Button>
          )}
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody className="px-0 py-0">
          {loading && !hasAny && (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          )}

          {!loading && !hasAny && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
              <Bell className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Tudo em dia. Sem notificações por aqui.
              </p>
            </div>
          )}

          {hasAny &&
            orderedBuckets.map((bucket) => {
              const bucketItems = buckets[bucket];
              if (bucketItems.length === 0) return null;
              return (
                <section key={bucket}>
                  <header
                    className={cn(
                      "sticky top-0 z-10 border-b border-border bg-muted/40 px-4 py-1.5",
                      "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                      "backdrop-blur",
                    )}
                  >
                    {BUCKET_LABEL[bucket]}
                  </header>
                  {bucketItems.map((item) => (
                    <NotificationItem
                      key={item.id}
                      item={item}
                      onClick={(id) => {
                        markRead(id);
                        setOpen(false);
                      }}
                    />
                  ))}
                </section>
              );
            })}
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
