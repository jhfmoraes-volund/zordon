"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useIsMobile } from "@/hooks/use-mobile";
import { readPlanMode, useChatPlanMode } from "@/hooks/use-chat-plan-mode";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { toast } from "sonner";
import type { PMReviewDetail } from "@/lib/dal/pm-review";
import { PMReviewReport } from "@/components/pm-review/pm-review-report";
import { PMReviewRibbon } from "@/components/pm-review/pm-review-ribbon";
import { PMReviewSheet } from "@/components/pm-review/pm-review-sheet";
import { PMReviewWizard } from "@/components/pm-review/pm-review-wizard";
import { PMReviewInsumosSheet } from "@/components/pm-review/pm-review-insumos-sheet";

const SYNTHESIZE_PROMPT =
  "Sintetize o report agora. Use update_pm_review_report com as 6 seções fixas em markdown, baseado nas notes ativas e fontes linkadas.";

export default function PMReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [pmReview, setPMReview] = useState<PMReviewDetail | null>(null);
  const [loadError, setLoadError] = useState<"notfound" | "forbidden" | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [insumosSheetOpen, setInsumosSheetOpen] = useState(false);
  const [wizardExpanded, setWizardExpanded] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);

  const threadIdRef = useRef<string | null>(null);
  threadIdRef.current = threadId;

  const isMobile = useIsMobile();
  const { planMode, setPlanMode } = useChatPlanMode("vitoria");
  const [input, setInput] = useState("");

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
    const data = await r.json();
    setLoadError(null);
    setPMReview(data);
  }, [id]);

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
          return res;
        },
      }),
    [id],
  );

  const { messages, status, sendMessage, stop, setMessages } = useChat({ transport });

  // Hidrata histórico do thread no mount.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pm-review/${id}/chat?limit=50`)
      .then((r) => (r.ok ? r.json() : { threadId: null, messages: [] }))
      .then(
        (result: {
          threadId: string | null;
          messages: Array<{ id: string; role: string; content: string }>;
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
        },
      )
      .catch(() => {});
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
      if (isMobile) setMobileOpen(true);
    },
    [status, sendMessage, isMobile],
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

  const backHref = `/projects/${pmReview.projectId}?tab=ceremonies`;
  const hasReport = pmReview.reportMarkdown !== null;
  const refreshing = status === "streaming" || status === "submitted";

  const wizard = (
    <PMReviewWizard
      pmReviewId={pmReview.id}
      linkedTranscripts={pmReview.linkedTranscripts}
      linkedMeetings={pmReview.linkedMeetings}
      notes={pmReview.notes}
      hasReport={hasReport}
      refreshing={refreshing}
      onOpenInsumos={() => setInsumosSheetOpen(true)}
      onSendToVitoria={handleSendToVitoria}
      onSynthesize={handleSynthesize}
      onChanged={loadPMReview}
    />
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
    <div className="-mx-3 -my-4 flex h-[calc(100svh-3rem)] flex-col overflow-hidden sm:-mx-4 md:h-[calc(100svh-3.5rem)] lg:-m-6">
      <PageTitle title={`PM Review · ${pmReview.referenceWeek}`} />

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
        onOpenContext={() => setInsumosSheetOpen(true)}
      />

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

      <PMReviewInsumosSheet
        pmReviewId={pmReview.id}
        projectId={pmReview.projectId}
        open={insumosSheetOpen}
        onOpenChange={setInsumosSheetOpen}
        linkedTranscripts={pmReview.linkedTranscripts}
        linkedMeetings={pmReview.linkedMeetings}
        onChanged={loadPMReview}
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
          status: pmReview.status,
        }}
        onUpdated={loadPMReview}
        onDeleted={() => router.push(backHref)}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
