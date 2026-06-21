"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/app-shell";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { ConversationFab } from "@/components/ui/conversation/conversation-fab";
import { ConversationPanel } from "@/components/ui/conversation";
import { useIsMobile, XL_BREAKPOINT } from "@/hooks/use-mobile";
import { readPlanMode, useChatPlanMode } from "@/hooks/use-chat-plan-mode";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { toast } from "sonner";
import { fmtWeek } from "@/lib/date-utils";
import { brtMonday } from "@/lib/pm-review/week";
import type { PMReviewDetail } from "@/lib/dal/pm-review";
import { PMReviewReport } from "@/components/pm-review/pm-review-report";
import { PMReviewRibbon } from "@/components/pm-review/pm-review-ribbon";
import { PMReviewSheet } from "@/components/pm-review/pm-review-sheet";
import { PMReviewWizard } from "@/components/pm-review/pm-review-wizard";
import { PMReviewContextSheet } from "@/components/pm-review/pm-review-context-sheet";

const SYNTHESIZE_PROMPT =
  "Sintetize o report agora. Use update_pm_review_report com as 6 seções fixas em markdown, baseado nas notes ativas e fontes linkadas.";

/**
 * Workspace de UMA PM Review: ribbon (status/publish/edit/context) + canvas
 * (report OU wizard de curadoria) + chat da Vitoria + sheets. Parametrizado por
 * `pmReviewId` — remonta (via React key) quando o shell troca de semana.
 *
 * Reutilizado por: a app única `/projects/[id]/pm-review` (sem `withTitle`, o
 * shell desenha o cabeçalho + cronograma) e a rota legada `/pm-reviews/[id]`
 * (`withTitle`, standalone) até ela virar redirect.
 *
 * `onProjectResolved` informa o shell de projectId/projectName/referenceWeek
 * assim que a review carrega (pro título + sincronia de seleção); `onChanged`
 * avisa que a review mudou (publish/edit/delete) pro shell recarregar a régua.
 */
export function PMReviewWorkspace({
  pmReviewId,
  withTitle = false,
  topSlot,
  onProjectResolved,
  onChanged,
}: {
  pmReviewId: string;
  withTitle?: boolean;
  /** Renderizado logo abaixo da ribbon (a régua/cronograma vem aqui, como Planning). */
  topSlot?: ReactNode;
  onProjectResolved?: (info: {
    projectId: string;
    projectName: string | null;
    referenceWeek: string;
    status: PMReviewDetail["status"];
  }) => void;
  onChanged?: () => void;
}) {
  const id = pmReviewId;
  const router = useRouter();

  const [pmReview, setPMReview] = useState<PMReviewDetail | null>(null);
  const [loadError, setLoadError] = useState<"notfound" | "forbidden" | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [contextSheetOpen, setContextSheetOpen] = useState(false);
  const [wizardExpanded, setWizardExpanded] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState(false);

  const threadIdRef = useRef<string | null>(null);
  threadIdRef.current = threadId;

  // Abaixo de xl (1280px) o split canvas+chat não cabe → chat vira drawer
  // (FAB + bottom sheet), igual mobile. Evita empilhar 2 painéis desktop.
  const chatAsDrawer = useIsMobile(XL_BREAKPOINT);
  const { planMode, setPlanMode } = useChatPlanMode("vitoria");
  const [input, setInput] = useState("");
  // Hidratando o histórico do thread no mount → spinner no corpo do chat.
  const [chatHydrating, setChatHydrating] = useState(true);

  // ─── Data loading ────────────────────────────────────────────────────

  const loadPMReview = useCallback(async () => {
    const r = await fetch(`/api/pm-review/${id}`);
    if (r.status === 404) {
      setLoadError("notfound");
      return;
    }
    if (r.status === 403 || !r.ok) {
      setLoadError("forbidden");
      return;
    }
    const data = (await r.json()) as PMReviewDetail;
    setLoadError(null);
    setPMReview(data);
    onProjectResolved?.({
      projectId: data.projectId,
      projectName: data.projectName ?? null,
      referenceWeek: data.referenceWeek,
      status: data.status,
    });
  }, [id, onProjectResolved]);

  useEffect(() => {
    loadPMReview();
  }, [loadPMReview]);

  // ─── Chat ─────────────────────────────────────────────────────────────

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/pm-review/${id}/chat`,
        body: {
          pmReviewId: id,
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
          setIsFallback(res.headers.get("X-Mode-Fallback") === "true");
          return res;
        },
        // resumeStream() reconecta a um turn em vôo. O turn é resolvido
        // server-side a partir do thread — sem id do cliente.
        prepareReconnectToStreamRequest: () => ({
          api: `/api/pm-review/${id}/chat/resume`,
        }),
      }),
    [id],
  );

  const { messages, status, sendMessage, stop, setMessages, resumeStream } =
    useChat({ id, transport });

  // Hidrata histórico do thread no mount.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pm-review/${id}/chat?limit=50`)
      .then((r) => (r.ok ? r.json() : { threadId: null, messages: [] }))
      .then(
        (result: {
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
        },
      )
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChatHydrating(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Reload PM Review quando o stream do agent termina — Vitoria pode ter
  // atualizado reportMarkdown ou criado notes.
  const prevStatus = useRef(status);
  useEffect(() => {
    const wasRunning =
      prevStatus.current === "streaming" || prevStatus.current === "submitted";
    const isIdle = status === "ready" || status === "error";
    if (wasRunning && isIdle) {
      loadPMReview();
    }
    prevStatus.current = status;
  }, [status, loadPMReview]);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
    sendMessage({ text });
    setInput("");
  }, [input, status, sendMessage]);

  // Envia mensagem direta no chat (sem digitar). Usada pelos CTAs do wizard.
  const handleSendToVitoria = useCallback(
    (text: string) => {
      if (status === "streaming" || status === "submitted") return;
      sendMessage({ text });
      if (chatAsDrawer) setMobileOpen(true);
    },
    [status, sendMessage, chatAsDrawer],
  );

  const handleSynthesize = useCallback(() => {
    handleSendToVitoria(SYNTHESIZE_PROMPT);
  }, [handleSendToVitoria]);

  // ─── Publish ──────────────────────────────────────────────────────────

  const doPublish = async () => {
    setBusy(true);
    try {
      await fetchOrThrow(`/api/pm-review/${id}/publish`, { method: "POST" });
      await loadPMReview();
      onChanged?.();
      toast.success("PM Review publicado.");
    } catch (e) {
      showErrorToast(e, { label: "Falha ao publicar" });
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = () => {
    setConfirmState({
      title: "Publicar PM Review?",
      description:
        "Publicado = disponível pra consulta. Continua editável depois (você pode adicionar notes e regerar report).",
      confirmLabel: "Publicar",
      onConfirm: doPublish,
    });
  };

  const reloadAll = useCallback(() => {
    loadPMReview();
    onChanged?.();
  }, [loadPMReview, onChanged]);

  // ─── Render guards ────────────────────────────────────────────────────

  if (loadError === "notfound") {
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">PM Review não encontrado.</p>
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
        <p className="text-sm text-muted-foreground">
          Você não tem acesso a este PM Review.
        </p>
        <Link href="/projects">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Voltar
          </Button>
        </Link>
      </div>
    );
  }

  if (!pmReview) {
    return <div className="p-6 text-muted-foreground text-sm">Carregando…</div>;
  }

  const backHref = `/projects/${pmReview.projectId}?tab=apps&app=ceremonies`;
  const hasReport = pmReview.reportMarkdown !== null;
  const refreshing = status === "streaming" || status === "submitted";
  // Review de semana passada (D15): a síntese da Vitoria usa o contexto de
  // projeto de hoje (sprint/tasks), não o da semana — declarado honestamente.
  const isBackdated = pmReview.referenceWeek < brtMonday(new Date());

  const wizard = (
    <PMReviewWizard
      pmReviewId={pmReview.id}
      linkedTranscripts={pmReview.linkedTranscripts}
      linkedMeetings={pmReview.linkedMeetings}
      notes={pmReview.notes}
      hasReport={hasReport}
      refreshing={refreshing}
      onOpenInsumos={() => setContextSheetOpen(true)}
      onSendToVitoria={handleSendToVitoria}
      onSynthesize={handleSynthesize}
      onChanged={reloadAll}
    />
  );

  const chatPanel = (
    <ConversationPanel
      agent="vitoria"
      variant={chatAsDrawer ? "mobile" : "desktop"}
      messages={messages as UIMessage[]}
      status={status}
      isLoading={chatHydrating}
      input={input}
      onInputChange={setInput}
      onSubmit={handleSubmit}
      onStop={stop}
      isOpen={mobileOpen}
      onOpenChange={setMobileOpen}
      onClose={chatAsDrawer ? () => setMobileOpen(false) : undefined}
      planMode={planMode}
      onPlanModeChange={setPlanMode}
      fallbackActive={isFallback}
      className="h-full"
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {withTitle && (
        <PageTitle
          title={pmReview.projectName ?? "PM Review"}
          subtitle={`PM Review · ${fmtWeek(pmReview.referenceWeek)}`}
        />
      )}

      <PMReviewRibbon
        status={pmReview.status}
        referenceWeek={pmReview.referenceWeek}
        publishedAt={pmReview.publishedAt}
        linkedMeetingCount={pmReview.linkedMeetingCount}
        linkedTranscriptCount={pmReview.linkedTranscriptCount}
        noteTotal={pmReview.noteTotal}
        reportGenerated={pmReview.reportGeneratedAt !== null}
        backHref={backHref}
        busy={busy}
        onEdit={() => setEditSheetOpen(true)}
        onPublish={handlePublish}
        onOpenContext={() => setContextSheetOpen(true)}
      />

      {topSlot}

      {isBackdated && (
        <div className="shrink-0 border-b bg-muted/40 px-6 py-1.5 text-[11px] text-muted-foreground">
          Review retroativa (semana de {fmtWeek(pmReview.referenceWeek)}) — a síntese
          reflete o contexto de projeto de hoje, não o da semana de referência.
        </div>
      )}

      {/* Main panel: wizard (sem report) OU report + collapsible curar (com report) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(380px,1fr)] gap-4 p-4">
        <div className="surface overflow-y-auto min-h-0 p-6">
          {hasReport ? (
            <>
              <PMReviewReport
                reportMarkdown={pmReview.reportMarkdown}
                reportGeneratedAt={pmReview.reportGeneratedAt}
                notes={pmReview.notes}
                projectContext={pmReview.projectContext}
                onRequestSync={handleSynthesize}
                refreshing={refreshing}
              />
              {/* Curar contexto — collapsible no rodapé */}
              <div className="mt-8 border-t pt-4">
                <button
                  type="button"
                  onClick={() => setWizardExpanded((v) => !v)}
                  className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  {wizardExpanded ? (
                    <ChevronUp className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                  Curar contexto (insumos · notas · síntese)
                </button>
                {wizardExpanded && <div className="mt-3">{wizard}</div>}
              </div>
            </>
          ) : (
            wizard
          )}
        </div>

        {!chatAsDrawer && <div className="min-h-0">{chatPanel}</div>}
      </div>

      {chatAsDrawer && (
        <>
          <ConversationFab
            agent="vitoria"
            isOpen={mobileOpen}
            onClick={() => setMobileOpen(!mobileOpen)}
          />
          {chatPanel}
        </>
      )}

      <PMReviewContextSheet
        pmReviewId={pmReview.id}
        projectId={pmReview.projectId}
        open={contextSheetOpen}
        onOpenChange={setContextSheetOpen}
        linkedTranscripts={pmReview.linkedTranscripts}
        linkedMeetings={pmReview.linkedMeetings}
        onChanged={reloadAll}
      />

      <PMReviewSheet
        open={editSheetOpen}
        onOpenChange={setEditSheetOpen}
        projectId={pmReview.projectId}
        pmReview={{
          id: pmReview.id,
          facilitatorId: pmReview.facilitatorId,
          scheduledFor: pmReview.scheduledFor,
          referenceWeek: pmReview.referenceWeek,
        }}
        onUpdated={reloadAll}
        onDeleted={() => router.push(backHref)}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
