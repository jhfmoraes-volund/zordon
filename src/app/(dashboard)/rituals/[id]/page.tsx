"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  ArrowLeft,
  BookOpen,
  Check,
  FileText,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageTitle } from "@/components/app-shell";
import { StatusChip } from "@/components/ui/status-chip";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { ConversationFab } from "@/components/ui/conversation/conversation-fab";
import { ConversationPanel } from "@/components/ui/conversation";
import { useIsMobile } from "@/hooks/use-mobile";
import { readPlanMode, useChatPlanMode } from "@/hooks/use-chat-plan-mode";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { fmtDate } from "@/lib/date-utils";
import type { PlanningDetail } from "@/lib/dal/planning";
import type { PlanningPhase } from "@/lib/planning/phase";
import type { ChipTone } from "@/lib/status-chips";
import { BriefingTree } from "@/components/planning/briefing-tree";
import { ProposalCard, type PlanningAction } from "@/components/planning/proposal-card";
import { ContextSheet } from "@/components/planning/context-sheet";

// ─── Constants ───────────────────────────────────────────────────────────

const PHASE_META: Record<PlanningPhase, { label: string; tone: ChipTone }> = {
  idle: { label: "Aguardando", tone: "slate" },
  reading: { label: "Leitura", tone: "blue" },
  proposing: { label: "Propondo", tone: "amber" },
  approving: { label: "Revisão", tone: "cyan" },
  closed: { label: "Concluída", tone: "green" },
  archived: { label: "Arquivada", tone: "muted" },
};

// ─── Phase controls ───────────────────────────────────────────────────────

function PhaseRibbon({
  planning,
  onTransition,
  transitioning,
}: {
  planning: PlanningDetail;
  onTransition: (to: PlanningPhase) => void;
  transitioning: boolean;
}) {
  const { phase } = planning;
  const meta = PHASE_META[phase];
  const hasContent =
    planning.linkedMeetingCount > 0 || planning.linkedTranscriptCount > 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatusChip tone={meta.tone} label={meta.label} dot />

      {phase === "idle" && (
        <Button
          size="sm"
          disabled={!hasContent || transitioning}
          title={!hasContent ? "Adicione ≥1 reunião ou transcript antes de iniciar" : undefined}
          onClick={() => onTransition("reading")}
        >
          {transitioning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BookOpen className="mr-1.5 h-3.5 w-3.5" />}
          Iniciar leitura
        </Button>
      )}

      {(phase === "reading" || phase === "proposing") && (
        <Button
          size="sm"
          variant="outline"
          disabled={transitioning}
          onClick={() => onTransition("idle")}
        >
          {transitioning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
          Resetar briefing
        </Button>
      )}

      {phase === "proposing" && (
        <Button
          size="sm"
          disabled={planning.pendingActionCount < 1 || transitioning}
          title={planning.pendingActionCount < 1 ? "Nenhuma proposta pendente pra revisar" : undefined}
          onClick={() => onTransition("approving")}
        >
          {transitioning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
          Revisar propostas ({planning.pendingActionCount})
        </Button>
      )}

      {phase === "approving" && (
        <Button
          size="sm"
          disabled={planning.pendingActionCount > 0 || transitioning}
          title={planning.pendingActionCount > 0 ? `Ainda há ${planning.pendingActionCount} proposta(s) pendente(s)` : undefined}
          onClick={() => onTransition("closed")}
        >
          {transitioning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
          Fechar planning
        </Button>
      )}

      {phase === "closed" && (
        <Button
          size="sm"
          variant="outline"
          disabled={transitioning}
          onClick={() => onTransition("archived")}
        >
          {transitioning && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Arquivar
        </Button>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────

export default function RitualDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [planning, setPlanning] = useState<PlanningDetail | null>(null);
  const [actions, setActions] = useState<PlanningAction[]>([]);
  const [loadError, setLoadError] = useState<"notfound" | "forbidden" | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [contextSheetOpen, setContextSheetOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);

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

  const loadActions = useCallback(async () => {
    const r = await fetch(`/api/planning/${id}/actions`);
    if (r.ok) setActions(await r.json());
  }, [id]);

  useEffect(() => {
    loadPlanning();
    loadActions();
  }, [loadPlanning, loadActions]);

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

  const { messages, status, sendMessage, stop, setMessages } = useChat({ transport });

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
    sendMessage({ text }, { body: { threadId, planningId: id } });
    setInput("");
  }, [input, status, sendMessage, threadId, id]);

  // ─── Phase transition ──────────────────────────────────────────────────

  const handleTransition = async (to: PlanningPhase) => {
    if (!planning) return;
    const needsConfirm = to === "idle" && (planning.phase === "reading" || planning.phase === "proposing");
    if (needsConfirm) {
      setConfirmState({
        title: "Resetar briefing?",
        description: "Todas as notas de contexto geradas serão excluídas. Essa ação não pode ser desfeita.",
        confirmLabel: "Resetar",
        destructive: true,
        onConfirm: () => doTransition(to),
      });
      return;
    }
    await doTransition(to);
  };

  const doTransition = async (to: PlanningPhase) => {
    setTransitioning(true);
    try {
      await fetchOrThrow(`/api/planning/${id}/phase`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      await loadPlanning();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao mudar fase" });
    } finally {
      setTransitioning(false);
    }
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

  // ─── Note dismiss ──────────────────────────────────────────────────────

  const handleDismissNote = (noteId: string) => {
    setConfirmState({
      title: "Dispensar nota?",
      description: "A nota será ocultada do contexto ativo.",
      confirmLabel: "Dispensar",
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/planning/${id}/notes/${noteId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dismissed: true }),
          });
          await loadPlanning();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao dispensar nota" });
        }
      },
    });
  };

  // ─── Render guards ────────────────────────────────────────────────────

  if (loadError === "notfound") {
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">Ritual não encontrado.</p>
        <Link href={planning ? `/projects/${planning.projectId}?tab=ceremonies` : "/projects"}>
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
        <Link href={planning ? `/projects/${planning.projectId}?tab=ceremonies` : "/projects"}>
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

  const activeNotes = planning.notes.filter((n) => !n.dismissedAt);
  const pendingActions = actions.filter((a) => a.decision === "pending");
  const decidedActions = actions.filter((a) => a.decision !== "pending");

  // ─── Render ───────────────────────────────────────────────────────────

  const title = planning.sprintName
    ? `Planning · ${planning.sprintName}`
    : "Planning";

  const leftPane = (
    <div className="space-y-4 min-w-0">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Link href={planning ? `/projects/${planning.projectId}?tab=ceremonies` : "/projects"}>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold truncate">{title}</h1>
            {planning.scheduledFor && (
              <p className="text-xs text-muted-foreground">{fmtDate(planning.scheduledFor)}</p>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setContextSheetOpen(true)}
          >
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Contexto
            {planning.linkedTranscriptCount > 0 && (
              <Badge className="ml-1.5 h-4 px-1 text-[10px]">
                {planning.linkedTranscriptCount}
              </Badge>
            )}
          </Button>
        </div>

        <PhaseRibbon
          planning={planning}
          onTransition={handleTransition}
          transitioning={transitioning}
        />

        {planning.facilitatorName && (
          <p className="text-xs text-muted-foreground">
            Facilitador: {planning.facilitatorName}
          </p>
        )}
      </div>

      {/* Briefing Tree */}
      {(activeNotes.length > 0 || planning.phase === "reading" || planning.phase === "proposing") && (
        activeNotes.length === 0 ? (
          <section className="surface p-4">
            <p className="text-xs text-muted-foreground">
              {planning.phase === "reading"
                ? "Vitória está lendo os insumos…"
                : "Nenhuma nota ativa."}
            </p>
          </section>
        ) : (
          <BriefingTree notes={activeNotes} onDismiss={handleDismissNote} />
        )
      )}

      {/* Propostas pendentes */}
      {(planning.phase === "proposing" || planning.phase === "approving" || pendingActions.length > 0) && (
        <section className="surface p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Propostas{" "}
              <span className="font-normal normal-case">
                ({pendingActions.length} pendente{pendingActions.length !== 1 ? "s" : ""})
              </span>
            </h2>
          </div>

          {pendingActions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {planning.phase === "proposing"
                ? "Vitória está gerando propostas…"
                : "Nenhuma proposta pendente."}
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {pendingActions.map((action) => (
                <ProposalCard
                  key={action.id}
                  action={action}
                  planningId={id}
                  onDecide={loadActions}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Decididas */}
      {decidedActions.length > 0 && (
        <section className="surface p-4 space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Revisadas{" "}
            <span className="font-normal normal-case">({decidedActions.length})</span>
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 opacity-60">
            {decidedActions.map((action) => (
              <ProposalCard
                key={action.id}
                action={action}
                planningId={id}
                onDecide={loadActions}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );

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

  return (
    <div className="min-h-0 h-full flex flex-col">
      <PageTitle title={title} />

      <div className="flex-1 min-h-0 lg:grid lg:grid-cols-[1fr_380px] lg:gap-4 lg:overflow-hidden">
        {/* Left — scrollable */}
        <div className="overflow-y-auto p-4 lg:p-6 space-y-0">
          {leftPane}
        </div>

        {/* Right — chat, sticky desktop */}
        {!isMobile && (
          <div className="hidden lg:flex lg:flex-col lg:overflow-hidden lg:py-4 lg:pr-4">
            {chatPanel}
          </div>
        )}
      </div>

      {/* Mobile — chat FAB */}
      {isMobile && (
        <>
          <ConversationFab agent="vitoria" isOpen={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)} />
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

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
