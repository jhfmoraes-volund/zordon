"use client";

import { useEffect, useRef, useState, use } from "react";
import Link from "next/link";

type LiveEvent = {
  runId?: string;
  seq?: number;
  ts?: string;
  kind: string;
  payload?: Record<string, unknown>;
};

const KIND_COLORS: Record<string, string> = {
  autorun_started: "#26c6da",
  autorun_done: "#10b981",
  autorun_pivot: "#fbbf24",
  story_picked: "#5c6bc0",
  story_running: "#f59e0b",
  story_done: "#10b981",
  story_failed: "#ef4444",
  "story:started": "#888",
  "story:story_loaded": "#888",
  "story:prompt_built": "#888",
  "story:memory_loaded": "#888",
  "story:status": "#888",
  "story:claude_system": "#9575cd",
  "story:assistant_text": "#0ff",
  "story:tool_use": "#ffeb3b",
  "story:tool_result": "#81c784",
  "story:stderr": "#ff8a65",
  "story:claude_closed": "#26c6da",
  "story:done": "#666",
  "story:error": "#ef5350",
  stream_open: "#555",
};

function formatEvent(e: LiveEvent): string {
  const p = e.payload ?? {};
  switch (e.kind) {
    case "autorun_started":
      return `${p.totalStories} stories · ${p.alreadyPassing ?? 0} already passing`;
    case "story_picked":
      return `${p.storyId} — ${p.title ?? ""} [${p.profile ?? "?"}] (run: ${String(p.storyRunId).slice(0, 8)})`;
    case "story_running":
      return `${p.storyId} (${p.executed}/${p.of})`;
    case "story_done":
      return `${p.storyId} ✓ ${Math.round(((p.durationMs as number) ?? 0) / 1000)}s · ${p.filesTouched} files`;
    case "story_failed":
      return `${p.storyId} ✗ exit ${p.exitCode}`;
    case "story:tool_use":
      return `${p.tool} ${String(p.inputSummary ?? "")}`;
    case "story:tool_result":
      return p.isError ? `❌ ${String(p.preview ?? "").slice(0, 120)}` : `${String(p.preview ?? "").slice(0, 120)}`;
    case "story:assistant_text":
      return String(p.text ?? "").slice(0, 200);
    case "story:claude_closed":
      return `exit ${p.exitCode}`;
    case "story:story_loaded":
      return `${p.id} — ${p.title ?? ""}`;
    case "story:memory_loaded":
      return `${p.passedStories} prior stories injected into prompt`;
    case "autorun_done":
      return `${p.reason} · ${p.executed} executed · ${p.finalPasses ?? "?"} total passing`;
    case "autorun_pivot":
      return `${p.storyId}: ${p.message}`;
    default:
      try {
        return JSON.stringify(p).slice(0, 160);
      } catch {
        return "";
      }
  }
}

type MemoryEntry = {
  story: string;
  title: string;
  passes: boolean;
  summary: string;
  filesTouched: string[];
  durationMs: number;
  totalEvents: number;
  exitCode: number | null;
};

type AutorunStatus = {
  autorunId: string;
  status: "running" | "done" | "failed" | "pivot";
  prdSlug: string | null;
  totalStories: number;
  alreadyPassing: number;
  passed: number;
  failed: number;
  currentStory: string | null;
  pivotMessage: string | null;
  doneReason: string | null;
  startedAt: string | null;
  endedAt: string | null;
  eventCount: number;
  memory: MemoryEntry[];
};

const STATUS_COLORS: Record<AutorunStatus["status"], string> = {
  running: "#f59e0b",
  done: "#10b981",
  failed: "#ef4444",
  pivot: "#fbbf24",
};

const STATUS_LABELS: Record<AutorunStatus["status"], string> = {
  running: "running",
  done: "all done",
  failed: "failed",
  pivot: "pivot required",
};

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function AutorunViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: autorunId } = use(params);
  const [autorun, setAutorun] = useState<AutorunStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "tools" | "orchestrator">("all");
  const logRef = useRef<HTMLDivElement | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let alive = true;
    let abort = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/forge/autoruns/${autorunId}`, { cache: "no-store" });
        if (!r.ok) {
          if (alive) setError(`HTTP ${r.status}`);
          return;
        }
        const json = await r.json();
        if (alive) {
          setAutorun(json);
          if (json.status !== "running") abort = true;
        }
      } catch (err) {
        if (alive) setError(String(err));
      }
    };
    load();
    const id = setInterval(() => {
      if (!abort) load();
    }, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [autorunId]);

  // SSE — live events stream from the autorun's events.jsonl
  useEffect(() => {
    const es = new EventSource(`/api/forge/runs/${autorunId}/stream`);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as LiveEvent;
        setLiveEvents((prev) => [...prev, parsed]);
        if (parsed.kind === "autorun_done" || parsed.kind === "autorun_pivot") {
          setTimeout(() => es.close(), 500);
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      // Browser auto-retries; ignore unless we see explicit errors
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [autorunId]);

  // Auto-scroll log on new events
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [liveEvents]);

  const filteredEvents = liveEvents.filter((e) => {
    if (filter === "all") return true;
    if (filter === "tools") return e.kind === "story:tool_use" || e.kind === "story:tool_result" || e.kind === "story:assistant_text";
    if (filter === "orchestrator")
      return !e.kind.startsWith("story:") && e.kind !== "stream_open";
    return true;
  });

  if (error && !autorun) {
    return (
      <div style={{ padding: 24, color: "#fca5a5", fontFamily: "system-ui" }}>
        <Link href="/forge-spike/prds" style={{ color: "#60a5fa" }}>
          ← PRDs
        </Link>
        <div style={{ marginTop: 16 }}>{error}</div>
      </div>
    );
  }

  if (!autorun) {
    return <div style={{ padding: 24, color: "#666" }}>Loading…</div>;
  }

  const statusColor = STATUS_COLORS[autorun.status];
  const statusLabel = STATUS_LABELS[autorun.status];
  const progressPct =
    autorun.totalStories > 0
      ? Math.round((autorun.passed / autorun.totalStories) * 100)
      : 0;
  const totalCost = 0; // placeholder — quality gates spike will populate this
  const elapsed = autorun.startedAt
    ? (autorun.endedAt
        ? new Date(autorun.endedAt).getTime() - new Date(autorun.startedAt).getTime()
        : Date.now() - new Date(autorun.startedAt).getTime())
    : 0;

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 24,
        maxWidth: 1100,
        margin: "0 auto",
        minHeight: "100vh",
        color: "#e5e5e5",
      }}
    >
      <style>{`
        @keyframes forge-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>

      <Link
        href={autorun.prdSlug ? `/forge-spike/prds/${autorun.prdSlug}` : "/forge-spike/prds"}
        style={{ color: "#60a5fa", fontSize: 13, textDecoration: "none" }}
      >
        ← {autorun.prdSlug ?? "PRDs"}
      </Link>

      <div style={{ marginTop: 16, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: statusColor,
              animation:
                autorun.status === "running"
                  ? "forge-pulse 1.2s ease-in-out infinite"
                  : undefined,
            }}
          />
          <span style={{ fontSize: 13, color: statusColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {statusLabel}
          </span>
          <code style={{ fontSize: 11, color: "#666", fontFamily: "ui-monospace, monospace" }}>
            {autorunId}
          </code>
        </div>
        <h1 style={{ fontSize: 22, margin: 0, color: "#fafafa", fontWeight: 600 }}>
          Autorun · {autorun.prdSlug}
        </h1>
        <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
          started {fmtRelative(autorun.startedAt)}
          {autorun.endedAt && ` · ended ${fmtRelative(autorun.endedAt)}`}
          {" · elapsed "} {fmtDuration(elapsed)}
        </div>
      </div>

      {autorun.pivotMessage && (
        <div
          style={{
            padding: 12,
            background: "rgba(251,191,36,0.12)",
            border: "1px solid rgba(251,191,36,0.4)",
            borderRadius: 6,
            fontSize: 13,
            color: "#fbbf24",
            marginBottom: 16,
          }}
        >
          <strong>⚠ Pivot required:</strong> {autorun.pivotMessage}
          <br />
          <span style={{ fontSize: 11, color: "#a16207", marginTop: 4, display: "block" }}>
            Check{" "}
            <code style={{ fontFamily: "ui-monospace, monospace" }}>
              .forge/{autorunId}/pivot-required.md
            </code>{" "}
            for details.
          </span>
        </div>
      )}

      {/* Progress */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 6,
            fontSize: 11,
          }}
        >
          <span style={{ color: "#aaa", textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.6 }}>
            Progress · {autorun.passed} done · {autorun.failed} failed · {autorun.totalStories - autorun.passed - autorun.failed} pending
          </span>
          <span style={{ color: statusColor, fontWeight: 600 }}>{progressPct}%</span>
        </div>
        <div
          style={{
            height: 6,
            background: "#1f1f1f",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progressPct}%`,
              background: statusColor,
              transition: "width 400ms",
            }}
          />
        </div>
      </div>

      {/* Stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 8,
          marginBottom: 24,
        }}
      >
        <StatBox label="Stories" value={`${autorun.passed}/${autorun.totalStories}`} accent="#fafafa" />
        <StatBox
          label="Current"
          value={autorun.currentStory ?? "—"}
          accent={autorun.currentStory ? "#f59e0b" : "#666"}
          mono
        />
        <StatBox label="Failed" value={autorun.failed} accent={autorun.failed > 0 ? "#ef4444" : "#666"} />
        <StatBox label="Events" value={autorun.eventCount} accent="#888" mono />
      </div>

      {/* Memory entries (story-by-story) */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#aaa",
            textTransform: "uppercase",
            letterSpacing: 0.6,
            marginBottom: 10,
          }}
        >
          Story-by-story memory ({autorun.memory.length} entries)
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {autorun.memory.length === 0 && (
            <div style={{ fontSize: 12, color: "#666", fontStyle: "italic", padding: 16, border: "1px dashed #2a2a2a", borderRadius: 4, textAlign: "center" }}>
              {autorun.currentStory ? "first story running…" : "waiting for first story to start"}
            </div>
          )}
          {autorun.memory.map((m, i) => {
            const isOpen = expanded === m.story;
            return (
              <div
                key={i}
                style={{
                  border: `1px solid ${m.passes ? "#1a3a26" : "#3a1a1a"}`,
                  background: m.passes ? "#0c1f15" : "#1f0c0c",
                  borderRadius: 6,
                  overflow: "hidden",
                }}
              >
                <div
                  onClick={() => setExpanded(isOpen ? null : m.story)}
                  style={{
                    padding: "10px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  <span style={{ width: 16, color: m.passes ? "#10b981" : "#ef4444", fontSize: 14 }}>
                    {m.passes ? "✓" : "✗"}
                  </span>
                  <code style={{ fontSize: 11, color: "#888", minWidth: 70, fontFamily: "ui-monospace, monospace" }}>
                    {m.story}
                  </code>
                  <span style={{ flex: 1, color: m.passes ? "#aaa" : "#fca5a5", fontWeight: 500 }}>
                    {m.title}
                  </span>
                  <span style={{ fontSize: 11, color: "#666" }}>
                    {fmtDuration(m.durationMs)}
                  </span>
                  <span style={{ fontSize: 11, color: "#666" }}>
                    {m.totalEvents} ev
                  </span>
                  <span style={{ fontSize: 11, color: "#444" }}>{isOpen ? "▾" : "▸"}</span>
                </div>
                {isOpen && (
                  <div style={{ padding: "0 12px 12px 38px", fontSize: 12, color: "#aaa", borderTop: "1px solid #1a1a1a" }}>
                    {m.summary && (
                      <div style={{ marginTop: 10, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                        <span style={{ color: "#666", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          Summary
                        </span>
                        <div style={{ marginTop: 4 }}>{m.summary}</div>
                      </div>
                    )}
                    {m.filesTouched.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <span style={{ color: "#666", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          Files touched ({m.filesTouched.length})
                        </span>
                        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#888", marginTop: 4 }}>
                          {m.filesTouched.map((f, j) => (
                            <div key={j}>{f}</div>
                          ))}
                        </div>
                      </div>
                    )}
                    {m.exitCode != null && m.exitCode !== 0 && (
                      <div style={{ marginTop: 10, color: "#ef4444" }}>
                        Exit code: {m.exitCode}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {/* Live indicator for currently running story */}
          {autorun.status === "running" && autorun.currentStory && (
            <div
              style={{
                border: "1px solid #3a2a0a",
                background: "#1f1808",
                borderRadius: 6,
                padding: "10px 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#f59e0b",
                  animation: "forge-pulse 1.2s ease-in-out infinite",
                }}
              />
              <code style={{ fontSize: 11, color: "#fbbf24", fontFamily: "ui-monospace, monospace" }}>
                {autorun.currentStory}
              </code>
              <span style={{ flex: 1, color: "#fbbf24" }}>running…</span>
            </div>
          )}
        </div>
      </div>

      {/* Live events stream (SSE) */}
      <div style={{ marginTop: 32 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#aaa",
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}
          >
            Live events ({liveEvents.length})
          </div>
          <div style={{ display: "flex", gap: 4, fontSize: 11 }}>
            {(["all", "tools", "orchestrator"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background: filter === f ? "#1f1f1f" : "transparent",
                  color: filter === f ? "#fafafa" : "#666",
                  border: `1px solid ${filter === f ? "#3a3a3a" : "#222"}`,
                  borderRadius: 3,
                  padding: "3px 10px",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: filter === f ? 600 : 400,
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div
          ref={logRef}
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: 11,
            background: "#0a0a0a",
            color: "#ddd",
            padding: 12,
            borderRadius: 6,
            maxHeight: 500,
            overflowY: "auto",
            lineHeight: 1.5,
            border: "1px solid #1a1a1a",
          }}
        >
          {filteredEvents.length === 0 && (
            <div style={{ color: "#555", fontStyle: "italic" }}>
              Aguardando eventos via SSE…
            </div>
          )}
          {filteredEvents.map((e, i) => {
            const color = KIND_COLORS[e.kind] ?? "#888";
            const summary = formatEvent(e);
            return (
              <div
                key={i}
                style={{
                  marginBottom: 3,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                <span style={{ color: "#444", marginRight: 6 }}>
                  {e.seq != null ? `#${String(e.seq).padStart(3, "0")}` : "---"}
                </span>
                <span style={{ color, fontWeight: 600, marginRight: 8 }}>
                  {e.kind.padEnd(22, " ")}
                </span>
                <span style={{ color: "#bbb" }}>{summary}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div style={{ marginTop: 32, paddingTop: 16, borderTop: "1px solid #1f1f1f", fontSize: 10, color: "#555" }}>
        Polling /api/forge/autoruns/{autorunId} every 2s · SSE on /api/forge/runs/{autorunId}/stream ·{" "}
        {totalCost > 0 && <span>cost: ${totalCost.toFixed(2)} · </span>}
        spike 3a + 3b (no quality gates yet)
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: number | string;
  accent: string;
  mono?: boolean;
}) {
  return (
    <div style={{ background: "#0f0f0f", border: "1px solid #1f1f1f", borderRadius: 4, padding: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.6 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: mono ? 14 : 18,
          fontWeight: 700,
          color: accent,
          marginTop: 4,
          fontFamily: mono ? "ui-monospace, monospace" : undefined,
          fontVariantNumeric: "tabular-nums",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}
