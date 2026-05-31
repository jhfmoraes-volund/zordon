"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type ForgeEvent = {
  runId?: string;
  taskId?: string;
  seq?: number;
  ts?: string;
  kind: string;
  payload?: Record<string, unknown>;
};

type PingState = "unknown" | "ready" | "unavailable";

type PrdSummary = {
  slug: string;
  state: "backlog" | "ready" | "in-progress" | "blocked" | "done" | "archive";
  title: string;
  storyCount: number;
  storyPasses: number;
  modifiedAt: string;
  runs?: {
    total: number;
    running: number;
    lastRunAt: string | null;
    lastRunStatus: "done" | "failed" | "running" | null;
    lastStoryId: string | null;
  };
};

const STATE_ACCENT: Record<PrdSummary["state"], string> = {
  backlog: "#9ca3af",
  ready: "#3b82f6",
  "in-progress": "#f59e0b",
  blocked: "#ef4444",
  done: "#10b981",
  archive: "#6b7280",
};

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function ForgeHomePage() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId");
  const [pingState, setPingState] = useState<PingState>("unknown");
  const [prds, setPrds] = useState<PrdSummary[] | null>(null);
  const [debugRunId, setDebugRunId] = useState<string | null>(null);
  const [debugEvents, setDebugEvents] = useState<ForgeEvent[]>([]);
  const [debugSpawning, setDebugSpawning] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Probe ping
  useEffect(() => {
    let alive = true;
    const probe = async () => {
      try {
        const r = await fetch("/api/forge/ping", { cache: "no-store" });
        if (alive) setPingState(r.ok ? "ready" : "unavailable");
      } catch {
        if (alive) setPingState("unavailable");
      }
    };
    probe();
    const id = setInterval(probe, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Fetch project name if projectId is present
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
        if (!r.ok) return;
        const json = await r.json();
        if (alive) setProjectName(json.name);
      } catch {
        if (alive) setProjectName(null);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [projectId]);

  // Fetch PRDs
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/forge/prds", { cache: "no-store" });
        if (!r.ok) return;
        const json = await r.json();
        // Filter by project if projectId is present
        let filtered = json.prds;
        if (projectId && projectName) {
          const projectSlug = projectName
            .toLowerCase()
            .trim()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "");
          filtered = json.prds.filter((p: PrdSummary) => p.slug.includes(projectSlug));
        }
        if (alive) setPrds(filtered);
      } catch {
        // silent
      }
    };
    load();
    const id = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [projectId, projectName]);

  // EventSource for debug run
  useEffect(() => {
    if (!debugRunId) return;
    const es = new EventSource(`/api/forge/runs/${debugRunId}/stream`);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        setDebugEvents((prev) => [...prev, JSON.parse(ev.data)]);
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      setError((prev) => prev ?? "EventSource error (auto-retry)");
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [debugRunId]);

  const spawnDebug = async () => {
    setDebugSpawning(true);
    setError(null);
    setDebugEvents([]);
    try {
      const r = await fetch("/api/forge/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "debug-hello" }),
      });
      if (!r.ok) {
        setError(`POST /api/forge/runs failed: ${r.status}`);
        return;
      }
      const json = await r.json();
      setDebugRunId(json.runId);
    } catch (err) {
      setError(`fetch error: ${String(err)}`);
    } finally {
      setDebugSpawning(false);
    }
  };

  // Stats
  const byState = (state: PrdSummary["state"]) =>
    (prds ?? []).filter((p) => p.state === state).length;

  const totalRuns = (prds ?? []).reduce((sum, p) => sum + (p.runs?.total ?? 0), 0);
  const activeRuns = (prds ?? []).reduce((sum, p) => sum + (p.runs?.running ?? 0), 0);
  const hitlNeeded = (prds ?? []).filter((p) =>
    ["backlog", "blocked", "done"].includes(p.state),
  ).length;

  // Recent activity: PRDs sorted by lastRunAt desc, take top 5 that have runs
  const recentActivity = [...(prds ?? [])]
    .filter((p) => p.runs && p.runs.total > 0 && p.runs.lastRunAt)
    .sort((a, b) =>
      (b.runs!.lastRunAt ?? "").localeCompare(a.runs!.lastRunAt ?? ""),
    )
    .slice(0, 5);

  const pingDot = pingState === "ready" ? "#10b981" : pingState === "unavailable" ? "#ef4444" : "#888";
  const pingLabel =
    pingState === "ready" ? "Forge ready" : pingState === "unavailable" ? "Forge unavailable" : "probing…";

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

      {/* Hero */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, margin: 0, color: "#fafafa", fontWeight: 700, letterSpacing: -0.5 }}>
          ⚒ Forge · Local Engine
        </h1>
        <div
          style={{
            marginTop: 6,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "#888",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: pingDot,
              animation: pingState === "ready" ? "forge-pulse 2.4s ease-in-out infinite" : undefined,
            }}
          />
          <span style={{ color: pingDot, fontWeight: 600 }}>{pingLabel}</span>
          <span>· dev mode · localhost:3001</span>
        </div>
      </div>

      {/* Project filter banner */}
      {projectId && projectName && (
        <div
          style={{
            padding: 12,
            background: "rgba(59,130,246,0.12)",
            border: "1px solid rgba(59,130,246,0.4)",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ color: "#93c5fd" }}>
            Filtering by project: <strong style={{ color: "#60a5fa" }}>{projectName}</strong>
          </span>
          <Link
            href="/forge-spike"
            style={{
              color: "#60a5fa",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            Clear filter →
          </Link>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: 12,
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.4)",
            color: "#fca5a5",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {/* Stats grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 32,
        }}
      >
        <StatCard label="PRDs" value={prds?.length ?? "—"} accent="#fafafa" />
        <StatCard
          label="Runs total"
          value={totalRuns}
          accent={totalRuns > 0 ? "#60a5fa" : "#666"}
        />
        <StatCard
          label="Active"
          value={activeRuns}
          accent={activeRuns > 0 ? "#f59e0b" : "#666"}
          pulse={activeRuns > 0}
        />
        <StatCard
          label="Need you"
          value={hitlNeeded}
          accent={hitlNeeded > 0 ? "#fbbf24" : "#666"}
          hint={hitlNeeded > 0 ? "human-in-loop" : ""}
        />
      </div>

      {/* PRD state distribution */}
      {prds && (
        <div style={{ marginBottom: 32 }}>
          <SectionTitle>PRD distribution</SectionTitle>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gap: 8,
              marginTop: 8,
            }}
          >
            {(["backlog", "ready", "in-progress", "blocked", "done", "archive"] as const).map((state) => (
              <div
                key={state}
                style={{
                  background: "#0f0f0f",
                  border: "1px solid #1f1f1f",
                  borderLeft: `3px solid ${STATE_ACCENT[state]}`,
                  borderRadius: 4,
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: STATE_ACCENT[state],
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {state}
                </div>
                <div style={{ fontSize: 20, color: "#fafafa", fontWeight: 600, marginTop: 2 }}>
                  {byState(state)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick nav cards */}
      <div style={{ marginBottom: 32 }}>
        <SectionTitle>Navigation</SectionTitle>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginTop: 8,
          }}
        >
          <NavCard
            href={projectId ? `/forge-spike/prds?projectId=${projectId}` : "/forge-spike/prds"}
            title="PRD Governance"
            description="Kanban filesystem-as-state · 6 estados · HITL banners"
            cta="Open kanban →"
            color="#60a5fa"
          />
          <NavCard
            href="/forge-spike/runs"
            title="Runs (em breve)"
            description="Histórico de todas as forge runs · cost · duration"
            cta="Coming soon"
            color="#888"
            disabled
          />
        </div>
      </div>

      {/* Recent activity */}
      {recentActivity.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <SectionTitle>Recent activity</SectionTitle>
          <div
            style={{
              marginTop: 8,
              background: "#0f0f0f",
              border: "1px solid #1f1f1f",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {recentActivity.map((p, i) => (
              <Link
                key={p.slug}
                href={`/forge-spike/prds/${p.slug}`}
                style={{
                  textDecoration: "none",
                  color: "inherit",
                  display: "flex",
                  padding: "10px 14px",
                  alignItems: "center",
                  gap: 12,
                  borderTop: i > 0 ? "1px solid #1a1a1a" : undefined,
                  fontSize: 12,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background:
                      p.runs?.running ? "#f59e0b" :
                      p.runs?.lastRunStatus === "done" ? "#10b981" :
                      p.runs?.lastRunStatus === "failed" ? "#ef4444" : "#666",
                    animation: p.runs?.running ? "forge-pulse 1.2s ease-in-out infinite" : undefined,
                  }}
                />
                <span style={{ color: "#fafafa", fontWeight: 500, minWidth: 200 }}>
                  {p.slug}
                </span>
                <code
                  style={{
                    fontSize: 11,
                    fontFamily: "ui-monospace, monospace",
                    color: "#888",
                    background: "rgba(255,255,255,0.04)",
                    padding: "1px 5px",
                    borderRadius: 3,
                  }}
                >
                  {p.runs?.lastStoryId}
                </code>
                <span style={{ color: "#666", flex: 1 }}>
                  {p.runs?.running ? "running" : p.runs?.lastRunStatus}
                </span>
                <span style={{ color: "#666", fontSize: 11 }}>
                  {p.runs?.lastRunAt && fmtRelative(p.runs.lastRunAt)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Debug spike */}
      <div style={{ marginTop: 48, marginBottom: 32 }}>
        <button
          onClick={() => setDebugOpen(!debugOpen)}
          style={{
            background: "transparent",
            border: "none",
            color: "#666",
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            cursor: "pointer",
            padding: 0,
          }}
        >
          {debugOpen ? "▾" : "▸"} debug · spike 1 (hello world)
        </button>
        {debugOpen && (
          <div style={{ marginTop: 12 }}>
            <button
              onClick={spawnDebug}
              disabled={pingState !== "ready" || debugSpawning}
              style={{
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: pingState !== "ready" || debugSpawning ? "not-allowed" : "pointer",
                background: pingState === "ready" ? "#3b82f6" : "#333",
                color: "white",
                border: "none",
                borderRadius: 4,
              }}
            >
              {debugSpawning ? "Spawning…" : "▶ Spawn debug run"}
            </button>
            {debugRunId && (
              <div style={{ marginTop: 8, fontSize: 11, color: "#666" }}>
                run id: <code style={{ background: "rgba(255,255,255,0.04)", padding: "1px 4px", borderRadius: 3 }}>{debugRunId}</code>
              </div>
            )}
            {debugEvents.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 11,
                  background: "#0a0a0a",
                  color: "#0f0",
                  padding: 12,
                  borderRadius: 4,
                  maxHeight: 250,
                  overflowY: "auto",
                }}
              >
                {debugEvents.map((e, i) => (
                  <div key={i} style={{ marginBottom: 3 }}>
                    <span style={{ color: "#555" }}>#{e.seq ?? "-"}</span>{" "}
                    <span style={{ color: "#0ff" }}>{e.kind}</span>{" "}
                    {e.payload && (
                      <span style={{ color: "#aaa" }}>{JSON.stringify(e.payload).slice(0, 200)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: 48,
          paddingTop: 16,
          borderTop: "1px solid #1f1f1f",
          fontSize: 11,
          color: "#555",
        }}
      >
        Forge sandbox · branch <code style={{ background: "rgba(255,255,255,0.04)", padding: "1px 4px", borderRadius: 3 }}>forge-engine-spike</code>{" "}
        · spawning via Next.js API + claude -p local auth
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  hint,
  pulse,
}: {
  label: string;
  value: number | string;
  accent: string;
  hint?: string;
  pulse?: boolean;
}) {
  return (
    <div
      style={{
        background: "#0f0f0f",
        border: "1px solid #1f1f1f",
        borderRadius: 6,
        padding: 14,
        position: "relative",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#666",
          textTransform: "uppercase",
          letterSpacing: 0.6,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {label}
        {pulse && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: accent,
              animation: "forge-pulse 1.2s ease-in-out infinite",
            }}
          />
        )}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: accent,
          marginTop: 4,
          fontFamily: "ui-monospace, monospace",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{hint}</div>
      )}
    </div>
  );
}

function NavCard({
  href,
  title,
  description,
  cta,
  color,
  disabled,
}: {
  href: string;
  title: string;
  description: string;
  cta: string;
  color: string;
  disabled?: boolean;
}) {
  const content = (
    <div
      style={{
        background: "#0f0f0f",
        border: `1px solid ${disabled ? "#1a1a1a" : "#2a2a2a"}`,
        borderRadius: 6,
        padding: 16,
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 120ms, transform 120ms",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLElement).style.background = "#161616";
        (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLElement).style.background = "#0f0f0f";
        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: "#fafafa", marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: "#888", lineHeight: 1.5, marginBottom: 10 }}>
        {description}
      </div>
      <div style={{ fontSize: 12, color, fontWeight: 600 }}>{cta}</div>
    </div>
  );

  if (disabled) return content;
  return (
    <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
      {content}
    </Link>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "#aaa",
        textTransform: "uppercase",
        letterSpacing: 0.6,
      }}
    >
      {children}
    </div>
  );
}
