"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type TelegramStatus = {
  connected: boolean;
  username: string | null;
  connectedAt: string | null;
  kindsDisabled: string[];
  dailyTodosMorningEnabled: boolean;
  dailyTodosEveningEnabled: boolean;
  dailyTodosMorningTime: string; // "HH:MM"
  dailyTodosEveningTime: string; // "HH:MM"
};

const INITIAL: TelegramStatus = {
  connected: false,
  username: null,
  connectedAt: null,
  kindsDisabled: [],
  dailyTodosMorningEnabled: true,
  dailyTodosEveningEnabled: true,
  dailyTodosMorningTime: "08:00",
  dailyTodosEveningTime: "20:00",
};

/**
 * Live status of the current member's Telegram binding. Initial fetch via
 * `/api/me/telegram`, then a Realtime subscription on the Member row updates
 * the card the moment the webhook persists chatId — no polling.
 */
export function useTelegramConnection(memberId: string | null) {
  const [status, setStatus] = useState<TelegramStatus>(INITIAL);
  const [loading, setLoading] = useState(true);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/me/telegram", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as TelegramStatus;
    setStatus(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!memberId) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/me/telegram", { cache: "no-store" });
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as TelegramStatus;
      if (cancelled) return;
      setStatus(data);
      setLoading(false);
    })();

    const supabase = supabaseRef.current ?? createClient();
    supabaseRef.current = supabase;
    const channel = supabase
      .channel(`member-telegram:${memberId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "Member",
          filter: `id=eq.${memberId}`,
        },
        (payload) => {
          const row = payload.new as {
            telegramChatId: number | null;
            telegramUsername: string | null;
            telegramConnectedAt: string | null;
            telegramKindsDisabled: string[] | null;
            dailyTodosMorningEnabled: boolean | null;
            dailyTodosEveningEnabled: boolean | null;
            dailyTodosMorningTime: string | null;
            dailyTodosEveningTime: string | null;
          };
          setStatus((prev) => ({
            connected: !!row.telegramChatId,
            username: row.telegramUsername,
            connectedAt: row.telegramConnectedAt,
            kindsDisabled: row.telegramKindsDisabled ?? [],
            dailyTodosMorningEnabled:
              row.dailyTodosMorningEnabled ?? prev.dailyTodosMorningEnabled,
            dailyTodosEveningEnabled:
              row.dailyTodosEveningEnabled ?? prev.dailyTodosEveningEnabled,
            dailyTodosMorningTime: row.dailyTodosMorningTime
              ? row.dailyTodosMorningTime.slice(0, 5)
              : prev.dailyTodosMorningTime,
            dailyTodosEveningTime: row.dailyTodosEveningTime
              ? row.dailyTodosEveningTime.slice(0, 5)
              : prev.dailyTodosEveningTime,
          }));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [memberId]);

  return { status, loading, refresh, setStatus };
}
