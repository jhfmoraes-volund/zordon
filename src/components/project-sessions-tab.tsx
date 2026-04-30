"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Download,
  Lightbulb,
  MoreVertical,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusChip } from "@/components/ui/status-chip";
import { SuperSessionModal } from "@/components/design-session/super-session-modal";
import { createClient } from "@/lib/supabase/client";
import { DESIGN_SESSION_STATUS, lookupChip } from "@/lib/status-chips";

type DesignSession = {
  id: string;
  title: string;
  type: string;
  status: string;
  currentStep: number;
  totalSteps: number;
  createdAt: string;
  _count: { items: number; stakeholders: number };
};

const TYPE_LABELS: Record<string, string> = {
  inception: "Inception",
  continuous_improvement: "Melhoria Continua",
  super: "Super Session",
};

type Props = {
  projectId: string;
  projectName: string;
  /** Whether the viewer can export JSON (manager-only). */
  canManage?: boolean;
};

export function ProjectSessionsTab({
  projectId,
  projectName,
  canManage = false,
}: Props) {
  const router = useRouter();
  const [sessions, setSessions] = useState<DesignSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [superOpen, setSuperOpen] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("design_session_summary")
        .select("*")
        .eq("projectId", projectId)
        .order("createdAt", { ascending: false });
      if (error) {
        console.error("[ProjectSessionsTab.load]", error);
        setSessions([]);
        return;
      }
      setSessions(((data ?? []) as unknown) as DesignSession[]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createSession(type: string) {
    const title =
      type === "inception"
        ? `Inception ${projectName}`
        : `Melhoria ${projectName} — ${new Date().toLocaleDateString("pt-BR")}`;
    const res = await fetch("/api/design-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, type, title }),
    });
    if (!res.ok) {
      alert("Falha ao criar session");
      return;
    }
    const session = await res.json();
    router.push(`/design-sessions/${session.id}/steps/0`);
  }

  async function remove(id: string) {
    if (!confirm("Remover esta session?")) return;
    await fetch(`/api/design-sessions/${id}`, { method: "DELETE" });
    load();
  }

  async function exportJson(id: string) {
    setExportingId(id);
    try {
      const supabase = createClient();
      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();
      if (!authSession) {
        alert("Sessão expirada. Faça login novamente.");
        return;
      }
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/export-design-session`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authSession.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: id }),
      });
      if (!res.ok) {
        alert(`Erro ao exportar: ${await res.text()}`);
        return;
      }
      const cd = res.headers.get("Content-Disposition") ?? "";
      const filename =
        cd.match(/filename="([^"]+)"/)?.[1] ?? `session-${id}.json`;
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } finally {
      setExportingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" onClick={() => createSession("inception")}>
          <Plus className="h-4 w-4 mr-1" />
          Inception
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => createSession("continuous_improvement")}
        >
          <Plus className="h-4 w-4 mr-1" />
          Melhoria Continua
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSuperOpen(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          Super Session
        </Button>
      </div>

      <SuperSessionModal
        projectId={projectId}
        projectName={projectName}
        open={superOpen}
        onOpenChange={setSuperOpen}
        onCreated={load}
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Lightbulb className="mx-auto h-8 w-8 mb-2 opacity-50" />
          <p>Nenhuma Design Session.</p>
          <p className="text-sm">
            Crie uma Inception para mapear o escopo do projeto.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {sessions.map((s) => (
            <Card key={s.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium">{s.title}</p>
                    <Badge variant="outline" className="text-xs mt-1">
                      {TYPE_LABELS[s.type] ?? s.type}
                    </Badge>
                  </div>
                  <StatusChip
                    {...lookupChip(DESIGN_SESSION_STATUS, s.status)}
                    dot
                  />
                </div>

                <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${((s.currentStep + 1) / Math.max(s.totalSteps, 1)) * 100}%`,
                    }}
                  />
                </div>

                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Step {s.currentStep + 1}/{s.totalSteps} ·{" "}
                    {s._count?.stakeholders ?? 0} stakeholders ·{" "}
                    {s._count?.items ?? 0} items
                  </span>
                  <div className="flex gap-1">
                    <Link
                      href={`/design-sessions/${s.id}/steps/${s.currentStep}`}
                    >
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        {canManage && (
                          <DropdownMenuItem
                            onClick={() => exportJson(s.id)}
                            disabled={exportingId === s.id}
                          >
                            <Download className="h-3.5 w-3.5" />
                            {exportingId === s.id
                              ? "Exportando…"
                              : "Exportar JSON"}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => remove(s.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
