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
  const [reopening, setReopening] = useState(false);
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
  // Hidratando o histórico do thread no mount → spinner no corpo do chat.
  const [chatHydrating, setChatHydrating] = useState(true);

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
        // resumeStream() reconecta a um turn em vôo. O turn é resolvido
        // server-side a partir do thread — sem id do cliente.
        prepareReconnectToStreamRequest: () => ({
          api: `/api/planning/${id}/chat/resume`,
        }),
      }),
    [id],
  );

  const { messages, status, sendMessage, stop, setMessages, resumeStream } =
    useChat({ transport });

  // Hidrata o histórico do thread no mount — sem isso a conversa parecia
  // "perdida" a cada reload (mensagens existiam no banco, só não no estado).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/planning/${id}/chat?limit=50`)
      .then((r) => (r.ok ? r.json() : { threadId: null, messages: [] }))
      .then((result: {
        threadId: string | null;
        messages: Array<{ id: string; role: string; content: string }>;
        activeTurn?: { id: string; status: string } | null;
      }) => {
        if (cancelled) return;
        if (result.threadId) setThreadId(result.threadId);
        const restored = (result.messages ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map<UIMessage>((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            parts: [{ type: "text", text: m.content }],
          }));
        if (restored.length > 0) setMessages(restored);
        // Geração em andamento no background → reconecta ao stream pra a UI
        // voltar a "pensar" de onde parou (replay + tail do ChatTurnEvent).
        if (result.activeTurn) {
          void resumeStream();
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChatHydrating(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
          ? `${pending} proposta(s) pendente(s) serão aplicadas e a planning será publicada. Você pode reabrir depois pra refinar.`
          : "A planning será publicada. Você pode reabrir depois pra refinar.",
      confirmLabel: "Concluir",
      onConfirm: doConclude,
    });
  };

  // ─── Reabrir planning concluída ───────────────────────────────────────

  const doReopen = async () => {
    setReopening(true);
    try {
      await fetchOrThrow(`/api/planning/${id}/reopen`, { method: "POST" });
      await loadPlanning();
      toast.success("Planning reaberta. Refine e conclua de novo quando terminar.");
    } catch (e) {
      showErrorToast(e, { label: "Falha ao reabrir planning" });
    } finally {
      setReopening(false);
    }
  };

  const handleReopen = () => {
    if (!planning) return;
    setConfirmState({
      title: "Reabrir planning?",
      description:
        "A planning volta pra edição. As tasks já criadas são preservadas — ao concluir de novo, só as propostas novas são aplicadas.",
      confirmLabel: "Reabrir",
      onConfirm: doReopen,
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

  const headerSubtitle = planning.sprintName
    ? `Sprint Planning · ${planning.sprintName}`
    : "Sprint Planning";
  const backHref = `/projects/${planning.projectId}?tab=apps&app=ceremonies`;

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

  // Planning concluída/arquivada é read-only: pra editar, o PM reabre primeiro.
  const isClosed = planning.phase === "closed" || planning.phase === "archived";

  const chatPanel = (
    <ConversationPanel
      agent="vitoria"
      variant={isMobile ? "mobile" : "desktop"}
      messages={messages as UIMessage[]}
      status={status}
      isLoading={chatHydrating}
      input={input}
      onInputChange={setInput}
      onSubmit={handleSubmit}
      onStop={stop}
      isOpen={mobileOpen}
      onOpenChange={setMobileOpen}
      onClose={isMobile ? () => setMobileOpen(false) : undefined}
      planMode={planMode}
      onPlanModeChange={setPlanMode}
      composerSubmitDisabled={isClosed}
      placeholder={isClosed ? "Planning concluída — reabra pra editar" : undefined}
      className="h-full"
    />
  );

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div className="-mx-3 -my-4 flex h-[calc(100svh-3rem)] flex-col overflow-hidden sm:-mx-4 md:h-[calc(100svh-3.5rem)] lg:-m-6">
      <PageTitle
        title={planning.projectName ?? "Sprint Planning"}
        subtitle={headerSubtitle}
      />

      <PlanningRibbon
        planning={planning}
        backHref={backHref}
        treeStats={ribbonStats}
        concluding={concluding}
        onConclude={handleConclude}
        reopening={reopening}
        onReopen={handleReopen}
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
        projectId={planning.projectId}
        open={contextSheetOpen}
        onOpenChange={setContextSheetOpen}
        linkedTranscripts={planning.linkedTranscripts}
        projectRepo={planning.projectRepo}
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
