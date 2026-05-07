"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type NotificationRow = Database["public"]["Tables"]["Notification"]["Row"];

export type NotificationItem = NotificationRow & {
  actor: { id: string; name: string | null } | null;
};

type ApiResponse = {
  notifications: NotificationItem[];
  unreadCount: number;
};

/**
 * Bell + sheet data hook. Loads the most recent page on mount, subscribes to
 * Realtime INSERT/UPDATE on Notification (filtered by recipient), and exposes
 * `markRead` / `markAllRead` that hit the API and reflect optimistically.
 *
 * Realtime filter is applied client-side because Supabase realtime filters use
 * eq.<col>.<val> syntax on the publication; recipientMemberId is the only
 * filter we need and the RLS policy already restricts what the channel sees.
 */
export function useNotifications(memberId: string | null) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/notifications", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as ApiResponse;
    setItems(data.notifications);
    setUnread(data.unreadCount);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!memberId) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as ApiResponse;
      if (cancelled) return;
      setItems(data.notifications);
      setUnread(data.unreadCount);
      setLoading(false);
    })();

    const supabase = supabaseRef.current ?? createClient();
    supabaseRef.current = supabase;
    const channel = supabase
      .channel(`notifications:${memberId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "Notification",
          filter: `recipientMemberId=eq.${memberId}`,
        },
        () => {
          void refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "Notification",
          filter: `recipientMemberId=eq.${memberId}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [memberId, refresh]);

  const markRead = useCallback(
    async (id: string) => {
      setItems((prev) =>
        prev.map((n) =>
          n.id === id && !n.readAt
            ? { ...n, readAt: new Date().toISOString() }
            : n,
        ),
      );
      setUnread((u) => Math.max(0, u - 1));
      await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    },
    [],
  );

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    setUnread(0);
    await fetch("/api/notifications/read-all", { method: "POST" });
  }, []);

  return { items, unreadCount: unread, loading, markRead, markAllRead, refresh };
}
