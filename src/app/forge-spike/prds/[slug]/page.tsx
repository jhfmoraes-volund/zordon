"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ForgeStory = {
  id: string;
  title: string;
  description?: string;
  agentProfile?: string;
  estimateMinutes?: number;
  dependsOn?: string[];
  passes?: boolean;
  acceptanceCriteria?: string[];
  verifiable?: Array<{ kind: string; command_or_query: string; expected: string }>;
  touches?: string[];
};

type PrdDetail = {
  slug: string;
  state: string;
  path: string;
  title: string;
  size: number;
  modifiedAt: string;
  hasPlanJson: boolean;
  storyCount: number;
  storyPasses: number;
  content: string;
  stories: ForgeStory[];
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

const PROFILE_COLORS: Record<string, string> = {
  db: "#a78bfa",
  api: "#34d399",
  ui: "#f472b6",
  wiring: "#818cf8",
  test: "#fb923c",
  doc: "#94a3b8",
};

const STATE_THEME: Record<string, { accent: string; nextAction: string }> = {
  backlog: { accent: "#9ca3af", nextAction: "▸ Promote to ready (intake)" },
  ready: { accent: "#3b82f6", nextAction: "▶ Dispatch stories" },
  "in-progress": { accent: "#f59e0b", nextAction: "● Running" },
  blocked: { accent: "#ef4444", nextAction: "⚠ Review diff + decide" },
  done: { accent: "#10b981", nextAction: "↗ Closeout + PR" },
  archive: { accent: "#6b7280", nextAction: "" },
};

export default function PrdDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const router = useRouter();
  const { slug } = use(params);
  const [prd, setPrd] = useState<PrdDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState<string | null>(null);

  const runStory = async (storyId: string) => {
    setDispatching(storyId);
    setError(null);
    try {
      const r = await fetch("/api/forge/runs/from-story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prdSlug: slug, storyId }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
      }
      const json = await r.json();
      router.push(`/forge-spike/runs/${json.runId}`);
    } catch (err) {
      setError(`dispatch failed: ${String(err)}`);
      setDispatching(null);
    }
  };

  const startAutorun = async () => {
    setDispatching("__autorun__");
    setError(null);
    try {
      const r = await fetch("/api/forge/autoruns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prdSlug: slug, maxStories: 20 }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
      }
      const json = await r.json();
      router.push(`/forge-spike/autoruns/${json.autorunId}`);
    } catch (err) {
      setError(`autorun dispatch failed: ${String(err)}`);
      setDispatching(null);
    }
  };

  const pendingStories = prd?.stories.filter((s) => !s.passes).length ?? 0;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/forge/prds/${slug}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        if (alive) setPrd(json);
      } catch (err) {
        if (alive) setError(String(err));
      }
    };
    load();
    // Poll while we're on the page — autorun progress + passes mutate prd.json
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [slug]);

  if (error && !prd) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, color: "#e5e5e5" }}>
        <Link href="/forge-spike/prds" style={{ color: "#60a5fa", fontSize: 13 }}>
          ← back
        </Link>
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.4)",
            color: "#fca5a5",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  if (!prd) {
    return <div style={{ padding: 24, color: "#666" }}>Loading…</div>;
  }

  const theme = STATE_THEME[prd.state] ?? { accent: "#888", nextAction: "" };
  const progressPct = prd.storyCount > 0 ? Math.round((prd.storyPasses / prd.storyCount) * 100) : 0;

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 24,
        maxWidth: 1100,
        margin: "0 auto",
        color: "#e5e5e5",
        minHeight: "100vh",
      }}
    >
      <Link
        href="/forge-spike/prds"
        style={{ color: "#60a5fa", fontSize: 13, textDecoration: "none" }}
      >
        ← all PRDs
      </Link>

      {/* Header */}
      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: theme.accent,
              background: `${theme.accent}1f`,
              border: `1px solid ${theme.accent}55`,
              padding: "3px 8px",
              borderRadius: 3,
            }}
          >
            {prd.state}
          </span>
          <code
            style={{
              fontSize: 11,
              color: "#888",
              background: "rgba(255,255,255,0.04)",
              padding: "2px 6px",
              borderRadius: 3,
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {prd.slug}
          </code>
        </div>
        <h1 style={{ fontSize: 22, margin: 0, lineHeight: 1.3, color: "#fafafa", fontWeight: 600 }}>
          {prd.title.replace(/^PRD\s*[—-]\s*/, "")}
        </h1>
        <div style={{ fontSize: 11, color: "#666", marginTop: 6 }}>
          <code style={{ fontFamily: "ui-monospace, monospace" }}>{prd.path}</code>
          {" · "}
          {(prd.size / 1024).toFixed(1)} KB · modified{" "}
          {new Date(prd.modifiedAt).toLocaleString()}
        </div>
      </div>

      {/* Active autorun banner — takes priority over HITL banner when running */}
      {prd.runs?.lastAutorunId && (
        <Link
          href={`/forge-spike/autoruns/${prd.runs.lastAutorunId}`}
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div
            style={{
              marginBottom: 16,
              padding: 14,
              background: prd.runs.autorunRunning
                ? "rgba(245,158,11,0.12)"
                : prd.runs.lastAutorunStatus === "done"
                  ? "rgba(16,185,129,0.10)"
                  : "rgba(239,68,68,0.10)",
              border: `1px solid ${
                prd.runs.autorunRunning
                  ? "rgba(245,158,11,0.4)"
                  : prd.runs.lastAutorunStatus === "done"
                    ? "rgba(16,185,129,0.4)"
                    : "rgba(239,68,68,0.4)"
              }`,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              gap: 12,
              cursor: "pointer",
              transition: "background 120ms",
            }}
          >
            <style>{`@keyframes forge-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.5;transform:scale(1.3);}}`}</style>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: prd.runs.autorunRunning
                  ? "#f59e0b"
                  : prd.runs.lastAutorunStatus === "done"
                    ? "#10b981"
                    : "#ef4444",
                animation: prd.runs.autorunRunning ? "forge-pulse 1.2s ease-in-out infinite" : undefined,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: prd.runs.autorunRunning
                    ? "#fbbf24"
                    : prd.runs.lastAutorunStatus === "done"
                      ? "#10b981"
                      : "#fca5a5",
                }}
              >
                {prd.runs.autorunRunning
                  ? `▶ Autorun em execução — story atual: ${prd.runs.lastStoryId ?? "—"}`
                  : prd.runs.lastAutorunStatus === "done"
                    ? "↗ Último autorun: concluído"
                    : "⚠ Último autorun: falhou"}
              </div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 2, fontFamily: "ui-monospace, monospace" }}>
                {prd.runs.lastAutorunId}
              </div>
            </div>
            <span style={{ fontSize: 12, color: "#60a5fa", fontWeight: 600, whiteSpace: "nowrap" }}>
              {prd.runs.autorunRunning ? "Watch live →" : "View result →"}
            </span>
          </div>
        </Link>
      )}

      {/* HITL next-action banner */}
      {theme.nextAction && (
        <div
          style={{
            marginBottom: 24,
            padding: 12,
            background: `${theme.accent}10`,
            border: `1px solid ${theme.accent}33`,
            borderRadius: 6,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 12 }}>
            <span style={{ color: "#888", marginRight: 8 }}>Next human action:</span>
            <span style={{ color: theme.accent, fontWeight: 600 }}>{theme.nextAction}</span>
          </div>
          <span style={{ fontSize: 10, color: "#666", fontStyle: "italic" }}>
            ({prd.state === "ready" || prd.state === "in-progress" ? "auto-pilot phase" : "human-in-loop"})
          </span>
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

      {prd.hasPlanJson && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
              gap: 12,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                color: "#aaa",
                letterSpacing: 0.6,
              }}
            >
              §16 Stories · {prd.storyPasses}/{prd.storyCount} done ({progressPct}%)
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 11, color: "#666" }}>
                total estimate:{" "}
                {prd.stories.reduce((sum, s) => sum + (s.estimateMinutes ?? 0), 0)}min
              </div>
              <button
                onClick={startAutorun}
                disabled={dispatching !== null || pendingStories === 0}
                title={
                  pendingStories === 0
                    ? "all stories already done"
                    : `dispara autorun de ${pendingStories} stories`
                }
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor:
                    dispatching !== null || pendingStories === 0
                      ? "not-allowed"
                      : "pointer",
                  background:
                    dispatching === "__autorun__"
                      ? "#444"
                      : pendingStories === 0
                        ? "#1f1f1f"
                        : "#10b981",
                  color: pendingStories === 0 ? "#555" : "white",
                  border: "none",
                  borderRadius: 4,
                  whiteSpace: "nowrap",
                }}
              >
                {dispatching === "__autorun__"
                  ? "Spawning…"
                  : `▶▶ Autorun (${pendingStories})`}
              </button>
            </div>
          </div>
          <div
            style={{
              height: 4,
              background: "#1f1f1f",
              borderRadius: 2,
              overflow: "hidden",
              marginBottom: 16,
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

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {prd.stories.map((story) => {
              const isOpen = expanded === story.id;
              const profileColor = PROFILE_COLORS[story.agentProfile ?? ""] ?? "#888";
              return (
                <div
                  key={story.id}
                  style={{
                    border: `1px solid ${story.passes ? "#1a3a26" : "#1f1f1f"}`,
                    borderRadius: 6,
                    background: story.passes ? "#0c1f15" : "#161616",
                    overflow: "hidden",
                  }}
                >
                  <div
                    onClick={() => setExpanded(isOpen ? null : story.id)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        color: story.passes ? "#10b981" : "#444",
                        fontSize: 14,
                      }}
                    >
                      {story.passes ? "✓" : "○"}
                    </span>
                    <code
                      style={{
                        fontSize: 11,
                        color: "#888",
                        minWidth: 70,
                        fontFamily: "ui-monospace, monospace",
                      }}
                    >
                      {story.id}
                    </code>
                    {story.agentProfile && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: `${profileColor}20`,
                          color: profileColor,
                          letterSpacing: 0.4,
                          border: `1px solid ${profileColor}33`,
                        }}
                      >
                        {story.agentProfile}
                      </span>
                    )}
                    <span
                      style={{
                        flex: 1,
                        fontWeight: story.passes ? 400 : 500,
                        color: story.passes ? "#888" : "#fafafa",
                      }}
                    >
                      {story.title}
                    </span>
                    {story.estimateMinutes != null && (
                      <span style={{ fontSize: 11, color: "#666" }}>
                        {story.estimateMinutes}min
                      </span>
                    )}
                    {story.dependsOn && story.dependsOn.length > 0 && (
                      <span
                        style={{ fontSize: 11, color: "#666" }}
                        title={`deps: ${story.dependsOn.join(", ")}`}
                      >
                        ⇠ {story.dependsOn.length}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        runStory(story.id);
                      }}
                      disabled={dispatching !== null || story.passes}
                      title={story.passes ? "story já passou" : "dispara execução via Forge"}
                      style={{
                        padding: "4px 10px",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor:
                          dispatching !== null || story.passes ? "not-allowed" : "pointer",
                        background: story.passes
                          ? "transparent"
                          : dispatching === story.id
                            ? "#444"
                            : "#3b82f6",
                        color: story.passes ? "#444" : "white",
                        border: story.passes ? "1px solid #1a3a26" : "none",
                        borderRadius: 4,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {dispatching === story.id
                        ? "…"
                        : story.passes
                          ? "done"
                          : "▶ Run"}
                    </button>
                    <span style={{ fontSize: 11, color: "#444", marginLeft: 4 }}>
                      {isOpen ? "▾" : "▸"}
                    </span>
                  </div>
                  {isOpen && (
                    <div
                      style={{
                        padding: "0 12px 12px 38px",
                        fontSize: 12,
                        color: "#aaa",
                        borderTop: "1px solid #1f1f1f",
                      }}
                    >
                      {story.description && (
                        <div
                          style={{
                            marginTop: 10,
                            marginBottom: 10,
                            whiteSpace: "pre-wrap",
                            lineHeight: 1.5,
                          }}
                        >
                          {story.description}
                        </div>
                      )}
                      {story.acceptanceCriteria && story.acceptanceCriteria.length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                          <div
                            style={{
                              fontWeight: 700,
                              color: "#666",
                              marginBottom: 4,
                              fontSize: 10,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            Acceptance Criteria
                          </div>
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {story.acceptanceCriteria.map((ac, i) => (
                              <li key={i} style={{ marginBottom: 2 }}>
                                {ac}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {story.verifiable && story.verifiable.length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                          <div
                            style={{
                              fontWeight: 700,
                              color: "#666",
                              marginBottom: 4,
                              fontSize: 10,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            Verifiable
                          </div>
                          {story.verifiable.map((v, i) => (
                            <div
                              key={i}
                              style={{
                                fontFamily: "ui-monospace, monospace",
                                fontSize: 11,
                                color: "#888",
                                marginBottom: 4,
                              }}
                            >
                              <span
                                style={{
                                  background: "rgba(96,165,250,0.12)",
                                  color: "#60a5fa",
                                  padding: "1px 4px",
                                  borderRadius: 2,
                                  marginRight: 6,
                                }}
                              >
                                {v.kind}
                              </span>
                              <code>{v.command_or_query}</code>
                              <span style={{ color: "#555" }}> → {v.expected}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {story.touches && story.touches.length > 0 && (
                        <div>
                          <div
                            style={{
                              fontWeight: 700,
                              color: "#666",
                              marginBottom: 4,
                              fontSize: 10,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            Touches
                          </div>
                          <div
                            style={{
                              fontFamily: "ui-monospace, monospace",
                              fontSize: 11,
                              color: "#888",
                            }}
                          >
                            {story.touches.map((t, i) => (
                              <div key={i}>{t}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!prd.hasPlanJson && (
        <div
          style={{
            padding: 16,
            background: "rgba(251,191,36,0.08)",
            border: "1px solid rgba(251,191,36,0.3)",
            borderRadius: 6,
            fontSize: 13,
            color: "#fbbf24",
          }}
        >
          <strong>⚠ No plan.json</strong> — esse PRD não tem{" "}
          <code style={{ fontFamily: "ui-monospace, monospace" }}>
            scripts/ralph/features/{prd.slug}/prd.json
          </code>{" "}
          espelhando §16. Geração via planner (FE-002) cobre isso depois.
        </div>
      )}
    </div>
  );
}
