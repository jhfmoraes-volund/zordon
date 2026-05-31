"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { Badge } from "@/components/ui/badge";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type ForgeEvent = Database["public"]["Tables"]["ForgeEvent"]["Row"];

type ConnectionState = "connecting" | "realtime" | "polling" | "disconnected";

const KIND_COLORS: Record<string, string> = {
  started: "#26a69a",
  story_loaded: "#5c6bc0",
  prompt_built: "#5c6bc0",
  status: "#999",
  spawning: "#999",
  assistant_text: "#0ff",
  tool_use: "#ffeb3b",
  tool_result: "#81c784",
  raw_stdout: "#aaa",
  stderr: "#ff8a65",
  claude_system: "#9575cd",
  claude_result: "#26c6da",
  claude_closed: "#26c6da",
  claude_other: "#888",
  error: "#ef5350",
  done: "#66bb6a",
  stream_open: "#9e9e9e",
};

function formatPayloadSummary(kind: string, payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;

  if (kind === "tool_use") {
    return `${p.tool}: ${p.inputSummary ?? ""}`;
  }
  if (kind === "tool_result") {
    return p.isError
      ? `❌ ${String(p.preview ?? "")}`
      : `${String(p.preview ?? "")}`;
  }
  if (kind === "assistant_text") {
    return String(p.text ?? "");
  }
  if (kind === "story_loaded") {
    return `${p.id} · ${p.title} (${p.profile ?? "?"}, ${p.estimateMinutes ?? "?"}min)`;
  }
  if (kind === "done") {
    return p.ok ? `✓ ok · ${p.totalEvents} events` : `✗ failed (exit ${p.exitCode})`;
  }
  if (kind === "claude_closed") {
    return `exit ${p.exitCode}`;
  }
  if (kind === "error") {
    return String(p.message ?? "");
  }
  if (kind === "started") {
    return `pid=${p.pid} · ${p.prdSlug}/${p.storyId}`;
  }
  return JSON.stringify(payload).slice(0, 200);
}

type Props = {
  runId: string;
  maxRendered?: number;
};

export function RunEventStream({ runId, maxRendered = 5000 }: Props) {
  const [events, setEvents] = useState<ForgeEvent[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [capReached, setCapReached] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const fetchEvents = async () => {
      try {
        const res = await fetch(`/api/forge/runs/${runId}/events`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { events: ForgeEvent[] };
        if (cancelled) return;

        const limited = data.events.slice(0, maxRendered);
        setEvents(limited);
        setCapReached(data.events.length > maxRendered);
      } catch (err) {
        console.error("[RunEventStream] fetch failed:", err);
        if (!cancelled) {
          setConnectionState("disconnected");
        }
      }
    };

    // Initial fetch
    fetchEvents();

    // Setup Realtime subscription
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      // No Realtime available, use polling
      setTimeout(() => {
        if (!cancelled) setConnectionState("polling");
      }, 0);
      pollInterval = setInterval(fetchEvents, 5000);
      return () => {
        cancelled = true;
        if (pollInterval) clearInterval(pollInterval);
      };
    }

    const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const channel = client
      .channel(`run-events:${runId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ForgeEvent",
          filter: `runId=eq.${runId}`,
        },
        (payload) => {
          const newEvent = payload.new as ForgeEvent;
          setEvents((prev) => {
            const updated = [...prev, newEvent];
            const limited = updated.slice(0, maxRendered);
            setCapReached(updated.length > maxRendered);
            return limited;
          });
        }
      )
      .subscribe((status) => {
        if (cancelled) return;

        if (status === "SUBSCRIBED") {
          setConnectionState("realtime");
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnectionState("disconnected");
        }
      });

    // Fallback to polling if not SUBSCRIBED in 5 seconds
    fallbackTimer = setTimeout(() => {
      if (!cancelled && connectionState !== "realtime") {
        console.warn("[RunEventStream] Realtime not ready in 5s, falling back to poll");
        setConnectionState("polling");
        pollInterval = setInterval(fetchEvents, 5000);
      }
    }, 5000);

    return () => {
      cancelled = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (pollInterval) clearInterval(pollInterval);
      client.removeChannel(channel);
    };
  }, [runId, maxRendered, connectionState]);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  const counts = {
    tool_use: events.filter((e) => e.kind === "tool_use").length,
    assistant_text: events.filter((e) => e.kind === "assistant_text").length,
    tool_result: events.filter((e) => e.kind === "tool_result").length,
    errors: events.filter(
      (e) =>
        e.kind === "error" ||
        (e.kind === "tool_result" &&
          typeof e.payload === "object" &&
          e.payload !== null &&
          "isError" in e.payload &&
          e.payload.isError)
    ).length,
  };

  const connectionBadge = (() => {
    switch (connectionState) {
      case "connecting":
        return <Badge variant="outline" className="text-xs">Conectando...</Badge>;
      case "realtime":
        return <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-700">Realtime ●</Badge>;
      case "polling":
        return <Badge variant="secondary" className="text-xs">Polling (5s)</Badge>;
      case "disconnected":
        return <Badge variant="destructive" className="text-xs">Desconectado</Badge>;
    }
  })();

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>tools: <strong>{counts.tool_use}</strong></span>
          <span>messages: <strong>{counts.assistant_text}</strong></span>
          <span>results: <strong>{counts.tool_result}</strong></span>
          {counts.errors > 0 && (
            <span className="text-rose-600 dark:text-rose-400">
              errors: <strong>{counts.errors}</strong>
            </span>
          )}
          <span className="ml-auto">
            events: <strong>{events.length}</strong>
          </span>
        </div>
        {connectionBadge}
      </div>

      {/* Cap warning banner */}
      {capReached && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          ⚠️ Exibindo apenas os primeiros {maxRendered.toLocaleString()} eventos. O run tem mais eventos.
        </div>
      )}

      {/* Event log */}
      <div
        ref={logRef}
        className="font-mono text-[11px] bg-slate-950 text-slate-300 dark:bg-black dark:text-slate-400 p-4 rounded-md max-h-[600px] overflow-y-auto leading-relaxed"
      >
        {events.length === 0 && (
          <div className="text-slate-500 dark:text-slate-600 italic">
            Waiting for events…
          </div>
        )}
        {events.map((e, i) => {
          const color = KIND_COLORS[e.kind] ?? "#aaa";
          return (
            <div
              key={`${e.seq}-${i}`}
              className="mb-1 whitespace-pre-wrap break-words"
            >
              <span className="text-slate-700 dark:text-slate-600 mr-2">
                #{String(e.seq).padStart(3, "0")}
              </span>
              <span
                style={{ color }}
                className="font-semibold mr-2 inline-block w-[120px]"
              >
                {e.kind}
              </span>
              <span className="text-slate-400 dark:text-slate-500">
                {formatPayloadSummary(e.kind, e.payload)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
