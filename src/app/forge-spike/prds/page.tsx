"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type PrdSummary = {
  slug: string;
  state: "backlog" | "ready" | "in-progress" | "blocked" | "done" | "archive";
  path: string;
  title: string;
  size: number;
  modifiedAt: string;
  hasPlanJson: boolean;
  storyCount: number;
  storyPasses: number;
  runs?: {
    total: number;
    running: number;
    lastRunAt: string | null;
    lastRunStatus: "done" | "failed" | "running" | null;
    lastStoryId: string | null;
    lastAutorunId: string | null;
    lastAutorunStatus: "done" | "failed" | "running" | null;
    autorunRunning: boolean;
  };
};

const STATES: PrdSummary["state"][] = [
  "backlog",
  "ready",
  "in-progress",
  "blocked",
  "done",
  "archive",
];

// Dark-mode palette. Card stays dark; state shows via accent + progress.
const STATE_THEME: Record<
  PrdSummary["state"],
  { accent: string; accentDim: string; hitl: string; nextAction: string }
> = {
  backlog: {
    accent: "#9ca3af",
    accentDim: "rgba(156,163,175,0.18)",
    hitl: "needs intake",
    nextAction: "Promote → ready",
  },
  ready: {
    accent: "#3b82f6",
    accentDim: "rgba(59,130,246,0.18)",
    hitl: "ready to dispatch",
    nextAction: "Run with Forge",
  },
  "in-progress": {
    accent: "#f59e0b",
    accentDim: "rgba(245,158,11,0.18)",
    hitl: "running",
    nextAction: "Watch live",
  },
  blocked: {
    accent: "#ef4444",
    accentDim: "rgba(239,68,68,0.18)",
    hitl: "human review needed",
    nextAction: "Open checkpoint",
  },
  done: {
    accent: "#10b981",
    accentDim: "rgba(16,185,129,0.18)",
    hitl: "ready to close out",
    nextAction: "Closeout + PR",
  },
  archive: {
    accent: "#6b7280",
    accentDim: "rgba(107,114,128,0.12)",
    hitl: "",
    nextAction: "",
  },
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

export default function PrdsListPage() {
  const router = useRouter();
  const [prds, setPrds] = useState<PrdSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        setPulsing(true);
        const r = await fetch("/api/forge/prds", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (alive) {
          setPrds(json.prds);
          setLastUpdate(new Date());
          setError(null);
        }
      } catch (err) {
        if (alive) setError(String(err));
      } finally {
        if (alive) setTimeout(() => setPulsing(false), 200);
      }
    };
    load();
    const id = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const byState = (state: PrdSummary["state"]) =>
    (prds ?? []).filter((p) => p.state === state);

  // HITL counts: PRDs that need human action
  const hitlCount = (prds ?? []).filter((p) =>
    ["backlog", "blocked", "done"].includes(p.state),
  ).length;

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 24,
        maxWidth: 1500,
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
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, margin: 0, color: "#fafafa", fontWeight: 600 }}>
          Forge · PRD Governance
        </h1>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "#888",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: pulsing ? "#10b981" : "#444",
              transition: "background 200ms",
            }}
          />
          {lastUpdate ? `synced ${fmtRelative(lastUpdate.toISOString())}` : "syncing…"}
        </span>
      </div>

      <div style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>
        Filesystem-as-state · {prds?.length ?? "—"} PRDs ·{" "}
        {hitlCount > 0 && (
          <span style={{ color: "#fbbf24", fontWeight: 600 }}>
            {hitlCount} need{hitlCount === 1 ? "s" : ""} you ·{" "}
          </span>
        )}
        <Link href="/forge-spike" style={{ color: "#60a5fa" }}>
          ← spike home
        </Link>
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.4)",
            borderRadius: 6,
            fontSize: 13,
            color: "#fca5a5",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {!prds && !error && <div style={{ color: "#666" }}>Loading…</div>}

      {prds && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, minmax(200px, 1fr))",
            gap: 16,
          }}
        >
          {STATES.map((state) => {
            const items = byState(state);
            const theme = STATE_THEME[state];
            return (
              <div key={state} style={{ minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    color: theme.accent,
                    marginBottom: 10,
                    paddingBottom: 8,
                    borderBottom: `2px solid ${theme.accent}`,
                  }}
                >
                  <span>{state} · {items.length}</span>
                  {theme.hitl && state !== "ready" && state !== "in-progress" && state !== "archive" && (
                    <span
                      title={theme.hitl}
                      style={{
                        fontSize: 9,
                        color: state === "blocked" ? "#fbbf24" : "#888",
                        textTransform: "none",
                        letterSpacing: 0,
                        fontWeight: 500,
                      }}
                    >
                      {state === "blocked" ? "⚠ action" : state === "done" ? "↗ close" : "▸ intake"}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {items.map((prd) => {
                    const progressPct =
                      prd.storyCount > 0
                        ? Math.round((prd.storyPasses / prd.storyCount) * 100)
                        : 0;
                    return (
                      <Link
                        key={prd.slug}
                        href={`/forge-spike/prds/${prd.slug}`}
                        style={{ textDecoration: "none", color: "inherit" }}
                      >
                        <div
                          style={{
                            padding: 12,
                            background: "#161616",
                            border: `1px solid #2a2a2a`,
                            borderLeft: `3px solid ${theme.accent}`,
                            borderRadius: 4,
                            cursor: "pointer",
                            transition: "background 120ms, transform 120ms",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLElement).style.background = "#1f1f1f";
                            (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = "#161616";
                            (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                          }}
                        >
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              marginBottom: 4,
                              lineHeight: 1.3,
                              color: "#fafafa",
                            }}
                          >
                            {prd.title.replace(/^PRD\s*[—-]\s*/, "")}
                          </div>
                          <div style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>
                            <code
                              style={{
                                background: "rgba(255,255,255,0.04)",
                                padding: "1px 5px",
                                borderRadius: 3,
                                fontFamily: "ui-monospace, monospace",
                              }}
                            >
                              {prd.slug}
                            </code>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              fontSize: 11,
                              color: "#888",
                              marginBottom: 6,
                            }}
                          >
                            <span>
                              {prd.hasPlanJson ? (
                                <span style={{ fontFamily: "ui-monospace, monospace" }}>
                                  {prd.storyPasses}/{prd.storyCount}{" "}
                                  <span style={{ color: theme.accent }}>· {progressPct}%</span>
                                </span>
                              ) : (
                                <span style={{ color: "#555", fontStyle: "italic" }}>no plan.json</span>
                              )}
                            </span>
                            <span style={{ fontSize: 10, color: "#666" }}>
                              {fmtRelative(prd.modifiedAt)}
                            </span>
                          </div>
                          {prd.hasPlanJson && prd.storyCount > 0 && (
                            <div
                              style={{
                                height: 3,
                                background: "rgba(255,255,255,0.06)",
                                borderRadius: 2,
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  height: "100%",
                                  width: `${progressPct}%`,
                                  background: theme.accent,
                                  transition: "width 400ms",
                                }}
                              />
                            </div>
                          )}
                          {/* Live run activity */}
                          {prd.runs && prd.runs.total > 0 && (
                            <div
                              style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop: "1px solid #222",
                                fontSize: 10,
                                color: "#999",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              {prd.runs.running > 0 ? (
                                <>
                                  <span
                                    style={{
                                      width: 6,
                                      height: 6,
                                      borderRadius: "50%",
                                      background: "#f59e0b",
                                      animation: "forge-pulse 1.2s ease-in-out infinite",
                                    }}
                                  />
                                  <span style={{ color: "#f59e0b", fontWeight: 600 }}>
                                    {prd.runs.running} running
                                  </span>
                                  {prd.runs.lastStoryId && (
                                    <span style={{ color: "#666" }}>· {prd.runs.lastStoryId}</span>
                                  )}
                                  {prd.runs.lastAutorunId && prd.runs.autorunRunning && (
                                    <button
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        router.push(
                                          `/forge-spike/autoruns/${prd.runs!.lastAutorunId}`,
                                        );
                                      }}
                                      style={{
                                        marginLeft: "auto",
                                        background: "transparent",
                                        border: "none",
                                        padding: 0,
                                        color: "#60a5fa",
                                        cursor: "pointer",
                                        fontWeight: 600,
                                        fontSize: 10,
                                        fontFamily: "inherit",
                                      }}
                                    >
                                      watch →
                                    </button>
                                  )}
                                </>
                              ) : (
                                <>
                                  <span
                                    style={{
                                      color:
                                        prd.runs.lastRunStatus === "done"
                                          ? "#10b981"
                                          : "#ef4444",
                                    }}
                                  >
                                    {prd.runs.lastRunStatus === "done" ? "✓" : "✗"}
                                  </span>
                                  <span>
                                    last:{" "}
                                    <code
                                      style={{
                                        fontFamily: "ui-monospace, monospace",
                                        fontSize: 10,
                                        color: "#bbb",
                                      }}
                                    >
                                      {prd.runs.lastStoryId}
                                    </code>
                                  </span>
                                  <span style={{ color: "#666", marginLeft: "auto" }}>
                                    {prd.runs.lastRunAt && fmtRelative(prd.runs.lastRunAt)}
                                  </span>
                                </>
                              )}
                              {prd.runs.total > 1 && (
                                <span style={{ color: "#555", marginLeft: "auto" }}>
                                  {prd.runs.total}×
                                </span>
                              )}
                            </div>
                          )}
                          {/* HITL hint */}
                          {theme.nextAction && (state === "blocked" || state === "done" || state === "backlog") && (
                            <div
                              style={{
                                marginTop: 8,
                                paddingTop: 8,
                                borderTop: `1px solid #222`,
                                fontSize: 10,
                                color: state === "blocked" ? "#fbbf24" : theme.accent,
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <span style={{ opacity: 0.7 }}>
                                {state === "blocked" ? "⚠" : state === "done" ? "↗" : "▸"}
                              </span>
                              <span style={{ fontWeight: 500 }}>{theme.nextAction}</span>
                            </div>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                  {items.length === 0 && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "#444",
                        fontStyle: "italic",
                        padding: "20px 12px",
                        textAlign: "center",
                        border: "1px dashed #2a2a2a",
                        borderRadius: 4,
                      }}
                    >
                      empty
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* HITL legend at the bottom */}
      <div
        style={{
          marginTop: 32,
          padding: 16,
          background: "#0f0f0f",
          border: "1px solid #1f1f1f",
          borderRadius: 6,
          fontSize: 11,
          color: "#888",
        }}
      >
        <div style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "#aaa", marginBottom: 8 }}>
          Human-in-the-loop — quando você entra
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <div>
            <span style={{ color: "#9ca3af", fontWeight: 600 }}>▸ Backlog</span>: você valida PRD e promove pra ready (rito intake)
          </div>
          <div>
            <span style={{ color: "#3b82f6", fontWeight: 600 }}>▸ Ready</span>: você dispara forge run (rito execução)
          </div>
          <div>
            <span style={{ color: "#f59e0b", fontWeight: 600 }}>▸ In-Progress</span>: Forge roda sozinho; você observa
          </div>
          <div>
            <span style={{ color: "#fbbf24", fontWeight: 600 }}>⚠ Blocked</span>: revisar diff + decidir continuar/pivotar (rito checkpoint)
          </div>
          <div>
            <span style={{ color: "#10b981", fontWeight: 600 }}>↗ Done</span>: abrir PR + arquivar (rito closeout)
          </div>
          <div>
            <span style={{ color: "#6b7280", fontWeight: 600 }}>Archive</span>: cold storage, sem ação
          </div>
        </div>
      </div>
    </div>
  );
}
