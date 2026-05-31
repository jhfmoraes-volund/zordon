"use client";

import { use, useCallback, useEffect, useState } from "react";
import { ArrowLeft, Play } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/app-shell";
import { PlanningBoard } from "@/components/planning-session/board";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
} from "@/components/ui/responsive-sheet";
import { StatusChip } from "@/components/ui/status-chip";
import type { PlanningSessionRow, PlanningSessionPRDRow } from "@/lib/dal/planning-session";

type SessionWithPrds = PlanningSessionRow & { prds: PlanningSessionPRDRow[] };

export default function PlanningSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);

  const [session, setSession] = useState<SessionWithPrds | null>(null);
  const [loading, setLoading] = useState(true);
  const [orchestrateSheetOpen, setOrchestrateSheetOpen] = useState(false);
  const [orchestrateProgress, setOrchestrateProgress] = useState<string | null>(null);

  // Load or create session
  useEffect(() => {
    const load = async () => {
      try {
        // List existing sessions for this project
        const listRes = await fetch(`/api/planning-sessions?projectId=${projectId}`);
        if (!listRes.ok) throw new Error("Failed to list sessions");
        const { sessions } = await listRes.json();

        let activeSession = sessions.find(
          (s: PlanningSessionRow) =>
            s.status === "draft" || s.status === "orchestrating" || s.status === "in-review",
        );

        if (!activeSession) {
          // Create a new draft session
          const createRes = await fetch("/api/planning-sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              title: "Planning Session",
              sprintCount: 6,
            }),
          });
          if (!createRes.ok) throw new Error("Failed to create session");
          const { session: created } = await createRes.json();
          const sessionId = created.id;

          // Fetch the newly created session
          const getRes = await fetch(`/api/planning-sessions/${sessionId}`);
          if (!getRes.ok) throw new Error("Failed to get session");
          const { session: newSession } = await getRes.json();
          activeSession = newSession;
        } else {
          // Fetch full session with PRDs
          const getRes = await fetch(`/api/planning-sessions/${activeSession.id}`);
          if (!getRes.ok) throw new Error("Failed to get session");
          const { session: fullSession } = await getRes.json();
          activeSession = fullSession;
        }

        setSession(activeSession);
      } catch (e) {
        console.error("Failed to load planning session:", e);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [projectId]);

  const handleOrchestrate = useCallback(async () => {
    if (!session) return;
    setOrchestrateSheetOpen(true);
    setOrchestrateProgress("Iniciando cascata...");

    try {
      const res = await fetch(`/api/planning-sessions/${session.id}/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetVersion: "v1" }),
      });

      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? "Orchestrate failed");
      }

      setOrchestrateProgress("Concluído! Recarregando...");

      // Reload session
      const getRes = await fetch(`/api/planning-sessions/${session.id}`);
      if (getRes.ok) {
        const { session: updated } = await getRes.json();
        setSession(updated);
      }

      setTimeout(() => {
        setOrchestrateSheetOpen(false);
        setOrchestrateProgress(null);
      }, 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setOrchestrateProgress(`Erro: ${msg}`);
    }
  }, [session]);

  const handlePrdDrag = useCallback(
    async (prdId: string, sprintStart: number, order: number) => {
      if (!session) return;
      const res = await fetch(`/api/planning-sessions/${session.id}/prds/${prdId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprintStart, order }),
      });
      if (!res.ok) {
        throw new Error("Failed to update PRD assignment");
      }
    },
    [session],
  );

  if (loading) {
    return (
      <div className="p-6 text-muted-foreground">Carregando planning session...</div>
    );
  }

  if (!session) {
    return (
      <div className="p-6 text-muted-foreground">
        Nenhuma planning session encontrada.
      </div>
    );
  }

  const statusTone =
    session.status === "in-review"
      ? "blue"
      : session.status === "approved"
        ? "green"
        : session.status === "error"
          ? "red"
          : "muted";

  return (
    <div className="space-y-6">
      <PageTitle
        title="Planning Session"
        subtitle={`Project ${projectId} · ${session.status}`}
      />

      {/* Hero */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Link href={`/projects/${projectId}`}>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label="Voltar"
            >
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-bold">{session.title}</h1>
              <StatusChip tone={statusTone} dot>
                {session.status}
              </StatusChip>
            </div>
            <p className="text-sm text-muted-foreground">
              {session.sprintCount} sprints · {session.prds.length} PRDs
            </p>
          </div>
        </div>
        {session.status === "draft" && (
          <Button
            variant="default"
            size="sm"
            onClick={handleOrchestrate}
            disabled={orchestrateSheetOpen}
          >
            <Play className="size-4" />
            Gerar plano de release
          </Button>
        )}
      </div>

      {/* Board */}
      {session.status === "in-review" || session.status === "approved" ? (
        <PlanningBoard
          sessionId={session.id}
          sprintCount={session.sprintCount}
          prds={session.prds}
          onPrdDrag={handlePrdDrag}
        />
      ) : session.status === "draft" ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          Clique em &ldquo;Gerar plano de release&rdquo; para começar.
        </div>
      ) : session.status === "error" ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <strong>Erro:</strong> {session.errorMessage ?? "Unknown error"}
        </div>
      ) : (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          Status: {session.status}
        </div>
      )}

      {/* Orchestrate progress sheet */}
      <ResponsiveSheet
        open={orchestrateSheetOpen}
        onOpenChange={setOrchestrateSheetOpen}
      >
        <ResponsiveSheetContent size="sm">
          <ResponsiveSheetHeader>
            <ResponsiveSheetTitle>Gerando plano...</ResponsiveSheetTitle>
          </ResponsiveSheetHeader>
          <ResponsiveSheetBody>
            <div className="py-4 text-center text-sm text-muted-foreground">
              {orchestrateProgress}
            </div>
          </ResponsiveSheetBody>
        </ResponsiveSheetContent>
      </ResponsiveSheet>
    </div>
  );
}
