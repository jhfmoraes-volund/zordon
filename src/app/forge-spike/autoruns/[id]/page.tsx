"use client";

import { use } from "react";
import Link from "next/link";

/**
 * DEPRECATED PAGE
 *
 * This page was deprecated in FUI-004 when the autoruns endpoint was removed.
 * The endpoint and SSE stream routes no longer exist.
 *
 * Users should use /forge-spike/runs/[id] instead, which uses Realtime.
 */
export default function AutorunViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: autorunId } = use(params);

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 24,
        maxWidth: 800,
        margin: "0 auto",
        minHeight: "100vh",
        color: "#e5e5e5",
      }}
    >
      <Link href="/forge-spike/prds" style={{ color: "#60a5fa", fontSize: 13, textDecoration: "none" }}>
        ← Back to Forge
      </Link>

      <div
        style={{
          marginTop: 32,
          padding: 24,
          background: "rgba(239,68,68,0.12)",
          border: "1px solid rgba(239,68,68,0.4)",
          borderRadius: 8,
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0, color: "#fca5a5", fontWeight: 600 }}>
          This page is deprecated
        </h1>
        <p style={{ marginTop: 12, fontSize: 14, color: "#fca5a5", lineHeight: 1.6 }}>
          The autoruns API endpoint was removed in <strong>FUI-004</strong>.
        </p>
        <p style={{ marginTop: 12, fontSize: 14, color: "#fca5a5", lineHeight: 1.6 }}>
          Please use <Link href={`/forge-spike/runs/${autorunId}`} style={{ color: "#60a5fa", fontWeight: 600 }}>/forge-spike/runs/{autorunId}</Link> instead,
          which uses Supabase Realtime.
        </p>
      </div>

      <div style={{ marginTop: 24, fontSize: 12, color: "#666" }}>
        Requested autorun ID: <code style={{ background: "rgba(255,255,255,0.04)", padding: "1px 4px", borderRadius: 3 }}>{autorunId}</code>
      </div>
    </div>
  );
}
