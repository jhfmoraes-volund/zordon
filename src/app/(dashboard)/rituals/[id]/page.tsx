"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/app-shell";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { ConversationFab } from "@/components/ui/conversation/conversation-fab";
import { ConversationPanel } from "@/components/ui/conversation";
import { useIsMobile } from "@/hooks/use-mobile";
import { readPlanMode, useChatPlanMode } from "@/hooks/use-chat-plan-mode";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import type { PlanningDetail } from "@/lib/dal/planning";
import { ContextSheet } from "@/components/planning/context-sheet";
import { PlanningSheet } from "@/components/planning/planning-sheet";
import { PlanningRibbon } from "@/components/planning/planning-ribbon";
import {
  PlanningTree,
  type PlanningTreeStats,
} from "@/components/planning/planning-tree";
import { toast } from "sonner";

export default function RitualDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [planning, setPlanning] = useState<PlanningDetail | null>(null);
  const [loadError, setLoadError] = useState<"notfound" | "forbidden" | null>(null);
  const [concluding, setConcluding] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [contextSheetOpen, setContextSheetOpen] = useState(false);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [treeStats, setTreeStats] = useState<PlanningTreeStats | null>(null);

  const threadIdRef = useRef<string | null>(null);
  threadIdRef.current = threadId;

  const isMobile = useIsMobile();
  const { planMode, setPlanMode } = useChatPlanMode("vitoria");
  const [input, setInput] = useState("");

  // ─── Data loading ────────────────────────────────────────────────────

  const loadPlanning = useCallback(async () => {
    const r = await fetch(`/api/planning/${id}`);
    if (r.status === 404) { setLoadError("notfound"); return; }
    if (r.status === 403) { setLoadError("forbidden"); return; }
    if (!r.ok) { setLoadError("forbidden"); return; }
    const data = await r.json();
    setLoadError(null);
    setPlanning(data);
  }, [id]);

  useEffect(() => {
    loadPlanning();
  }, [loadPlanning]);

  // ─── Chat ─────────────────────────────────────────────────────────────

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/planning/${id}/chat`,
        body: {
          planningId: id,
          get threadId() {
            return threadIdRef.current;
          },
          get planMode() {
            return readPlanMode("vitoria");
          },
        },
        fetch: async (input, init) => {
          const res = await fetch(input as RequestInfo, init);
          const tid = res.headers.get("X-Thread-Id");
          if (tid) setThreadId(tid);
          return res;
        },
      }),
    [id],
  );

  const { messages, status, sendMessage, stop } = useChat({ transport });

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
    sendMessage({ text });
    setInput("");
  }, [input, status, sendMessage]);

  // ─── Concluir planning (staging-commit) ───────────────────────────────

  const doConclude = async () => {
    setConcluding(true);
    try {
      const res = await fetchOrThrow(`/api/planning/${id}/complete`, {
        method: "POST",
      });
      const body = (await res.json()) as {
        applied: { applied: number; failed: number; skipped: number };
      };
      await loadPlanning();
      const { applied, failed, skipped } = body.applied;
      if (failed > 0) {
        toast.error(
          `Planning concluída com falhas: ${applied} aplicadas, ${failed} falharam, ${skipped} ignoradas.`,
        );
      } else {
        toast.success(`Planning concluída. ${applied} ação(ões) aplicada(s).`);
      }
    } catch (e) {
      showErrorToast(e, { label: "Falha ao concluir planning" });
    } finally {
      setConcluding(false);
    }
  };

  const handleConclude = () => {
    if (!planning) return;
    const pending = treeStats?.pendingActionCount ?? 0;
    setConfirmState({
      title: "Concluir planning?",
      description:
        pending > 0
          ? `${pending} proposta(s) pendente(s) serão aplicadas. Esta ação é irreversível — pra ajustar depois, abra uma nova planning na mesma sprint.`
          : "Esta ação é irreversível. Pra ajustar depois, abra uma nova planning na mesma sprint.",
      confirmLabel: "Concluir",
      onConfirm: doConclude,
    });
  };

  // ─── Transcript curadoria ──────────────────────────────────────────────

  const handleUnlinkTranscript = (transcriptRefId: string, title: string) => {
    setConfirmState({
      title: "Remover transcript?",
      description: `"${title}" será desvinculado desta planning.`,
      confirmLabel: "Remover",
      destructive: true,
      onConfirm: async () => {
        try {
          await fetchOrThrow(
            `/api/planning/${id}/transcripts?transcriptRefId=${transcriptRefId}`,
            { method: "DELETE" },
          );
          await loadPlanning();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao remover transcript" });
        }
      },
    });
  };

  // ─── Render guards ────────────────────────────────────────────────────

  if (loadError === "notfound") {
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">Ritual não encontrado.</p>
        <Link href="/projects">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Voltar
          </Button>
        </Link>
      </div>
    );
  }

  if (loadError === "forbidden") {
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">Você não tem acesso a este ritual.</p>
        <Link href="/projects">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Voltar
          </Button>
        </Link>
      </div>
    );
  }

  if (!planning) {
    return <div className="p-6 text-muted-foreground text-sm">Carregando…</div>;
  }

  const title = planning.sprintName
    ? `Planning · ${planning.sprintName}`
    : "Planning";
  const backHref = `/projects/${planning.projectId}?tab=ceremonies`;

  const ribbonStats = treeStats
    ? {
        modules: treeStats.approvedModulesCount + treeStats.proposedModulesCount,
        stories: treeStats.totalStories,
        committedTasks: treeStats.committedTasks,
        eligibleTasks: treeStats.eligibleTasks,
        committedFp: treeStats.committedFp,
        pendingActions: treeStats.pendingActionCount,
      }
    : null;

  // ─── Chat panel ───────────────────────────────────────────────────────

  const chatPanel = (
    <ConversationPanel
      agent="vitoria"
      variant={isMobile ? "mobile" : "desktop"}
      messages={messages as UIMessage[]}
      status={status}
      input={input}
      onInputChange={setInput}
      onSubmit={handleSubmit}
      onStop={stop}
      isOpen={mobileOpen}
      onOpenChange={setMobileOpen}
      planMode={planMode}
      onPlanModeChange={setPlanMode}
      className="h-full"
    />
  );

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="-mx-3 -my-4 flex h-[calc(100svh-3rem)] flex-col overflow-hidden sm:-mx-4 md:h-[calc(100svh-3.5rem)] lg:-m-6">
      <PageTitle title={title} />

      <PlanningRibbon
        planning={planning}
        backHref={backHref}
        treeStats={ribbonStats}
        concluding={concluding}
        onConclude={handleConclude}
        onOpenContext={() => setContextSheetOpen(true)}
        onEdit={() => setEditSheetOpen(true)}
        threadId={threadId}
      />

      {/* Command center: árvore Module→Story→Task com ghosts (esquerda) + chat (direita) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(380px,1fr)] gap-4 p-4">
        <div className="surface overflow-y-auto min-h-0 p-4">
          <PlanningTree
            planningId={id}
            sprintId={planning.sprintId}
            onStatsChange={setTreeStats}
          />
        </div>

        {!isMobile && <div className="min-h-0">{chatPanel}</div>}
      </div>

      {isMobile && (
        <>
          <ConversationFab
            agent="vitoria"
            isOpen={mobileOpen}
            onClick={() => setMobileOpen(!mobileOpen)}
          />
          {chatPanel}
        </>
      )}

      <ContextSheet
        planningId={id}
        open={contextSheetOpen}
        onOpenChange={setContextSheetOpen}
        linkedTranscripts={planning.linkedTranscripts}
        onUnlink={handleUnlinkTranscript}
        onImported={loadPlanning}
      />

      <PlanningSheet
        open={editSheetOpen}
        onOpenChange={setEditSheetOpen}
        projectId={planning.projectId}
        planning={planning}
        onUpdated={loadPlanning}
        onDeleted={() => router.push(backHref)}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
