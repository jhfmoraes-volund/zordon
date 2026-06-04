"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { ConversationPanel } from "@/components/ui/conversation";
import { readPlanMode, useChatPlanMode } from "@/hooks/use-chat-plan-mode";
import { DesignSessionContextSheet } from "@/components/design-session/design-session-context-sheet";
import { PrdBriefingRibbon } from "@/components/sessions/prd-session/prd-briefing-ribbon";
import { PrdCard } from "@/components/sessions/prd-session/prd-card";
import { PrdDetailSheet } from "@/components/prd/prd-detail-sheet";
import type { ProductRequirementRow } from "@/lib/dal/product-requirements";

const WELCOME_TEXT =
  "Olá! Sou o Vitor. Vamos refinar esses PRDs juntos antes de mandar pra Forja — me peça pra detalhar AC, descobrir gaps, dividir ou consolidar PRDs.";

function computeStats(prds: ProductRequirementRow[]) {
  let ready = 0;
  let draft = 0;
  for (const p of prds) {
    if (p.status === "approved" || p.status === "ready") ready += 1;
    else if (p.status === "draft" || p.status === "review") draft += 1;
  }
  return { total: prds.length, ready, draft };
}

type Props = {
  sessionId: string;
  projectId: string;
};

/**
 * Step único pra sessions tipo `prd_session` (upload ou quick_ask).
 *
 * Layout:
 *   • Ribbon (stats de PRDs + insumos + enviar pra Forja)
 *   • Esquerda: lista de PRDs vinculados (cards collapsable)
 *   • Direita: chat com Vitor (mesmo transport do pre_work, currentStepKey `prd_briefing`)
 *
 * Infra de insumos (transcripts + files) reusa exatamente o que o pre_work
 * usa: `useSessionFiles`, `TranscriptModal`, `ContextSheet`.
 */
export function PrdBriefingStep({ sessionId, projectId }: Props) {
  const [approvingAll, setApprovingAll] = useState(false);
  const [demotingAll, setDemotingAll] = useState(false);

  const [prds, setPrds] = useState<ProductRequirementRow[]>([]);
  const [prdsLoading, setPrdsLoading] = useState(true);
  const [selectedPrdId, setSelectedPrdId] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [insumosOpen, setInsumosOpen] = useState(false);
  const [insumosCount, setInsumosCount] = useState(0);

  // Kickoff (QAL-006): 1ª análise automática do Vitor ao abrir uma session
  // criada via launcher (firstAnalysisStatus=pending + thread vazia).
  const [firstAnalysisStatus, setFirstAnalysisStatus] = useState<string | null>(
    null,
  );
  const [launcherBrief, setLauncherBrief] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [threadHasMessages, setThreadHasMessages] = useState(false);
  const kickoffFiredRef = useRef(false);

  const threadIdRef = useRef<string | null>(threadId);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  const { planMode, setPlanMode } = useChatPlanMode("vitor");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/design-sessions/${sessionId}/chat`,
        body: {
          sessionId,
          currentStepKey: "prd_briefing",
          get threadId() {
            return threadIdRef.current;
          },
          get planMode() {
            return readPlanMode("vitor");
          },
        },
      }),
    [sessionId],
  );

  const initialMsg = useMemo<UIMessage>(
    () =>
      ({
        id: "initial",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: WELCOME_TEXT }],
      }) as UIMessage,
    [],
  );

  const { messages, status, sendMessage, stop, setMessages } = useChat({
    transport,
    messages: [initialMsg],
  });

  const isStreaming = status === "streaming" || status === "submitted";

  // Load chat history
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/design-sessions/${sessionId}/chat?channel=web&limit=100`)
      .then((r) => (r.ok ? r.json() : null))
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setHistoryLoaded(true);
          return;
        }
        if (result.threadId) setThreadId(result.threadId);
        if (result.messages?.length) {
          const restored = result.messages
            .filter(
              (m: { role: string }) =>
                m.role === "user" || m.role === "assistant",
            )
            .map((m: { id: string; role: string; content: string }) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              parts: [{ type: "text" as const, text: m.content }],
            }));
          setMessages([initialMsg, ...restored]);
          setThreadHasMessages(true);
        }
        setHistoryLoaded(true);
      })
      .catch((err) => {
        console.error("[PrdBriefingStep] Failed to load chat history:", err);
        if (!cancelled) setHistoryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, setMessages, initialMsg]);

  // Kickoff (QAL-006): lê o status da 1ª análise + o brief do launcher.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/design-sessions/${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (cancelled || !s) return;
        setFirstAnalysisStatus(
          (s as { firstAnalysisStatus?: string | null }).firstAnalysisStatus ??
            null,
        );
        setLauncherBrief(
          (s as { launcherBrief?: string | null }).launcherBrief ?? null,
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Kickoff (QAL-006): quando a session foi criada via launcher e ainda não
  // teve a 1ª análise (status=pending) e a thread está vazia, dispara UMA vez
  // a análise automática do Vitor. O guard via ref + flip otimista + a checagem
  // de thread-vazia impedem duplicar; o server marca `done` no fim do turno.
  useEffect(() => {
    if (kickoffFiredRef.current) return;
    if (!historyLoaded || threadHasMessages) return;
    if (firstAnalysisStatus !== "pending") return;
    if (status !== "ready") return;

    // ref guard impede re-disparo nesta instância; server marca `done` pra
    // reaberturas. Sem setState aqui (evita cascading render).
    kickoffFiredRef.current = true;

    const brief = launcherBrief?.trim();
    // Kickoff neutro: deixa o prompt do agente conduzir (Foundation Mode
    // dispara automático quando a session não tem PRDs ainda — Vitor vai
    // ler os anexos, sintetizar e iniciar as ondas de discovery). Antes
    // forçava "proponha os PRDs" e atropelava o grilling.
    const text = brief
      ? brief
      : "Vamos começar. Analisa os anexos primeiro, me conta o que você entendeu do projeto e me leva pelas perguntas que importam.";

    sendMessage({ text }, { body: { kickoff: true } });
  }, [
    historyLoaded,
    threadHasMessages,
    firstAnalysisStatus,
    status,
    launcherBrief,
    sendMessage,
  ]);

  // Load PRDs
  const loadPrds = useCallback(async () => {
    try {
      const r = await fetch(`/api/design-sessions/${sessionId}/prds`);
      if (!r.ok) return;
      const json = (await r.json()) as { prds: ProductRequirementRow[] };
      setPrds(json.prds ?? []);
    } finally {
      setPrdsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadPrds();
  }, [loadPrds]);

  // Re-fetch PRDs after each Vitor response (tool calls may have mutated them).
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if ((prev === "streaming" || prev === "submitted") && status === "ready") {
      void loadPrds();
    }
  }, [status, loadPrds]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || isStreaming) return;
    setInputText("");
    sendMessage({ text });
  }, [inputText, isStreaming, sendMessage]);

  const stats = computeStats(prds);

  const handleApproveAll = useCallback(async () => {
    const pending = prds.filter(
      (p) => p.status === "draft" || p.status === "review",
    );
    if (pending.length === 0) return;
    setApprovingAll(true);
    try {
      const results = await Promise.allSettled(
        pending.map((p) =>
          fetch(`/api/prds/${p.id}/approve`, { method: "POST" }).then(
            async (r) => {
              if (!r.ok) {
                const json = await r.json().catch(() => ({}));
                throw new Error(json.error ?? `HTTP ${r.status}`);
              }
              return r;
            },
          ),
        ),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      if (failed === 0) {
        toast.success(`${ok} PRD${ok > 1 ? "s" : ""} aprovado${ok > 1 ? "s" : ""}.`);
      } else {
        const firstErr = (results.find((r) => r.status === "rejected") as PromiseRejectedResult)?.reason;
        toast.warning(
          `${ok} aprovado${ok !== 1 ? "s" : ""}, ${failed} falhou${failed !== 1 ? "ram" : ""}: ${String(firstErr?.message ?? firstErr)}`,
        );
      }
      await loadPrds();
    } finally {
      setApprovingAll(false);
    }
  }, [prds, loadPrds]);

  const handleDemoteAll = useCallback(async () => {
    const approved = prds.filter(
      (p) => p.status === "approved" || p.status === "ready",
    );
    if (approved.length === 0) return;
    setDemotingAll(true);
    try {
      const results = await Promise.allSettled(
        approved.map((p) =>
          fetch(`/api/prds/${p.id}/demote`, { method: "POST" }).then(
            async (r) => {
              if (!r.ok) {
                const json = await r.json().catch(() => ({}));
                throw new Error(json.error ?? `HTTP ${r.status}`);
              }
              return r;
            },
          ),
        ),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      if (failed === 0) {
        toast.success(
          `${ok} PRD${ok > 1 ? "s" : ""} despromovido${ok > 1 ? "s" : ""} pra draft.`,
        );
      } else {
        const firstErr = (results.find((r) => r.status === "rejected") as PromiseRejectedResult)?.reason;
        toast.warning(
          `${ok} despromovido${ok !== 1 ? "s" : ""}, ${failed} falhou${failed !== 1 ? "ram" : ""}: ${String(firstErr?.message ?? firstErr)}`,
        );
      }
      await loadPrds();
    } finally {
      setDemotingAll(false);
    }
  }, [prds, loadPrds]);

  return (
    <div className="-m-6 h-full flex flex-col min-h-0">
      <PrdBriefingRibbon
        stats={stats}
        insumosCount={insumosCount}
        onOpenInsumos={() => setInsumosOpen(true)}
        onApproveAll={handleApproveAll}
        approving={approvingAll}
        onDemoteAll={handleDemoteAll}
        demoting={demotingAll}
      />

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(420px,1fr)] gap-6 p-6">
        {/* PRD list (esquerda) */}
        <div className="surface overflow-y-auto min-h-0">
          <h3 className="sticky top-0 z-10 bg-card/95 backdrop-blur text-sm font-semibold px-5 pt-5 pb-3 border-b">
            PRDs ({prds.length})
          </h3>
          <div className="px-5 py-4 space-y-2">
            {prdsLoading ? (
              <p className="text-sm text-muted-foreground">Carregando PRDs…</p>
            ) : prds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum PRD nesta session ainda. Converse com Vitor pra gerar.
              </p>
            ) : (
              prds.map((prd) => (
                <PrdCard
                  key={prd.id}
                  prd={prd}
                  projectId={projectId}
                  onOpenDetail={setSelectedPrdId}
                />
              ))
            )}
          </div>
        </div>

        {/* Chat Vitor (direita) */}
        <div className="min-h-0 surface relative flex flex-col overflow-hidden">
          <ConversationPanel
            agent="vitor"
            variant="desktop"
            messages={messages}
            status={status}
            input={inputText}
            onInputChange={setInputText}
            onSubmit={handleSend}
            onStop={stop}
            planMode={planMode}
            onPlanModeChange={setPlanMode}
            placeholder="Peça pra Vitor refinar, dividir, consolidar PRDs ou tirar dúvidas…"
            composerSubmitDisabled={!inputText.trim()}
          />
        </div>
      </div>

      <DesignSessionContextSheet
        sessionId={sessionId}
        projectId={projectId}
        open={insumosOpen}
        onOpenChange={setInsumosOpen}
        ritualLabel="PRD"
        onCountChange={setInsumosCount}
      />

      <PrdDetailSheet
        prdId={selectedPrdId}
        onOpenChange={(open) => !open && setSelectedPrdId(null)}
        onChanged={(updated) =>
          setPrds((prev) =>
            prev.map((p) => (p.id === updated.id ? updated : p)),
          )
        }
        onDeleted={(deletedId) =>
          setPrds((prev) => prev.filter((p) => p.id !== deletedId))
        }
      />
    </div>
  );
}
