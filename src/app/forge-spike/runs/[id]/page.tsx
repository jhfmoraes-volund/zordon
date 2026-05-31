"use client";

import { useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type ForgeEvent = {
  runId?: string;
  taskId?: string;
  seq?: number;
  ts?: string;
  kind: string;
  payload?: Record<string, unknown>;
};

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

function formatPayloadSummary(kind: string, payload?: Record<string, unknown>): string {
  if (!payload) return "";
  if (kind === "tool_use") {
    return `${payload.tool}: ${payload.inputSummary ?? ""}`;
  }
  if (kind === "tool_result") {
    return payload.isError
      ? `❌ ${String(payload.preview ?? "")}`
      : `${String(payload.preview ?? "")}`;
  }
  if (kind === "assistant_text") {
    return String(payload.text ?? "");
  }
  if (kind === "story_loaded") {
    return `${payload.id} · ${payload.title} (${payload.profile ?? "?"}, ${payload.estimateMinutes ?? "?"}min)`;
  }
  if (kind === "done") {
    return payload.ok ? `✓ ok · ${payload.totalEvents} events` : `✗ failed (exit ${payload.exitCode})`;
  }
  if (kind === "claude_closed") {
    return `exit ${payload.exitCode}`;
  }
  if (kind === "error") {
    return String(payload.message ?? "");
  }
  if (kind === "started") {
    return `pid=${payload.pid} · ${payload.prdSlug}/${payload.storyId}`;
  }
  return JSON.stringify(payload).slice(0, 200);
}

export default function RunViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const backHref = searchParams.get("back");
  const [events, setEvents] = useState<ForgeEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const handleBack = (e: React.MouseEvent) => {
    if (backHref) return; // Link normal navega pro backHref
    e.preventDefault();
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  useEffect(() => {
    const es = new EventSource(`/api/forge/runs/${runId}/stream`);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as ForgeEvent;
        setEvents((prev) => [...prev, event]);
        if (event.kind === "done") {
          setIsDone(true);
          es.close();
        }
      } catch (err) {
        setError(`parse error: ${String(err)}`);
      }
    };
    es.onerror = () => {
      if (!isDone) {
        setError((prev) => prev ?? "EventSource error (auto-retry)");
      }
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [runId, isDone]);

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
    errors: events.filter((e) => e.kind === "error" || (e.kind === "tool_result" && e.payload?.isError)).length,
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <Link
        href={backHref ?? "#"}
        onClick={handleBack}
        style={{ color: "#0066cc", fontSize: 13, textDecoration: "none" }}
      >
        ← voltar
      </Link>

      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Forge Run</h1>
        <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
          <code style={{ background: "#f3f3f3", padding: "2px 6px", borderRadius: 3 }}>{runId}</code>
          {" · "}
          {isDone ? (
            <span style={{ color: "#2e7d32", fontWeight: 600 }}>● done</span>
          ) : (
            <span style={{ color: "#e65100", fontWeight: 600 }}>● running</span>
          )}
        </div>
      </div>

      {/* Counters */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: 12, color: "#666" }}>
        <span>tools: <strong>{counts.tool_use}</strong></span>
        <span>messages: <strong>{counts.assistant_text}</strong></span>
        <span>results: <strong>{counts.tool_result}</strong></span>
        {counts.errors > 0 && <span style={{ color: "#c00" }}>errors: <strong>{counts.errors}</strong></span>}
        <span style={{ marginLeft: "auto" }}>events: <strong>{events.length}</strong></span>
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            background: "#ffe6e6",
            border: "1px solid #ff9999",
            borderRadius: 6,
            fontSize: 13,
            color: "#c00",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <div
        ref={logRef}
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 11,
          background: "#0a0a0a",
          color: "#ddd",
          padding: 16,
          borderRadius: 6,
          maxHeight: 600,
          overflowY: "auto",
          lineHeight: 1.5,
        }}
      >
        {events.length === 0 && (
          <div style={{ color: "#666", fontStyle: "italic" }}>Waiting for events…</div>
        )}
        {events.map((e, i) => {
          const color = KIND_COLORS[e.kind] ?? "#aaa";
          return (
            <div key={i} style={{ marginBottom: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              <span style={{ color: "#555", marginRight: 8 }}>
                {e.seq != null ? `#${String(e.seq).padStart(3, "0")}` : "--"}
              </span>
              <span style={{ color, fontWeight: 600, marginRight: 8 }}>
                {e.kind.padEnd(16, " ")}
              </span>
              <span style={{ color: "#ccc" }}>
                {formatPayloadSummary(e.kind, e.payload)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
