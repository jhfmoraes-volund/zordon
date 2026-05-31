import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RunEventStream } from "@/components/forge/run-event-stream";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
};

export default async function RunViewerPage({ params, searchParams }: Props) {
  const { id: runId } = await params;
  const search = await searchParams;
  const backHref = search.back;

  const supabase = await createClient();
  const { data: run, error } = await supabase
    .from("ForgeRun")
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ padding: 12, background: "#ffe6e6", border: "1px solid #ff9999", borderRadius: 6 }}>
          Erro ao carregar run: {error.message}
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ padding: 12, background: "#ffe6e6", border: "1px solid #ff9999", borderRadius: 6 }}>
          Run não encontrado.
        </div>
      </div>
    );
  }

  const isDone = run.status === "done" || run.status === "error";
  const statusColor = isDone
    ? (run.status === "done" ? "#2e7d32" : "#c62828")
    : "#e65100";

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <Link
        href={backHref ?? "/forge-spike"}
        style={{ color: "#0066cc", fontSize: 13, textDecoration: "none" }}
      >
        ← voltar
      </Link>

      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Forge Run</h1>
        <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
          <code style={{ background: "#f3f3f3", padding: "2px 6px", borderRadius: 3 }}>{runId}</code>
          {" · "}
          <span style={{ color: statusColor, fontWeight: 600 }}>● {run.status}</span>
          {run.progress != null && run.status === "running" && (
            <span> · progress: {Math.round(run.progress * 100)}%</span>
          )}
          {run.createdAt && (
            <span> · started {new Date(run.createdAt).toLocaleString()}</span>
          )}
        </div>
      </div>

      <RunEventStream runId={runId} />
    </div>
  );
}
