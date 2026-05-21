"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { NotificationItem as NotifData } from "@/hooks/use-notifications";

type Payload = {
  title?: string;
  snippet?: string;
  projectId?: string;
  fromStatus?: string;
  toStatus?: string;
  count?: number;
  entityIds?: string[];
};

const KIND_VERB: Record<string, string> = {
  mention: "mencionou você em",
  assigned: "atribuiu você a",
  status_changed: "mudou o status de",
  sprint_started: "iniciou",
  sprint_ended: "encerrou",
  agent_task_change: "atualizou",
  granola_auto_import: "importou do Granola",
};

const KIND_LABEL: Record<string, string> = {
  mention: "Menção",
  assigned: "Atribuição",
  status_changed: "Status",
  sprint_started: "Sprint iniciada",
  sprint_ended: "Sprint encerrada",
  agent_task_change: "Alpha",
  granola_auto_import: "Granola",
};

function entityHref(
  entityType: string,
  entityId: string,
  payload: Payload,
): string {
  // No deep-link to task sheets exists today; route to the owning project so
  // the user lands close to context. Sprints use the same project page, where
  // the active sprint widget is in the header area.
  switch (entityType) {
    case "task":
    case "comment":
    case "sprint":
      return payload.projectId ? `/projects/${payload.projectId}` : "/";
    case "meeting":
      // Auto-import lands on the (first) created meeting. When count > 1 the
      // user sees the chip "×N" and can navigate to the others via /meetings
      // afterwards — sending them to a list view on a multi-row click would
      // lose the freshly-ingested notes/todos they'd want to skim first.
      return `/meetings/${entityId}`;
    default:
      return "/";
  }
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "agora";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function NotificationItem({
  item,
  onClick,
}: {
  item: NotifData;
  onClick: (id: string) => void;
}) {
  const payload = (item.payload ?? {}) as Payload;
  const verb = KIND_VERB[item.kind] ?? "";
  const label = KIND_LABEL[item.kind] ?? item.kind;
  const actorName = item.actor?.name ?? "Alpha";
  const isUnread = !item.readAt;
  const count = payload.count ?? 1;
  const href = entityHref(item.entityType, item.entityId, payload);

  return (
    <Link
      href={href}
      onClick={() => onClick(item.id)}
      className={cn(
        "block border-b border-border px-4 py-3 transition-colors",
        "hover:bg-accent/50",
        isUnread && "bg-primary/5",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
            {count > 1 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                ×{count}
              </span>
            )}
            <span className="ml-auto shrink-0 text-muted-foreground">
              {relativeTime(item.createdAt)}
            </span>
          </div>
          <p className="text-sm leading-snug">
            <span className="font-medium">{actorName}</span>{" "}
            <span className="text-muted-foreground">{verb}</span>{" "}
            <span className="font-medium">{payload.title ?? "—"}</span>
          </p>
          {payload.snippet && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {payload.snippet}
            </p>
          )}
          {item.kind === "status_changed" &&
            payload.fromStatus &&
            payload.toStatus && (
              <p className="text-xs text-muted-foreground">
                {payload.fromStatus} → {payload.toStatus}
              </p>
            )}
        </div>
        {isUnread && (
          <span
            aria-hidden
            className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
          />
        )}
      </div>
    </Link>
  );
}
